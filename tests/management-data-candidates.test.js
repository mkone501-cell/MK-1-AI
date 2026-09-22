const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataCandidate, detectManagementDataCandidates } = require('../server/management-data/candidates');

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


test('Phase 6.10 extracts multiple daily metrics from one explicit owner report without confirming them', () => {
  const items = detectManagementDataCandidates('2026年9月22日のNORTH STAR BEANSの売上は160,000円、来客数は80人、客単価は2,000円でした。');
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(item => item.metricType), ['revenue', 'customers', 'average_spend']);
  assert.deepEqual(items.map(item => item.amount), [160000, 80, 2000]);
  assert.ok(items.every(item => item.businessKey === 'north-star-beans'));
  assert.ok(items.every(item => item.dataDate === '2026-09-22'));
  assert.ok(items.every(item => item.confirmed === false));
});

test('Phase 6.10 still rejects a bundled forecast instead of creating save candidates', () => {
  assert.deepEqual(detectManagementDataCandidates('2026年9月23日のNORTH STAR BEANSの売上見込みは20万円、来客数は90人です。'), []);
});
