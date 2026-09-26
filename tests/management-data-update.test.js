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
        id:'11111111-1111-4111-8111-111111111111',
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
  const result = await repository.update('owner@example.com', '11111111-1111-4111-8111-111111111111', {
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
  assert.doesNotMatch(captured.sql, /INSERT INTO management_data/);
  assert.match(captured.sql, /WHERE id = \$1 AND owner_email = \$2/);
  assert.equal(captured.params[0], '11111111-1111-4111-8111-111111111111');
  assert.equal(captured.params[1], 'owner@example.com');
  assert.equal(captured.params[5], 126000);
});

test('Phase 6.37 refuses an unconfirmed in-place update payload', async () => {
  let called = false;
  const repository = new PostgresManagementDataRepository({
    async query() { called = true; return { rows:[] }; }
  });
  const result = await repository.update('owner@example.com', '11111111-1111-4111-8111-111111111111', {
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
