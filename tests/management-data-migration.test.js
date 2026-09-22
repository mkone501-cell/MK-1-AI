const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateManagementData } = require('../server/management-data/migrate-management-data');

test('Phase 6.2 runs management data migration through the existing database pool', async () => {
  const queries = [];
  const repository = { pool: { query: async sql => { queries.push(sql); } } };
  await migrateManagementData(repository);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS management_data/i);
  assert.match(queries[0], /confirmed_by_owner BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(queries[0], /ALTER COLUMN currency TYPE VARCHAR\(8\)/i);
});
