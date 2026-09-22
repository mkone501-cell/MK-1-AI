const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataCandidate } = require('../server/management-data/candidates');

test('Phase 6.4 detects a factual revenue number but never confirms it automatically', () => {
  const item = detectManagementDataCandidate('2026年9月21日のNORTH STAR BEANSの売上は25万円です。');
  assert.equal(item.metricType, 'revenue');
  assert.equal(item.amount, 250000);
  assert.equal(item.dataDate, '2026-09-21');
  assert.equal(item.currency, 'JPY');
  assert.equal(item.confirmed, false);
});

test('Phase 6.4 detects expense, profit and cash balance amounts', () => {
  assert.equal(detectManagementDataCandidate('経費は12万円です。').metricType, 'expense');
  assert.equal(detectManagementDataCandidate('利益は8万円です。').metricType, 'profit');
  assert.equal(detectManagementDataCandidate('現金残高は300万円です。').metricType, 'cash_balance');
});

test('Phase 6.4 does not turn questions, forecasts or targets into candidates', () => {
  assert.equal(detectManagementDataCandidate('今日の売上は25万円ですか？'), null);
  assert.equal(detectManagementDataCandidate('来月の売上見込みは300万円です。'), null);
  assert.equal(detectManagementDataCandidate('売上目標は500万円です。'), null);
});

test('Phase 6.4 ignores text without a supported metric and amount', () => {
  assert.equal(detectManagementDataCandidate('今日は忙しかったです。'), null);
  assert.equal(detectManagementDataCandidate('売上は好調です。'), null);
});


test('Phase 6.9 detects confirmed-style customer count and average spend candidates with explicit business/date', () => {
  const customers = detectManagementDataCandidate('2026年9月22日のNORTH STAR BEANSの来客数は80人でした。');
  assert.equal(customers.businessKey, 'north-star-beans');
  assert.equal(customers.metricType, 'customers');
  assert.equal(customers.amount, 80);
  assert.equal(customers.currency, 'COUNT');
  assert.equal(customers.dataDate, '2026-09-22');
  assert.equal(customers.confirmed, false);

  const spend = detectManagementDataCandidate('2026年9月22日のNORTH STAR BEANSの客単価は1,850円でした。');
  assert.equal(spend.businessKey, 'north-star-beans');
  assert.equal(spend.metricType, 'average_spend');
  assert.equal(spend.amount, 1850);
  assert.equal(spend.currency, 'JPY');
  assert.equal(spend.dataDate, '2026-09-22');
  assert.equal(spend.confirmed, false);
});
