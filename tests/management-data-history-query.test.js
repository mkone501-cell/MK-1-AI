'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectManagementDataHistoryQuery,
  managementDataHistoryAnswer
} = require('../server/management-data/query');
const { PostgresManagementDataRepository } = require('../server/management-data/postgres-management-data-repository');

test('Phase 6.39 detects a dated revenue history question even when the business name is omitted', () => {
  assert.deepEqual(
    detectManagementDataHistoryQuery('2026年8月15日の売上の変更履歴を教えて'),
    { businessKey:null, dataDate:'2026-08-15', metricType:'revenue' }
  );
});

test('Phase 6.39 detects an explicit NORTH STAR BEANS history question', () => {
  assert.deepEqual(
    detectManagementDataHistoryQuery('2026年8月15日のNORTH STAR BEANSの売上の更新履歴を教えて'),
    { businessKey:'north-star-beans', dataDate:'2026-08-15', metricType:'revenue' }
  );
});

test('Phase 6.39 does not treat an ordinary current-value question as history', () => {
  assert.equal(
    detectManagementDataHistoryQuery('2026年8月15日のNORTH STAR BEANSの売上はいくらですか'),
    null
  );
});

test('Phase 6.39 formats chronological old-to-new changes and the current confirmed value', () => {
  const answer = managementDataHistoryAnswer([
    {
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-29T02:00:00.000Z'
    },
    {
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-29T02:05:00.000Z'
    }
  ], {
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.match(answer, /2026年8月15日/);
  assert.match(answer, /NORTH STAR BEANS/);
  assert.match(answer, /変更履歴は2件/);
  assert.match(answer, /125,000円 → 126,000円/);
  assert.match(answer, /126,000円 → 125,000円/);
  assert.match(answer, /現在の登録値は125,000円/);
});

test('Phase 6.39 asks for a business name when an omitted-business history query matches multiple businesses', () => {
  const answer = managementDataHistoryAnswer([
    { business_key:'north-star-beans', previous_amount:1, new_amount:2, previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-29T02:00:00Z' },
    { business_key:'other-business', previous_amount:3, new_amount:4, previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-29T02:01:00Z' }
  ], null, { businessKey:null, dataDate:'2026-08-15', metricType:'revenue' });
  assert.match(answer, /複数事業/);
  assert.match(answer, /事業名を指定/);
});

test('Phase 6.39 history repository is owner-scoped, ordered chronologically and can filter by business', async () => {
  let captured = null;
  const repository = new PostgresManagementDataRepository({
    async query(sql, params) {
      captured = { sql, params };
      return { rows:[] };
    }
  });

  const rows = await repository.findHistory('owner@example.com', {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.deepEqual(rows, []);
  assert.match(captured.sql, /FROM management_data_history/);
  assert.match(captured.sql, /WHERE owner_email = \$1/);
  assert.match(captured.sql, /data_date = \$2::date/);
  assert.match(captured.sql, /metric_type = \$3/);
  assert.match(captured.sql, /business_key = \$4/);
  assert.match(captured.sql, /ORDER BY changed_at ASC, id ASC/);
  assert.deepEqual(captured.params, ['owner@example.com', '2026-08-15', 'revenue', 'north-star-beans']);
});
