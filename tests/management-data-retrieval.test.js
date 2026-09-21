const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataQuery, managementDataContext } = require('../server/management-data/query');
const { PostgresManagementDataRepository } = require('../server/management-data/postgres-management-data-repository');

test('Phase 6.7 parses a confirmed management-data fact question', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月21日のNORTH STAR BEANSの売上はいくらですか？'),
    { businessKey:'north-star-beans', metricType:'revenue', dataDate:'2026-09-21' }
  );
});

test('Phase 6.7 does not query without an explicit business target', () => {
  assert.equal(detectManagementDataQuery('2026年9月21日の売上はいくらですか？'), null);
});

test('Phase 6.7 formats confirmed management data as Mirai reference context', () => {
  const context = managementDataContext({
    business_key:'north-star-beans', data_date:'2026-09-21',
    metric_type:'revenue', amount:'150000', currency:'JPY'
  });
  assert.equal(context.body, '9月21日のNORTH STAR BEANSの売上は150,000円です。');
  assert.equal(context.source, '本人確認済み経営数値');
});

test('Phase 6.7 exact lookup is owner, business, date and metric scoped', async () => {
  let seen;
  const pool = {
    async query(sql, params) {
      seen = { sql, params };
      return { rows:[{ amount:'150000' }] };
    }
  };
  const repo = new PostgresManagementDataRepository(pool);
  const row = await repo.findExact('owner@example.com', {
    businessKey:'north-star-beans', dataDate:'2026-09-21', metricType:'revenue'
  });
  assert.equal(row.amount, '150000');
  assert.deepEqual(seen.params, ['owner@example.com', 'north-star-beans', '2026-09-21', 'revenue']);
  assert.match(seen.sql, /data_date = \$3::date/);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
});


test('Phase 6.7 formats PostgreSQL Date values without dropping confirmed data', () => {
  const context = managementDataContext({
    business_key:'north-star-beans', data_date:new Date('2026-09-21T00:00:00.000Z'),
    metric_type:'revenue', amount:'150000', currency:'JPY'
  });
  assert.equal(context.body, '9月21日のNORTH STAR BEANSの売上は150,000円です。');
});
