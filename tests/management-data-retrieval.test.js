const test = require('node:test');
const assert = require('node:assert/strict');
const { detectManagementDataQuery, detectManagementAnalysisFocus, managementDataContext, managementDataSummaryContext, managementDataComparisonContext, managementDataComparisonMetrics, managementDataMonthlyComparisonContext, managementDataAnnualComparisonContext, managementDataMultiMonthContext, managementDataMultiYearContext, managementDataFocusedMultiMonthContext, managementDataFocusedMultiYearContext, managementDataFocusedGroupComparisonMetrics, managementDataMissingPeriodNextInputs, managementDataPeriodContext, managementDataFocusedPeriodContext, managementDataPeriodAggregates, managementDataPeriodTrendMetrics, managementDataPeriodCompleteness, managementDataConsistencyChecks, managementDataAnalysisReadiness, managementDataNextRequiredInputs, scopeManagementAnalysisInputs, parseBusinessAndDates, parseBusinessAndMonths, parseBusinessAndMonthRange, parseBusinessAndYearMonths, parseBusinessAndYears, enumerateMonthRanges, enumerateYearRanges } = require('../server/management-data/query');
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


test('Phase 6.20 parses an explicit year range into every year up to five years', () => {
  const query = detectManagementDataQuery('2023年から2026年までのNORTH STAR BEANSの経営状況の推移を分析して');
  assert.equal(query.metricType, 'annual_period_analysis');
  assert.deepEqual(query.years.map(item => item.label), ['2023年','2024年','2025年','2026年']);
  assert.deepEqual(query.years.map(item => [item.startDate,item.endDate]), [
    ['2023-01-01','2023-12-31'],
    ['2024-01-01','2024-12-31'],
    ['2025-01-01','2025-12-31'],
    ['2026-01-01','2026-12-31']
  ]);
});

test('Phase 6.20 rejects reversed or more-than-five-year ranges', () => {
  assert.deepEqual(enumerateYearRanges({ year:2026 }, { year:2023 }), []);
  assert.deepEqual(enumerateYearRanges({ year:2021 }, { year:2026 }), []);
  assert.equal(
    detectManagementDataQuery('2021年から2026年までのNORTH STAR BEANSの推移を分析して'),
    null
  );
});

test('Phase 6.20 keeps missing years explicit without converting them to zero', () => {
  const context = managementDataMultiYearContext([
    { label:'2024年', startDate:'2024-01-01', endDate:'2024-12-31', entries:[] },
    { label:'2025年', startDate:'2025-01-01', endDate:'2025-12-31', entries:[] },
    {
      label:'2026年', startDate:'2026-01-01', endDate:'2026-12-31',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ]);
  assert.match(context.body, /データ未登録の年: 2024年、2025年/);
  assert.match(context.body, /2026年/);
  assert.match(context.body, /登録済み日は2日/);
  assert.match(context.body, /未登録日・未登録年は0として扱わない/);
});

test('Phase 6.20 isolates multi-year trend analysis from unrelated context', () => {
  const period = { category:'経営数値', title:'複数年の経営推移', body:'確認済みデータのみ', source:'本人確認済み経営数値' };
  const scoped = scopeManagementAnalysisInputs({
    query:{ businessKey:'north-star-beans', metricType:'annual_period_analysis', years:[] },
    history:[{ role:'user', content:'年間営業日を300日として計算して' }],
    knowledge:[{ category:'目標', title:'年商目標', body:'3600万円' }],
    context:period
  });
  assert.deepEqual(scoped.history, []);
  assert.deepEqual(scoped.knowledge, [period]);
});


test('Phase 6.21 computes additive period metrics deterministically', () => {
  const lines = managementDataPeriodAggregates([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
  ]);
  assert.ok(lines.includes('売上: 登録済み2日分の合計310,000円、登録済み2日平均155,000円'));
  assert.ok(lines.includes('来客数: 登録済み1日分の合計80人、登録済み1日平均80人'));
});

test('Phase 6.21 averages average-spend and keeps cash balance as latest value', () => {
  const lines = managementDataPeriodAggregates([
    { data_date:'2026-09-21', metric_type:'average_spend', amount:'1800', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' },
    { data_date:'2026-09-21', metric_type:'cash_balance', amount:'900000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'cash_balance', amount:'950000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('客単価: 登録済み2日平均1,900円'));
  assert.ok(lines.includes('現金残高: 最新の登録値950,000円'));
  assert.equal(lines.some(line => /客単価.*合計/.test(line)), false);
  assert.equal(lines.some(line => /現金残高.*合計/.test(line)), false);
});

test('Phase 6.21 period context includes server-calculated aggregates before daily facts', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
  ], '2026-09-01', '2026-09-30');
  assert.match(context.body, /サーバー計算済み集計（再計算せずこの値を使用）/);
  assert.match(context.body, /売上: 登録済み2日分の合計310,000円、登録済み2日平均155,000円/);
  assert.match(context.body, /日別の確認済みデータ/);
  assert.doesNotMatch(context.body, /指定期間の全日数を分母にした平均として表現しないでください。\n9月21日/);
});

test('Phase 6.21 fix tells analysis not to fill missing metrics with another day assumptions', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ], '2026-09-01', '2026-09-30');
  assert.match(context.body, /明示的に仮定計算を求めていない限り/);
  assert.match(context.body, /不足している指標を別日の値や推測値で補完して試算しない/);
});


test('Phase 6.22 computes daily comparison differences deterministically', () => {
  const lines = managementDataComparisonMetrics([
    { dataDate:'2026-09-21', entries:[
      { metric_type:'revenue', amount:'150000', currency:'JPY' },
      { metric_type:'customers', amount:'75', currency:'COUNT' }
    ] },
    { dataDate:'2026-09-22', entries:[
      { metric_type:'revenue', amount:'160000', currency:'JPY' },
      { metric_type:'customers', amount:'80', currency:'COUNT' }
    ] }
  ]);
  assert.ok(lines.includes('売上: 2026-09-21の150,000円 → 2026-09-22の160,000円、差+10,000円、増減率+6.67%'));
  assert.ok(lines.includes('来客数: 2026-09-21の75人 → 2026-09-22の80人、差+5人、増減率+6.67%'));
});

test('Phase 6.22 skips metrics missing on either comparison day', () => {
  const lines = managementDataComparisonMetrics([
    { dataDate:'2026-09-21', entries:[
      { metric_type:'revenue', amount:'150000', currency:'JPY' }
    ] },
    { dataDate:'2026-09-22', entries:[
      { metric_type:'revenue', amount:'160000', currency:'JPY' },
      { metric_type:'average_spend', amount:'2000', currency:'JPY' }
    ] }
  ]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^売上:/);
  assert.equal(lines.some(line => /客単価/.test(line)), false);
});

test('Phase 6.22 handles a zero comparison base without inventing a percentage', () => {
  const lines = managementDataComparisonMetrics([
    { dataDate:'2026-09-21', entries:[{ metric_type:'revenue', amount:'0', currency:'JPY' }] },
    { dataDate:'2026-09-22', entries:[{ metric_type:'revenue', amount:'10000', currency:'JPY' }] }
  ]);
  assert.match(lines[0], /差\+10,000円/);
  assert.match(lines[0], /増減率は基準値0のため算出不可/);
});

test('Phase 6.22 daily comparison context includes server-calculated delta before facts', () => {
  const context = managementDataComparisonContext([
    { dataDate:'2026-09-21', entries:[
      { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' }
    ] },
    { dataDate:'2026-09-22', entries:[
      { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
    ] }
  ]);
  assert.match(context.body, /サーバー計算済み差分（再計算せずこの値を使用）/);
  assert.match(context.body, /差\+10,000円、増減率\+6.67%/);
  assert.match(context.body, /日別の本人確認済みデータ/);
});


test('Phase 6.23 computes first-to-last period changes deterministically', () => {
  const lines = managementDataPeriodTrendMetrics([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('売上: 2026-09-21の150,000円 → 2026-09-22の160,000円、差+10,000円、増減率+6.67%'));
});

test('Phase 6.23 skips trend calculation for metrics registered on only one day', () => {
  const lines = managementDataPeriodTrendMetrics([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
  ]);
  assert.equal(lines.some(line => /来客数/.test(line)), false);
  assert.equal(lines.some(line => /売上/.test(line)), true);
});

test('Phase 6.23 period context includes server-calculated first-to-last change', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
  ], '2026-09-01', '2026-09-30');
  assert.match(context.body, /サーバー計算済み期間内差分（再計算せずこの値を使用）/);
  assert.match(context.body, /差\+10,000円、増減率\+6.67%/);
});

test('Phase 6.23 handles zero first value without fabricating a rate', () => {
  const lines = managementDataPeriodTrendMetrics([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'0', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'10000', currency:'JPY' }
  ]);
  assert.match(lines[0], /差\+10,000円/);
  assert.match(lines[0], /増減率は基準値0のため算出不可/);
});


test('Phase 6.24 counts registered days by metric without treating missing days as zero', () => {
  const lines = managementDataPeriodCompleteness([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('売上: 登録2日（2026-09-21〜2026-09-22）'));
  assert.ok(lines.includes('来客数: 登録1日（2026-09-22）'));
  assert.ok(lines.includes('客単価: 登録1日（2026-09-22）'));
  assert.ok(lines.includes('経費: 登録0日'));
  assert.ok(lines.includes('利益: 登録0日'));
});

test('Phase 6.24 de-duplicates multiple metrics rows from the same day when counting coverage', () => {
  const lines = managementDataPeriodCompleteness([
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('売上: 登録1日（2026-09-22）'));
});

test('Phase 6.24 period context exposes metric coverage before aggregates', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
  ], '2026-09-01', '2026-09-30');
  assert.match(context.body, /データ登録状況（指標ごとの登録日数。未登録日は0値ではありません）/);
  assert.match(context.body, /売上: 登録2日/);
  assert.match(context.body, /来客数: 登録1日/);
  assert.match(context.body, /客単価: 登録0日/);
});


test('Phase 6.25 checks revenue against customers times average spend deterministically', () => {
  const lines = managementDataConsistencyChecks([
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('2026-09-22 売上整合性: 80人 × 2,000円 = 160,000円、登録売上160,000円（一致）'));
});

test('Phase 6.25 reports a numeric gap instead of declaring inconsistent data invalid', () => {
  const lines = managementDataConsistencyChecks([
    { data_date:'2026-09-22', metric_type:'revenue', amount:'159000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ]);
  assert.match(lines[0], /登録売上159,000円（差-1,000円）/);
});

test('Phase 6.25 checks profit against revenue minus expense when all three exist', () => {
  const lines = managementDataConsistencyChecks([
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'expense', amount:'90000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'profit', amount:'70000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('2026-09-22 利益整合性: 売上160,000円 - 経費90,000円 = 70,000円、登録利益70,000円（一致）'));
});

test('Phase 6.25 skips consistency checks when required metrics are missing', () => {
  const lines = managementDataConsistencyChecks([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' }
  ]);
  assert.deepEqual(lines, []);
});

test('Phase 6.25 period context includes server-calculated consistency checks', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ], '2026-09-01', '2026-09-30');
  assert.match(context.body, /サーバー計算済み整合性確認（再計算せずこの値を使用）/);
  assert.match(context.body, /80人 × 2,000円 = 160,000円、登録売上160,000円（一致）/);
});


test('Phase 6.27 reports what analyses are possible from the registered metrics', () => {
  const lines = managementDataAnalysisReadiness([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('売上集計: 実行可能（売上登録2日）'));
  assert.ok(lines.includes('売上推移: 実行可能（売上登録2日）'));
  assert.ok(lines.includes('来客数・客単価・売上の関係: 実行可能（同日登録1日）'));
  assert.ok(lines.includes('収益性確認: データ不足（売上・経費・利益の同日登録が必要）'));
  assert.ok(lines.includes('現金残高確認: データ不足（現金残高未登録）'));
});

test('Phase 6.27 requires same-day overlap for relationship and profitability analysis', () => {
  const lines = managementDataAnalysisReadiness([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { data_date:'2026-09-23', metric_type:'average_spend', amount:'2000', currency:'JPY' },
    { data_date:'2026-09-24', metric_type:'expense', amount:'90000', currency:'JPY' },
    { data_date:'2026-09-25', metric_type:'profit', amount:'60000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('来客数・客単価・売上の関係: データ不足（3指標の同日登録が必要）'));
  assert.ok(lines.includes('収益性確認: データ不足（売上・経費・利益の同日登録が必要）'));
});

test('Phase 6.27 period context exposes server analysis-readiness guidance', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ], '2026-09-22', '2026-09-22');
  assert.match(context.body, /分析可能範囲（サーバー判定）/);
  assert.match(context.body, /売上集計: 実行可能/);
  assert.match(context.body, /売上推移: データ不足/);
  assert.match(context.body, /収益性確認: データ不足/);
});


test('Phase 6.28 recommends the next concrete registrations for a single-day data set', () => {
  const lines = managementDataNextRequiredInputs([
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。'));
  assert.ok(lines.includes('優先3: 2026-09-22の経費・利益を登録すると、収益性の確認が可能になります。'));
  assert.ok(lines.includes('優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。'));
  assert.equal(lines.some(line => /来客数・客単価を登録/.test(line)), false);
});

test('Phase 6.28 recommends missing traffic metrics on the latest revenue date', () => {
  const lines = managementDataNextRequiredInputs([
    { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
    { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
  ]);
  assert.ok(lines.includes('優先2: 2026-09-22の来客数・客単価を登録すると、来客数・客単価・売上の関係を確認できます。'));
});

test('Phase 6.28 period context exposes next required inputs after readiness', () => {
  const context = managementDataPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ], '2026-09-22', '2026-09-22');
  assert.match(context.body, /次に登録すると分析が広がる項目（サーバー判定）/);
  assert.match(context.body, /別日の売上をもう1日以上登録すると/);
  assert.match(context.body, /2026-09-22の経費・利益を登録すると/);
  assert.match(context.body, /現金残高を1日分登録すると/);
});


test('Phase 6.29 fix routes focused daily sales analysis through daily_analysis', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの売上推移を分析して'),
    { businessKey:'north-star-beans', metricType:'daily_analysis', dataDate:'2026-09-22' }
  );
});

test('Phase 6.29 fix routes focused daily profitability analysis through daily_analysis', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの収益性と利益を分析して'),
    { businessKey:'north-star-beans', metricType:'daily_analysis', dataDate:'2026-09-22' }
  );
});

test('Phase 6.29 fix keeps plain daily metric fact lookup exact', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの売上はいくらですか？'),
    { businessKey:'north-star-beans', metricType:'revenue', dataDate:'2026-09-22' }
  );
});


test('Phase 6.30 marks focused daily sales analysis with sales focus', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月22日のNORTH STAR BEANSの売上推移を分析して'),
    { businessKey:'north-star-beans', metricType:'daily_analysis', dataDate:'2026-09-22', analysisFocus:'sales' }
  );
});

test('Phase 6.30 focused sales context omits unrelated management metrics', () => {
  const context = managementDataFocusedPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'average_spend', amount:'2000', currency:'JPY' }
  ], '2026-09-22', '2026-09-22', 'sales');
  assert.match(context.body, /ユーザーは売上に絞った分析を求めています/);
  assert.match(context.body, /売上推移: データ不足/);
  assert.match(context.body, /別日の売上をもう1日以上登録すると/);
  assert.doesNotMatch(context.body, /来客数80人/);
  assert.doesNotMatch(context.body, /客単価2,000円/);
  assert.doesNotMatch(context.body, /収益性確認/);
  assert.doesNotMatch(context.body, /現金残高確認/);
});

test('Phase 6.30 focused profitability context keeps only profitability-related facts', () => {
  const context = managementDataFocusedPeriodContext([
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'expense', amount:'90000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'profit', amount:'70000', currency:'JPY' },
    { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
  ], '2026-09-22', '2026-09-22', 'profit');
  assert.match(context.body, /ユーザーは収益性に絞った分析を求めています/);
  assert.match(context.body, /利益整合性/);
  assert.doesNotMatch(context.body, /来客数80人/);
});


test('Phase 6.31 detects focused analysis domain consistently', () => {
  assert.equal(detectManagementAnalysisFocus('売上推移を分析して'), 'sales');
  assert.equal(detectManagementAnalysisFocus('収益性を分析して'), 'profit');
  assert.equal(detectManagementAnalysisFocus('来客数と客単価を分析して'), 'traffic');
  assert.equal(detectManagementAnalysisFocus('現金残高を分析して'), 'cash');
  assert.equal(detectManagementAnalysisFocus('経営状況を分析して'), null);
});

test('Phase 6.31 attaches sales focus to a single-month sales analysis', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月のNORTH STAR BEANSの売上を分析して'),
    { businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-01', endDate:'2026-09-30', analysisFocus:'sales' }
  );
});

test('Phase 6.31 attaches sales focus to an explicit date-range sales analysis', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月21日から9月22日までのNORTH STAR BEANSの売上推移を分析して'),
    { businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-21', endDate:'2026-09-22', analysisFocus:'sales' }
  );
});

test('Phase 6.31 keeps general monthly management analysis unfocused', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年9月のNORTH STAR BEANSの経営状況を分析して'),
    { businessKey:'north-star-beans', metricType:'period_analysis', startDate:'2026-09-01', endDate:'2026-09-30' }
  );
});


test('Phase 6.32 attaches sales focus to monthly comparison', () => {
  assert.deepEqual(
    detectManagementDataQuery('2026年8月と9月のNORTH STAR BEANSの売上を比較して'),
    {
      businessKey:'north-star-beans',
      metricType:'monthly_comparison',
      months:[
        { year:2026, month:8, startDate:'2026-08-01', endDate:'2026-08-31', label:'2026年8月' },
        { year:2026, month:9, startDate:'2026-09-01', endDate:'2026-09-30', label:'2026年9月' }
      ],
      analysisFocus:'sales'
    }
  );
});

test('Phase 6.32 attaches sales focus to multi-month trend analysis', () => {
  const query = detectManagementDataQuery('2026年7月から9月までのNORTH STAR BEANSの売上推移を分析して');
  assert.equal(query.metricType, 'monthly_period_analysis');
  assert.equal(query.analysisFocus, 'sales');
  assert.equal(query.months.length, 3);
});

test('Phase 6.32 attaches profit focus to annual comparison', () => {
  const query = detectManagementDataQuery('2025年と2026年のNORTH STAR BEANSの収益性を比較して');
  assert.equal(query.metricType, 'annual_comparison');
  assert.equal(query.analysisFocus, 'profit');
});

test('Phase 6.32 focused multi-month context omits unrelated metrics', () => {
  const context = managementDataFocusedMultiMonthContext([
    {
      label:'2026年9月', startDate:'2026-09-01', endDate:'2026-09-30',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
      ]
    }
  ], 'sales');
  assert.match(context.body, /売上に絞った月ごとの推移分析/);
  assert.match(context.body, /150,000円/);
  assert.match(context.body, /160,000円/);
  assert.doesNotMatch(context.body, /来客数80人/);
});

test('Phase 6.32 focused multi-year comparison omits unrelated metrics', () => {
  const context = managementDataFocusedMultiYearContext([
    {
      label:'2026年', startDate:'2026-01-01', endDate:'2026-12-31',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT' }
      ]
    }
  ], 'sales', true);
  assert.match(context.body, /売上に絞った年ごとの比較/);
  assert.doesNotMatch(context.body, /来客数80人/);
});


test('Phase 6.33 builds concrete guidance for a missing comparison month', () => {
  const lines = managementDataMissingPeriodNextInputs(['2026年8月'], 'sales', 'month', true);
  assert.deepEqual(lines, [
    '優先1: 2026年8月の売上を1日分以上登録すると、2026年8月を月次比較の対象にできます。'
  ]);
});

test('Phase 6.33 asks for same-day profitability metrics for a missing year', () => {
  const lines = managementDataMissingPeriodNextInputs(['2025年'], 'profit', 'year', true);
  assert.deepEqual(lines, [
    '優先1: 2025年の売上・経費・利益を同じ日に1日分以上登録すると、2025年を年次比較の対象にできます。'
  ]);
});

test('Phase 6.33 focused monthly comparison exposes missing-month next input before available data', () => {
  const context = managementDataFocusedMultiMonthContext([
    { label:'2026年8月', startDate:'2026-08-01', endDate:'2026-08-31', entries:[] },
    {
      label:'2026年9月', startDate:'2026-09-01', endDate:'2026-09-30',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ], 'sales', true);
  assert.match(context.body, /データ未登録の月: 2026年8月/);
  assert.match(context.body, /次に登録すると分析が広がる項目（サーバー判定）:/);
  assert.match(context.body, /2026年8月の売上を1日分以上登録すると、2026年8月を月次比較の対象にできます/);
  assert.match(context.body, /月別の確認済みデータ:/);
});


test('Phase 6.34 compares focused sales totals when registered-day counts match', () => {
  const lines = managementDataFocusedGroupComparisonMetrics([
    {
      label:'2026年8月',
      entries:[
        { data_date:'2026-08-20', metric_type:'revenue', amount:'140000', currency:'JPY' },
        { data_date:'2026-08-21', metric_type:'revenue', amount:'150000', currency:'JPY' }
      ]
    },
    {
      label:'2026年9月',
      entries:[
        { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ], 'sales');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /登録日数が同じ2日のため登録済み日合計を比較/);
  assert.match(lines[0], /290,000円 → 2026年9月 310,000円/);
  assert.match(lines[0], /差\+20,000円/);
  assert.match(lines[0], /増減率\+6\.9%/);
});

test('Phase 6.34 compares registered-day averages when period day counts differ', () => {
  const lines = managementDataFocusedGroupComparisonMetrics([
    {
      label:'2026年8月',
      entries:[
        { data_date:'2026-08-20', metric_type:'revenue', amount:'140000', currency:'JPY' }
      ]
    },
    {
      label:'2026年9月',
      entries:[
        { data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ], 'sales');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /登録日数が異なる/);
  assert.match(lines[0], /合計は直接比較せず/);
  assert.match(lines[0], /登録日平均を比較/);
  assert.match(lines[0], /140,000円 → 2026年9月 155,000円/);
});

test('Phase 6.34 embeds deterministic period comparison in focused monthly comparison', () => {
  const context = managementDataFocusedMultiMonthContext([
    {
      label:'2026年8月', startDate:'2026-08-01', endDate:'2026-08-31',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-08-20', metric_type:'revenue', amount:'140000', currency:'JPY' }
      ]
    },
    {
      label:'2026年9月', startDate:'2026-09-01', endDate:'2026-09-30',
      entries:[
        { business_key:'north-star-beans', data_date:'2026-09-21', metric_type:'revenue', amount:'150000', currency:'JPY' },
        { business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY' }
      ]
    }
  ], 'sales', true);
  assert.match(context.body, /サーバー計算済み期間比較（再計算せずこの値を使用）:/);
  assert.match(context.body, /合計は直接比較せず/);
  assert.match(context.body, /登録日平均を比較/);
});


test('Phase 6.45 whole-business current lookup is owner, business and confirmation scoped', async () => {
  let seen;
  const pool = { async query(sql, params) { seen = { sql, params }; return { rows:[] }; } };
  const repo = new PostgresManagementDataRepository(pool);
  await repo.findBusinessCurrent('owner@example.com', 'north-star-beans');
  assert.deepEqual(seen.params, ['owner@example.com', 'north-star-beans']);
  assert.match(seen.sql, /FROM management_data/);
  assert.match(seen.sql, /owner_email = \$1 AND business_key = \$2/);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
  assert.doesNotMatch(seen.sql, /DISTINCT ON/);
});

test('Phase 6.45 whole-business history lookup is owner, business and confirmation scoped', async () => {
  let seen;
  const pool = { async query(sql, params) { seen = { sql, params }; return { rows:[] }; } };
  const repo = new PostgresManagementDataRepository(pool);
  await repo.findBusinessHistory('owner@example.com', 'north-star-beans');
  assert.deepEqual(seen.params, ['owner@example.com', 'north-star-beans']);
  assert.match(seen.sql, /FROM management_data_history/);
  assert.match(seen.sql, /history\.owner_email = \$1 AND history\.business_key = \$2/);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
  assert.match(seen.sql, /ORDER BY history\.data_date ASC, history\.metric_type ASC, history\.changed_at ASC, history\.id ASC/);
});


test('Phase 6.46 active management-data lookups ignore superseded duplicate rows', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows:[] }; } };
  const repo = new PostgresManagementDataRepository(pool);
  await repo.findExact('owner@example.com', { businessKey:'north-star-beans', dataDate:'2026-09-22', metricType:'revenue' });
  await repo.findDaily('owner@example.com', { businessKey:'north-star-beans', dataDate:'2026-09-22' });
  await repo.findRange('owner@example.com', { businessKey:'north-star-beans', startDate:'2026-09-01', endDate:'2026-09-30' });
  await repo.findBusinessCurrent('owner@example.com', 'north-star-beans');
  for (const call of calls) assert.match(call.sql, /superseded_by_management_data_id IS NULL/);
});

test('Phase 6.46 duplicate-group lookup returns all active confirmed rows for one logical item', async () => {
  let seen = null;
  const repo = new PostgresManagementDataRepository({
    async query(sql, params) { seen = { sql, params }; return { rows:[] }; }
  });
  await repo.findDuplicateGroup('owner@example.com', {
    businessKey:'north-star-beans',
    dataDate:'2026-09-22',
    metricType:'customers'
  });
  assert.deepEqual(seen.params, ['owner@example.com','north-star-beans','2026-09-22','customers']);
  assert.match(seen.sql, /confirmed_by_owner = TRUE/);
  assert.match(seen.sql, /superseded_by_management_data_id IS NULL/);
  assert.doesNotMatch(seen.sql, /DISTINCT ON/);
});

test('Phase 6.46 history lookups ignore histories belonging only to superseded rows', async () => {
  let seen = null;
  const repo = new PostgresManagementDataRepository({
    async query(sql, params) { seen = { sql, params }; return { rows:[] }; }
  });
  await repo.findBusinessHistory('owner@example.com', 'north-star-beans');
  assert.match(seen.sql, /JOIN management_data AS current ON current.id = history.management_data_id/);
  assert.match(seen.sql, /current.superseded_by_management_data_id IS NULL/);
});
