const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryCandidates } = require('../server/knowledge/candidates');
const { loadConfig } = require('../server/config');

const config = loadConfig({ NODE_ENV:'test' });

test('明確な本人の新メニュー決定は、日付表現なしでも長期記憶候補にする', () => {
  const message = '新しいメニューとして抹茶プリンを販売することに決めました。';
  const candidates = memoryCandidates(message, config);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].category, '商品');
  assert.equal(candidates[0].title, '新メニューの決定');
  assert.equal(candidates[0].body, message);
});

test('不確実・AI由来・検討表現を含む新メニュー発言は、決定の末尾でも候補にしない', () => {
  for (const message of [
    '今週は新しいメニューとして抹茶プリンを販売することに決めました。',
    '新しいメニューとして抹茶プリンを販売したい',
    '新しいメニューとして抹茶プリンを販売しますか？',
    'AIの提案で、新しいメニューとして抹茶プリンを販売することに決めました。',
    '希望ですが、新しいメニューとして抹茶プリンを販売することに決めました。',
    '検討した結果、新しいメニューとして抹茶プリンを販売することに決めました。',
    '販売したいと思うので、新しいメニューとして抹茶プリンを販売することに決めました。',
    '販売するかもしれないが、新しいメニューとして抹茶プリンを販売することに決めました。'
  ]) assert.deepEqual(memoryCandidates(message, config), [], message);
});
