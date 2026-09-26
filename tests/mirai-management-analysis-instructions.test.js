const test = require('node:test');
const assert = require('node:assert/strict');
const { MIRAI_INSTRUCTIONS, userRequestedHypotheticalCalculation, stripUnsolicitedHypotheticalCalculations, extractManagementNextInputs, filterManagementNextInputsForMessage, appendManagementNextInputs } = require('../server/mirai-service');

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


test('Phase 6.28 fix extracts server-determined next registration items from management knowledge', () => {
  const knowledge = [{
    category:'経営数値',
    source:'本人確認済み経営数値',
    body:[
      '分析可能範囲（サーバー判定）:',
      '売上集計: 実行可能（売上登録1日）',
      '次に登録すると分析が広がる項目（サーバー判定）:',
      '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
      '優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。',
      '優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。',
      'データ登録状況（指標ごとの登録日数。未登録日は0値ではありません）:',
      '売上: 登録1日（2026-09-22）'
    ].join('\n')
  }];
  const items = extractManagementNextInputs(knowledge);
  assert.equal(items.length, 3);
  assert.match(items[0], /別日の売上をもう1日以上/);
});

test('Phase 6.28 fix appends missing next registration guidance deterministically', () => {
  const knowledge = [{
    category:'経営数値',
    source:'本人確認済み経営数値',
    body:[
      '次に登録すると分析が広がる項目（サーバー判定）:',
      '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
      '優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。',
      'データ登録状況（指標ごとの登録日数。未登録日は0値ではありません）:'
    ].join('\n')
  }];
  const answer = appendManagementNextInputs('売上構成は確認できます。', knowledge);
  assert.match(answer, /次に登録すると分析が広がります/);
  assert.match(answer, /別日の売上をもう1日以上登録すると/);
  assert.match(answer, /2026-09-22の経費・利益を登録すると/);
});

test('Phase 6.28 fix does not duplicate next registration guidance already present', () => {
  const knowledge = [{
    category:'経営数値',
    source:'本人確認済み経営数値',
    body:[
      '次に登録すると分析が広がる項目（サーバー判定）:',
      '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
      'データ登録状況（指標ごとの登録日数。未登録日は0値ではありません）:'
    ].join('\n')
  }];
  const original = '別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。';
  assert.equal(appendManagementNextInputs(original, knowledge), original);
});


test('Phase 6.29 narrows next-input guidance to sales when the user asks about sales trends', () => {
  const items = [
    '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
    '優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。',
    '優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。'
  ];
  const filtered = filterManagementNextInputsForMessage(items, '売上推移を分析して');
  assert.equal(filtered.length, 1);
  assert.match(filtered[0], /別日の売上/);
});

test('Phase 6.29 narrows next-input guidance to profitability when asked about profitability', () => {
  const items = [
    '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
    '優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。',
    '優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。'
  ];
  const filtered = filterManagementNextInputsForMessage(items, '収益性と利益を分析して');
  assert.equal(filtered.length, 1);
  assert.match(filtered[0], /経費・利益/);
});

test('Phase 6.29 keeps all next-input guidance for general management analysis', () => {
  const items = [
    '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
    '優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。',
    '優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。'
  ];
  const filtered = filterManagementNextInputsForMessage(items, 'NORTH STAR BEANSの経営状況を分析して');
  assert.equal(filtered.length, 3);
});

test('Phase 6.29 appends only focused next-input guidance to the answer', () => {
  const knowledge = [{
    category:'経営数値',
    source:'本人確認済み経営数値',
    body:[
      '次に登録すると分析が広がる項目（サーバー判定）:',
      '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。',
      '優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。',
      '優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。',
      'データ登録状況（指標ごとの登録日数。未登録日は0値ではありません）:'
    ].join('\n')
  }];
  const answer = appendManagementNextInputs('売上は1日分です。', knowledge, '売上推移を分析して');
  assert.match(answer, /別日の売上をもう1日以上/);
  assert.doesNotMatch(answer, /経費・利益/);
  assert.doesNotMatch(answer, /現金残高/);
});


test('Phase 6.33 extracts top-level missing-month guidance without swallowing nested month data', () => {
  const knowledge = [{
    category:'経営数値',
    source:'本人確認済み経営数値',
    body:[
      'データ未登録の月: 2026年8月',
      '次に登録すると分析が広がる項目（サーバー判定）:',
      '優先1: 2026年8月の売上を1日分以上登録すると、2026年8月を月次比較の対象にできます。',
      '月別の確認済みデータ:',
      '2026年9月:',
      '次に登録すると分析が広がる項目（サーバー判定）:',
      '優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。'
    ].join('\n')
  }];
  const items = extractManagementNextInputs(knowledge);
  assert.deepEqual(items, [
    '優先1: 2026年8月の売上を1日分以上登録すると、2026年8月を月次比較の対象にできます。'
  ]);
});

test('Phase 6.33 keeps missing-month sales guidance for a sales comparison question', () => {
  const items = [
    '優先1: 2026年8月の売上を1日分以上登録すると、2026年8月を月次比較の対象にできます。'
  ];
  const filtered = filterManagementNextInputsForMessage(items, '2026年8月と9月のNORTH STAR BEANSの売上を比較して');
  assert.equal(filtered.length, 1);
  assert.match(filtered[0], /2026年8月の売上/);
});
