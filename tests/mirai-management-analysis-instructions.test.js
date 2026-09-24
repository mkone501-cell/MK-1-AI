const test = require('node:test');
const assert = require('node:assert/strict');
const { MIRAI_INSTRUCTIONS, userRequestedHypotheticalCalculation, stripUnsolicitedHypotheticalCalculations } = require('../server/mirai-service');

test('Phase 6.21 fix forbids unsolicited hypothetical fills for missing management metrics', () => {
  assert.match(MIRAI_INSTRUCTIONS, /明示的に「仮定して」「もし〜なら」などのシナリオ計算を求めた場合を除き/);
  assert.match(MIRAI_INSTRUCTIONS, /別日の値・平均値・推測値で補完して計算しない/);
  assert.match(MIRAI_INSTRUCTIONS, /参考試算や仮定値を自発的に追加しない/);
});


test('Phase 6.21 fix 2 strips unsolicited hypothetical calculations but keeps confirmed analysis', () => {
  const answer = [
    '9月の登録済み売上合計は310,000円、登録済み2日平均は155,000円です。',
    '9/21の来客数は未登録です。仮に9/22と同じ客単価2,000円として換算すると75人になります。',
    '月次傾向を判断するにはデータが不足しています。'
  ].join('\n');
  const cleaned = stripUnsolicitedHypotheticalCalculations(answer);
  assert.match(cleaned, /売上合計は310,000円/);
  assert.match(cleaned, /9\/21の来客数は未登録です/);
  assert.doesNotMatch(cleaned, /75人/);
  assert.doesNotMatch(cleaned, /仮に/);
  assert.match(cleaned, /月次傾向を判断するにはデータが不足/);
});

test('Phase 6.21 fix 2 recognizes explicit user requests for scenario calculations', () => {
  assert.equal(userRequestedHypotheticalCalculation('9/21の客単価を2,000円と仮定して来客数を計算して'), true);
  assert.equal(userRequestedHypotheticalCalculation('もし客単価が2,000円なら何人ですか'), true);
  assert.equal(userRequestedHypotheticalCalculation('2026年9月の経営状況を分析して'), false);
});
