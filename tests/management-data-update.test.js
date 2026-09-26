'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresManagementDataRepository } = require('../server/management-data/postgres-management-data-repository');

test('Phase 6.37 updates the confirmed existing management-data row in place', async () => {
  let captured = null;
  const pool = {
    async query(sql, params) {
      captured = { sql, params };
      return { rows:[{
        id:'42',
        owner_email:'owner@example.com',
        business_key:'north-star-beans',
        data_date:'2026-08-15',
        metric_type:'revenue',
        amount:'126000.0000',
        currency:'JPY',
        confirmed_by_owner:true
      }] };
    }
  };
  const repository = new PostgresManagementDataRepository(pool);
  const result = await repository.update('owner@example.com', '42', {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    amount:126000,
    currency:'JPY',
    source:'owner confirmed correction',
    note:'2026年8月15日のNORTH STAR BEANSの売上は126000円です',
    confirmed:true
  });

  assert.equal(result.amount, '126000.0000');
  assert.match(captured.sql, /UPDATE management_data/);
  assert.doesNotMatch(captured.sql, /INSERT INTO management_data\s*\(/);
  assert.match(captured.sql, /WHERE id = \$1 AND owner_email = \$2/);
  assert.equal(captured.params[0], '42');
  assert.equal(captured.params[1], 'owner@example.com');
  assert.equal(captured.params[5], 126000);
});

test('Phase 6.37 refuses an unconfirmed in-place update payload', async () => {
  let called = false;
  const repository = new PostgresManagementDataRepository({
    async query() { called = true; return { rows:[] }; }
  });
  const result = await repository.update('owner@example.com', '42', {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    amount:126000,
    currency:'JPY',
    source:'owner conversation',
    confirmed:false
  });
  assert.equal(result, null);
  assert.equal(called, false);
});


test('Phase 6.38 records the previous and new management values in the same atomic SQL statement', async () => {
  let captured = null;
  const repository = new PostgresManagementDataRepository({
    async query(sql, params) {
      captured = { sql, params };
      return { rows:[{ id:'42', amount:'126000.00', currency:'JPY' }] };
    }
  });
  await repository.update('owner@example.com', '42', {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    amount:126000,
    currency:'JPY',
    source:'owner confirmed correction',
    note:'2026年8月15日のNORTH STAR BEANSの売上は126000円です',
    confirmed:true
  });

  assert.match(captured.sql, /WITH previous AS/);
  assert.match(captured.sql, /FOR UPDATE/);
  assert.match(captured.sql, /INSERT INTO management_data_history/);
  assert.match(captured.sql, /previous_amount, new_amount/);
  assert.match(captured.sql, /previous_currency, new_currency/);
  assert.match(captured.sql, /confirmed_by_owner, changed_at/);
  assert.match(captured.sql, /previous\.previous_amount IS DISTINCT FROM updated\.amount/);
  assert.equal(captured.params[5], 126000);
});

test('Phase 6.38 migration creates indexed audit history without changing the current management_data row model', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/006_create_management_data_history.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS management_data_history/);
  assert.match(sql, /management_data_id BIGINT NOT NULL REFERENCES management_data\(id\)/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.match(sql, /previous_amount NUMERIC\(18,2\) NOT NULL/);
  assert.match(sql, /new_amount NUMERIC\(18,2\) NOT NULL/);
  assert.match(sql, /changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  assert.match(sql, /management_data_history_entry_changed_idx/);
});


test('Phase 6.46 resolves duplicate rows by superseding, never deleting', async () => {
  let captured = null;
  const repository = new PostgresManagementDataRepository({
    async query(sql, params) {
      captured = { sql, params };
      return { rows:[{ keep_id:'7', superseded_count:1 }] };
    }
  });
  const result = await repository.resolveDuplicateGroup('owner@example.com', {
    businessKey:'north-star-beans',
    dataDate:'2026-09-22',
    metricType:'revenue',
    keepEntryId:'7',
    expectedRows:[
      { id:'4', amount:160000, currency:'JPY', updatedAt:'2026-09-22T10:00:00.000Z' },
      { id:'7', amount:161000, currency:'JPY', updatedAt:'2026-09-22T11:00:00.000Z' }
    ]
  });

  assert.deepEqual(result, { keepEntryId:'7', supersededCount:1 });
  assert.match(captured.sql, /FOR UPDATE/);
  assert.match(captured.sql, /superseded_by_management_data_id = valid.keep_id/);
  assert.match(captured.sql, /superseded_reason = 'owner confirmed duplicate resolution'/);
  assert.doesNotMatch(captured.sql, /DELETE FROM management_data/i);
  assert.equal(captured.params[0], 'owner@example.com');
  assert.equal(captured.params[4], '7');
});

test('Phase 6.46 fails closed when the duplicate snapshot is stale', async () => {
  const repository = new PostgresManagementDataRepository({
    async query() { return { rows:[] }; }
  });
  const result = await repository.resolveDuplicateGroup('owner@example.com', {
    businessKey:'north-star-beans',
    dataDate:'2026-09-22',
    metricType:'revenue',
    keepEntryId:'7',
    expectedRows:[
      { id:'4', amount:160000, currency:'JPY', updatedAt:'2026-09-22T10:00:00.000Z' },
      { id:'7', amount:161000, currency:'JPY', updatedAt:'2026-09-22T11:00:00.000Z' }
    ]
  });
  assert.equal(result, null);
});

test('Phase 6.46 migration preserves duplicate rows and adds superseded metadata', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/007_add_management_data_superseded.sql'), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS superseded_by_management_data_id/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS superseded_at/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS superseded_reason/);
  assert.doesNotMatch(sql, /DELETE FROM management_data/i);
});
