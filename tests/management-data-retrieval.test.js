const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataQuery, managementDataContext, managementDataSummaryContext, managementDataComparisonContext, scopeManagementAnalysisInputs, parseBusinessAndDates } = require('../server/management-data/query');
const { PostgresManagementDataRepository } = require('../server/management-data/postgres-management-data-repository');

test('Phase 6.7 parses a confirmed management-data fact question', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月21日のNORTH STAR BEANSの売上はいくらですか？'),
    { businessKey:'north-star-beans', metricType:'revenue', dataDate:'2026-09-21' }
  );
});

test('Phase 6.7 does not query without an explicit business target', () => {
  assert.equal(detectManagementDataQuery('2026年9月21日の売上はいくらですか？'), null);
});

test('Phase 6.7 formats confirmed management data as Mirai reference context', () => {
  const context = managementDataContext({
    business_key:'north-star-beans', data_date:'2026-09-21',
    metric_type:'revenue', amount:'150000', currency:'JPY'
  });
  assert.equal(context.body, '9月21日のNORTH STAR BEANSの売上は150,000円です。');
  assert.equal(context.source, '本人確認済み経営数値');
});

test('Phase 6.7 exact lookup is owner, business, date and metric scoped', async () => {
  let seen;
  const pool = {
    async query(sql, params) {
      seen = { sql, params };
      return { rows:[{ amount:'150000' }] };
    }
  };
  const repo = new PostgresManagementDataRepository(pool);
  const row = await repo.findExact('owner@example.com', {
    businessKey:'north-star-beans', dataDate:'2026-09-21', metricType:'revenue'
  });
  assert.equal(row.amount, '150000');
  assert.deepEqual(seen.params, ['owner@example.com', 'north-star-beans', '2026-09-21', 'revenue']);
  assert.match(seen.sql, /data_date = \$3::date/);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
});


test('Phase 6.7 formats PostgreSQL Date values without dropping confirmed data', () => {
  const context = managementDataContext({
    business_key:'north-star-beans', data_date:new Date('2026-09-21T00:00:00.000Z'),
    metric_type:'revenue', amount:'150000', currency:'JPY'
  });
  assert.equal(context.body, '9月21日のNORTH STAR BEANSの売上は150,000円です。');
});


test('Phase 6.8 parses additional management metric questions', () => {
  assert.equal(detectManagementDataQuery('2026年9月21日のNORTH STAR BEANSの来客数は何人ですか？').metricType, 'customers');
  assert.equal(detectManagementDataQuery('2026年9月21日のNORTH STAR BEANSの客単価はいくらですか？').metricType, 'average_spend');
  assert.equal(detectManagementDataQuery('2026年9月21日のNORTH STAR BEANSの経費はいくらですか？').metricType, 'expense');
  assert.equal(detectManagementDataQuery('2026年9月21日のNORTH STAR BEANSの利益はいくらですか？').metricType, 'profit');
});

test('Phase 6.8 formats customer count as people', () => {
  const context = managementDataContext({ business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'customers', amount:'80', currency:'COUNT' });
  assert.equal(context.body, '9月21日のNORTH STAR BEANSの来客数は80人です。');
});


test('Phase 6.11 parses a daily management summary question', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの経営状況を教えて'),
    { businessKey:'north-star-beans', metricType:'daily_summary', dataDate:'2026-09-22' }
  );
});

test('Phase 6.11 daily lookup only returns owner-confirmed rows for the requested business and date', async () => {
  let seen;
  const pool = { async query(sql, params) { seen = { sql, params }; return { rows:[] }; } };
  const repo = new PostgresManagementDataRepository(pool);
  await repo.findDaily('owner@example.com', { businessKey:'north-star-beans', dataDate:'2026-09-22' });
  assert.deepEqual(seen.params, ['owner@example.com', 'north-star-beans', '2026-09-22']);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
  assert.match(seen.sql, /DISTINCT ON \(metric_type\)/);
});

test('Phase 6.11 formats multiple confirmed daily metrics as one Mirai context', () => {
  const context = managementDataSummaryContext([
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ]);
  assert.match(context.body, /売上は160,000円/);
  assert.match(context.body, /来客数は80人/);
  assert.match(context.body, /客単価は2,000円/);
  assert.equal(context.source, '本人確認済み経営数値');
});


test('Phase 6.12 parses a daily management analysis question', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの経営状況を分析して'),
    { businessKey:'north-star-beans', metricType:'daily_analysis', dataDate:'2026-09-22' }
  );
});

test('Phase 6.12 keeps ordinary daily summary questions as summaries', () => {
  assert.equal(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの経営状況を教えて').metricType,
    'daily_summary'
  );
});


test('Phase 6.12 fix isolates daily analysis from conversation history and general knowledge', () => {
  const dailyContext = { category:'経営数値', title:'日次経営状況 2026/09/22', body:'売上160,000円、来客数80人、客単価2,000円', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'daily_analysis', dataDate:'2026-09-22' },
    history:[{ role:'user', content:'月の営業日は26日と仮定して' }],
    knowledge:[{ category:'店舗', title:'座席数', body:'30席' }, { category:'目標', title:'月商目標', body:'300万円' }],
    context:dailyContext
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [dailyContext]);
});

test('Phase 6.12 fix keeps normal daily summary context behavior', () => {
  const history = [{ role:'user', content:'前の質問' }];
  const knowledge = [{ category:'店舗', title:'営業時間', body:'9時から16時' }];
  const dailyContext = { category:'経営数値', title:'日次経営状況 2026/09/22', body:'売上160,000円', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'daily_summary', dataDate:'2026-09-22' },
    history, knowledge, context:dailyContext
  });
  assert.deepEqual(scoped.history, history);
  assert.deepEqual(scoped.knowledge, [...knowledge, dailyContext]);
});


test('Phase 6.13 parses two dates for a daily comparison', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月21日と9月22日のNORTH STAR BEANSの経営状況を比較して'),
    { businessKey:'north-star-beans', metricType:'daily_comparison', dataDates:['2026-09-21','2026-09-22'] }
  );
  assert.deepEqual(
    parseBusinessAndDates('NORTH STAR BEANSの2026/09/21と2026/09/22を比べて').dataDates,
    ['2026-09-21','2026-09-22']
  );
});

test('Phase 6.13 formats two confirmed days into one comparison context', () => {
  const context = managementDataComparisonContext([
    { dataDate:'2026-09-21', entries:[
      { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
      { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'customers', amount:'75', currency:'COUNT' }
    ] },
    { dataDate:'2026-09-22', entries:[
      { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
      { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
    ] }
  ]);
  assert.match(context.body, /9月21日.*売上は150,000円/);
  assert.match(context.body, /9月22日.*売上は160,000円/);
  assert.match(context.body, /来客数は75人/);
  assert.match(context.body, /来客数は80人/);
});

test('Phase 6.13 isolates comparison from unrelated history and general knowledge', () => {
  const comparison = { category:'経営数値', title:'日次経営状況の比較', body:'9月21日...\n9月22日...', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'daily_comparison', dataDates:['2026-09-21','2026-09-22'] },
    history:[{ role:'user', content:'26営業日で計算して' }],
    knowledge:[{ category:'店舗', title:'座席数', body:'30席' }],
    context:comparison
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [comparison]);
});
