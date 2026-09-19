const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryCandidates } = require('../server/knowledge/candidates');
const { loadConfig } = require('../server/config');

const config = loadConfig({ NODE_ENV:'test' });

test('今日決めた新メニューは長期記憶候補にする', () => {
  const message = '今日は新しいメニューとして抹茶プリンを販売することに決めました。';
  const candidates = memoryCandidates(message, config);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].category, '商品');
  assert.equal(candidates[0].title, '新メニューの決定');
  assert.equal(candidates[0].body, message);
});

test('一時販売や希望は新メニュー候補にしない', () => {
  for (const message of [
    '今週は新しいメニューとして抹茶プリンを販売することに決めました。',
    '新しいメニューとして抹茶プリンを販売したい',
    '新しいメニューとして抹茶プリンを販売しますか？'
  ]) assert.deepEqual(memoryCandidates(message, config), [], message);
});
