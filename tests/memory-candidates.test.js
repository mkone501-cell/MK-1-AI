const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryCandidates } = require('../server/knowledge/candidates');
const { loadConfig } = require('../server/config');
const config = loadConfig({ NODE_ENV:'test' });

test('本人の明確な経営上の決定だけを原文のまま登録候補にする', () => {
  for (const body of ['NORTH STAR BEANSの営業時間を平日9:00〜16:00、土日8:00〜16:00に変更する',
    '木曜日を定休日にする', 'EC＋店舗で月商300万円を目標にする']) {
    const candidates = memoryCandidates(body, config);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].body, body);
    assert.ok(candidates[0].source);
    assert.equal(candidates[0].confirmed, undefined);
  }
});

test('質問・雑談・推測・一時的発言・引用されたAI提案は候補にしない', () => {
  for (const body of ['今日は楽しかった', '営業時間を教えて', '木曜日を定休日にする？',
    '木曜日を定休日にするのはどうですか', 'たぶん木曜日を定休日にする',
    '仮に木曜日を定休日にする', '木曜日を定休日にしたい', '今週は木曜日を定休日にする',
    'AIの提案では木曜日を定休日にする', 'ミライに勧められて木曜日を定休日にする',
    '「木曜日を定休日にする」', '予定として木曜日を定休日にする',
    '明日考える。木曜日を定休日にする', '木曜日を定休日にしない']) {
    assert.deepEqual(memoryCandidates(body, config), [], body);
  }
});

test('候補生成でも秘密情報・長すぎる文章を拒否し値を返さない', () => {
  for (const secret of ['APIキー=test-placeholder', 'パスワード=example-only',
    'DATABASE_URL=postgresql://example:dummy@localhost/test', 'Cookie=dummy',
    'セッションID=dummy', 'Authorization: Bearer dummy', '秘密鍵=dummy']) {
    assert.deepEqual(memoryCandidates(`${secret}、木曜日を定休日にする`, config), []);
  }
  assert.deepEqual(memoryCandidates('店'.repeat(501) + '木曜日を定休日にする', config), []);
});
