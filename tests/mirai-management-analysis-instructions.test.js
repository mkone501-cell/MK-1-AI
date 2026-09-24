const test = require('node:test');
const assert = require('node:assert/strict');
const { MIRAI_INSTRUCTIONS } = require('../server/mirai-service');

test('Phase 6.21 fix forbids unsolicited hypothetical fills for missing management metrics', () => {
  assert.match(MIRAI_INSTRUCTIONS, /明示的に「仮定して」「もし〜なら」などのシナリオ計算を求めた場合を除き/);
  assert.match(MIRAI_INSTRUCTIONS, /別日の値・平均値・推測値で補完して計算しない/);
  assert.match(MIRAI_INSTRUCTIONS, /参考試算や仮定値を自発的に追加しない/);
});
