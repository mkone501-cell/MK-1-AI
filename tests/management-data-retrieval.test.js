const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataQuery, managementDataContext, managementDataSummaryContext, managementDataComparisonContext, managementDataMonthlyComparisonContext, managementDataAnnualComparisonContext, managementDataMultiMonthContext, managementDataPeriodContext, scopeManagementAnalysisInputs, parseBusinessAndDates, parseBusinessAndMonths, parseBusinessAndMonthRange, parseBusinessAndYearMonths, parseBusinessAndYears, enumerateMonthRanges } = require('../server/management-data/query');
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


test('Phase 6.14 parses a bounded period analysis question', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月21日から9月30日までのNORTH STAR BEANSの経営状況の推移を分析して'),
    { businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-21', endDate:'2026-09-30' }
  );
  assert.equal(
    detectManagementDataQuery('2026年9月1日から10月31日までのNORTH STAR BEANSの経営状況を分析して'),
    null
  );
});

test('Phase 6.14 range lookup is owner, business, date-range and confirmation scoped', async () => {
  let seen;
  const pool = { async query(sql, params) { seen = { sql, params }; return { rows:[] }; } };
  const repo = new PostgresManagementDataRepository(pool);
  await repo.findRange('owner@example.com', {
    businessKey:'north-star-beans', startDate:'2026-09-21', endDate:'2026-09-30'
  });
  assert.deepEqual(seen.params, ['owner@example.com', 'north-star-beans', '2026-09-21', '2026-09-30']);
  assert.match(seen.sql, /BETWEEN \$3::date AND \$4::date/);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
  assert.match(seen.sql, /DISTINCT ON \(data_date, metric_type\)/);
});

test('Phase 6.14 formats saved days without treating missing dates as zero', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
  ], '2026-09-21', '2026-09-23');
  assert.match(context.body, /9月21日.*売上は150,000円/);
  assert.match(context.body, /9月22日.*売上は160,000円/);
  assert.match(context.body, /未登録日は0として扱いません/);
  assert.match(context.body, /登録済み日は2日/);
  assert.match(context.body, /登録済み2日平均/);
  assert.match(context.body, /指定期間の全日数を分母にした平均として表現しない/);
  assert.doesNotMatch(context.body, /9月23日.*0円/);
});

test('Phase 6.14 isolates period analysis from unrelated history and general knowledge', () => {
  const period = { category:'経営数値', title:'期間経営状況', body:'保存済みの日次データ', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-21', endDate:'2026-09-30' },
    history:[{ role:'user', content:'30席として計算して' }],
    knowledge:[{ category:'目標', title:'月商目標', body:'300万円' }],
    context:period
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [period]);
});


test('Phase 6.15 parses an explicit month as a period analysis', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月のNORTH STAR BEANSの経営状況を分析して'),
    { businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-01', endDate:'2026-09-30' }
  );
  assert.deepEqual(
    detectManagementDataQuery('NORTH STAR BEANSの2026/09の売上をまとめて'),
    { businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-01', endDate:'2026-09-30' }
  );
});

test('Phase 6.15 resolves month end safely including leap years', () => {
  assert.deepEqual(
    parseBusinessAndMonthRange('2028年2月のNORTH STAR BEANSの月次経営状況'),
    { businessKey:'north-star-beans', startDate:'2028-02-01', endDate:'2028-02-29' }
  );
});

test('Phase 6.15 does not turn an explicit daily question into a monthly query', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの売上はいくらですか？'),
    { businessKey:'north-star-beans', metricType:'revenue', dataDate:'2026-09-22' }
  );
});


test('Phase 6.16 parses two explicit months for comparison', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年8月と9月のNORTH STAR BEANSの経営状況を比較して'),
    {
      businessKey:'north-star-beans',
      metricType:'monthly_comparison',
      months:[
        { year:2026, month:8, startDate:'2026-08-01', endDate:'2026-08-31', label:'2026年8月' },
        { year:2026, month:9, startDate:'2026-09-01', endDate:'2026-09-30', label:'2026年9月' }
      ]
    }
  );
  assert.deepEqual(
    parseBusinessAndMonths('NORTH STAR BEANSの2026/08と2026/09を比べて').months.map(item => item.label),
    ['2026年8月','2026年9月']
  );
});

test('Phase 6.16 does not confuse two daily dates with two months', () => {
  assert.equal(
    detectManagementDataQuery('2026年9月21日と9月22日のNORTH STAR BEANSの経営状況を比較して').metricType,
    'daily_comparison'
  );
});

test('Phase 6.16 formats two monthly confirmed-data ranges without inventing missing days', () => {
  const context = managementDataMonthlyComparisonContext([
    {
      label:'2026年8月', startDate:'2026-08-01', endDate:'2026-08-31',
      entries:[{ business_key:'north-star-beans', data_date:'2026-08-31', metric_type:'revenue', amount:'140000', currency:'JPY' }]
    },
    {
      label:'2026年9月', startDate:'2026-09-01', endDate:'2026-09-30',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ]);
  assert.match(context.body, /2026年8月/);
  assert.match(context.body, /登録済み日は1日/);
  assert.match(context.body, /2026年9月/);
  assert.match(context.body, /登録済み日は2日/);
  assert.match(context.body, /未登録日は0として扱わず/);
  assert.match(context.body, /単純な月間合計の優劣を断定しない/);
});

test('Phase 6.16 isolates monthly comparison from unrelated history and general knowledge', () => {
  const comparison = { category:'経営数値', title:'月次経営状況の比較', body:'8月と9月の確認済みデータ', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'monthly_comparison', months:[] },
    history:[{ role:'user', content:'月商目標300万円と比べて' }],
    knowledge:[{ category:'店舗', title:'座席数', body:'30席' }],
    context:comparison
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [comparison]);
});


test('Phase 6.17 parses an explicit month range into every month up to 12 months', () => {
  const query = detectManagementDataQuery('2026年7月から9月までのNORTH STAR BEANSの経営状況の推移を分析して');
  assert.equal(query.metricType, 'monthly_period_analysis');
  assert.deepEqual(query.months.map(item => item.label), ['2026年7月','2026年8月','2026年9月']);
  assert.deepEqual(query.months.map(item => [item.startDate,item.endDate]), [
    ['2026-07-01','2026-07-31'],
    ['2026-08-01','2026-08-31'],
    ['2026-09-01','2026-09-30']
  ]);
});

test('Phase 6.17 rejects reversed or more-than-12-month ranges', () => {
  assert.deepEqual(enumerateMonthRanges(
    { year:2026, month:9 },
    { year:2026, month:7 }
  ), []);
  assert.deepEqual(enumerateMonthRanges(
    { year:2025, month:1 },
    { year:2026, month:1 }
  ), []);
  assert.equal(
    detectManagementDataQuery('2025年1月から2026年1月までのNORTH STAR BEANSの推移を分析して'),
    null
  );
});

test('Phase 6.17 keeps missing months explicit without converting them to zero', () => {
  const context = managementDataMultiMonthContext([
    { label:'2026年7月', startDate:'2026-07-01', endDate:'2026-07-31', entries:[] },
    { label:'2026年8月', startDate:'2026-08-01', endDate:'2026-08-31', entries:[] },
    {
      label:'2026年9月', startDate:'2026-09-01', endDate:'2026-09-30',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ]);
  assert.match(context.body, /データ未登録の月: 2026年7月、2026年8月/);
  assert.match(context.body, /2026年9月/);
  assert.match(context.body, /登録済み日は2日/);
  assert.match(context.body, /未登録日・未登録月は0として扱わない/);
});

test('Phase 6.17 isolates multi-month trend analysis from unrelated context', () => {
  const period = { category:'経営数値', title:'複数月の経営推移', body:'確認済みデータのみ', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'monthly_period_analysis', months:[] },
    history:[{ role:'user', content:'毎月26営業日として計算して' }],
    knowledge:[{ category:'目標', title:'月商目標', body:'300万円' }],
    context:period
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [period]);
});


test('Phase 6.18 parses an explicit calendar year into all 12 months', () => {
  const query = detectManagementDataQuery('2026年のNORTH STAR BEANSの経営状況を分析して');
  assert.equal(query.metricType, 'monthly_period_analysis');
  assert.equal(query.months.length, 12);
  assert.equal(query.months[0].label, '2026年1月');
  assert.equal(query.months[11].label, '2026年12月');
  assert.deepEqual(
    query.months.map(item => [item.startDate,item.endDate]).slice(0, 2),
    [['2026-01-01','2026-01-31'],['2026-02-01','2026-02-28']]
  );
});

test('Phase 6.18 year parser does not shadow explicit month or date questions', () => {
  assert.equal(parseBusinessAndYearMonths('2026年9月のNORTH STAR BEANSの経営状況'), null);
  assert.equal(parseBusinessAndYearMonths('2026年9月22日のNORTH STAR BEANSの売上'), null);
  assert.equal(
    detectManagementDataQuery('2026年9月のNORTH STAR BEANSの経営状況を分析して').metricType,
    'period_analysis'
  );
  assert.equal(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの売上はいくらですか？').metricType,
    'revenue'
  );
});

test('Phase 6.18 annual analysis inherits missing-month safety through monthly trend context', () => {
  const year = parseBusinessAndYearMonths('2026年のNORTH STAR BEANSの年間推移を分析して');
  assert.equal(year.months.length, 12);
  const context = managementDataMultiMonthContext(year.months.map(month => ({
    ...month,
    entries:month.month === 9 ? [
      { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' }
    ] : []
  })));
  assert.match(context.body, /データ未登録の月:/);
  assert.match(context.body, /2026年1月/);
  assert.match(context.body, /2026年8月/);
  assert.match(context.body, /2026年9月/);
  assert.match(context.body, /登録済み日は1日/);
  assert.match(context.body, /未登録日・未登録月は0として扱わない/);
});


test('Phase 6.19 parses two explicit calendar years for comparison', () => {
  assert.deepEqual(
    detectManagementDataQuery('2025年と2026年のNORTH STAR BEANSの経営状況を比較して'),
    {
      businessKey:'north-star-beans',
      metricType:'annual_comparison',
      years:[
        { year:2025, startDate:'2025-01-01', endDate:'2025-12-31', label:'2025年' },
        { year:2026, startDate:'2026-01-01', endDate:'2026-12-31', label:'2026年' }
      ]
    }
  );
  assert.deepEqual(
    parseBusinessAndYears('2025年と2026年のNORTH STAR BEANSを比べて').years.map(item => item.label),
    ['2025年','2026年']
  );
});

test('Phase 6.19 does not confuse explicit month or date comparisons with years', () => {
  assert.equal(
    detectManagementDataQuery('2026年8月と9月のNORTH STAR BEANSの経営状況を比較して').metricType,
    'monthly_comparison'
  );
  assert.equal(
    detectManagementDataQuery('2026年9月21日と9月22日のNORTH STAR BEANSの経営状況を比較して').metricType,
    'daily_comparison'
  );
});

test('Phase 6.19 keeps missing years explicit and does not treat them as zero', () => {
  const context = managementDataAnnualComparisonContext([
    { label:'2025年', startDate:'2025-01-01', endDate:'2025-12-31', entries:[] },
    {
      label:'2026年', startDate:'2026-01-01', endDate:'2026-12-31',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ]);
  assert.match(context.body, /データ未登録の年: 2025年/);
  assert.match(context.body, /2026年/);
  assert.match(context.body, /登録済み日は2日/);
  assert.match(context.body, /未登録日・未登録年は0として扱わない/);
  assert.match(context.body, /単純な年間合計だけで増減や良し悪しを断定しない/);
});

test('Phase 6.19 isolates annual comparison from unrelated context', () => {
  const comparison = { category:'経営数値', title:'年次経営状況の比較', body:'確認済み年次データ', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'annual_comparison', years:[] },
    history:[{ role:'user', content:'年間営業日を300日として計算して' }],
    knowledge:[{ category:'目標', title:'年商目標', body:'3600万円' }],
    context:comparison
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [comparison]);
});
