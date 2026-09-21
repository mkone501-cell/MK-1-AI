const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Phase 6.1 management data migration is isolated and owner-confirmed', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '005_create_management_data.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS management_data/i);
  assert.match(sql, /owner_email TEXT NOT NULL/i);
  assert.match(sql, /business_key TEXT NOT NULL/i);
  assert.match(sql, /data_date DATE NOT NULL/i);
  assert.match(sql, /metric_type TEXT NOT NULL/i);
  assert.match(sql, /amount NUMERIC\(18,2\) NOT NULL/i);
  assert.match(sql, /currency CHAR\(3\) NOT NULL DEFAULT 'JPY'/i);
  assert.match(sql, /confirmed_by_owner BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.doesNotMatch(sql, /ALTER TABLE management_knowledge/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
});
