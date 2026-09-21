const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataCandidate } = require('../server/management-data/candidates');

test('Phase 6.6 identifies explicit NORTH STAR BEANS target for confirmed save flow', () => {
  const candidate = detectManagementDataCandidate('2026年9月20日のNORTH STAR BEANSの売上は123,456円でした。');
  assert.equal(candidate.businessKey, 'north-star-beans');
  assert.equal(candidate.dataDate, '2026-09-20');
  assert.equal(candidate.metricType, 'revenue');
  assert.equal(candidate.amount, 123456);
  assert.equal(candidate.confirmed, false);
});

test('Phase 6.6 does not invent a business target when none is explicit', () => {
  const candidate = detectManagementDataCandidate('2026年9月20日の売上は123,456円でした。');
  assert.equal(candidate.businessKey, null);
  assert.equal(candidate.confirmed, false);
});
