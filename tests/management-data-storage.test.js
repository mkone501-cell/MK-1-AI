const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresManagementDataRepository, normalizeEntry } = require('../server/management-data/postgres-management-data-repository');

test('Phase 6.3 refuses management data without explicit owner confirmation', async () => {
  let called = false;
  const repository = new PostgresManagementDataRepository({ query: async () => { called = true; return { rows: [] }; } });
  const saved = await repository.create('owner@example.com', {
    businessKey:'north-star-beans', dataDate:'2026-09-21', metricType:'revenue',
    amount:250000, currency:'JPY', source:'owner input', confirmed:false
  });
  assert.equal(saved, null);
  assert.equal(called, false);
});

test('Phase 6.3 stores a confirmed management number with parameterized SQL', async () => {
  const calls = [];
  const repository = new PostgresManagementDataRepository({
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows:[{ id:'1', confirmed_by_owner:true }] };
    }
  });
  const saved = await repository.create('owner@example.com', {
    businessKey:'north-star-beans', dataDate:'2026-09-21', metricType:'revenue',
    amount:'250000', currency:'jpy', note:'daily sales', source:'owner input', confirmed:true
  });
  assert.equal(saved.confirmed_by_owner, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO management_data/i);
  assert.match(calls[0].sql, /confirmed_by_owner\)\s*VALUES[\s\S]*TRUE/i);
  assert.ok(calls[0].sql.includes('$1'));
  assert.deepEqual(calls[0].values, [
    'owner@example.com', 'north-star-beans', '2026-09-21', 'revenue',
    250000, 'JPY', 'daily sales', 'owner input'
  ]);
});

test('Phase 6.3 validates management data before storage', () => {
  assert.equal(normalizeEntry({ confirmed:true, businessKey:'x', dataDate:'bad', metricType:'revenue', amount:1, source:'owner' }), null);
  assert.equal(normalizeEntry({ confirmed:true, businessKey:'x', dataDate:'2026-09-21', metricType:'unknown', amount:1, source:'owner' }), null);
  assert.equal(normalizeEntry({ confirmed:true, businessKey:'x', dataDate:'2026-09-21', metricType:'revenue', amount:'not-a-number', source:'owner' }), null);
});

test('Phase 6.8 stores confirmed customer counts with COUNT unit', async () => {
  const calls = [];
  const repository = new PostgresManagementDataRepository({
    query: async (sql, values) => { calls.push({ sql, values }); return { rows:[{ id:'2', confirmed_by_owner:true }] }; }
  });
  const saved = await repository.create('owner@example.com', {
    businessKey:'north-star-beans', dataDate:'2026-09-22', metricType:'customers',
    amount:80, currency:'COUNT', source:'owner confirmed conversation', confirmed:true
  });
  assert.equal(saved.confirmed_by_owner, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values[5], 'COUNT');
});
