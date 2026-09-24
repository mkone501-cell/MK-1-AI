'use strict';

function parseBusinessAndDate(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  let dataDate = null;
  const jp = text.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const iso = text.match(/(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  const match = jp || iso;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      dataDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return { businessKey, dataDate };
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseBusinessAndDates(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  const found = [];
  let inheritedYear = null;
  const jp = /(?:(20\d{2})年\s*)?(\d{1,2})月\s*(\d{1,2})日/g;
  for (const match of text.matchAll(jp)) {
    const year = match[1] ? Number(match[1]) : inheritedYear;
    if (match[1]) inheritedYear = Number(match[1]);
    if (!year) continue;
    const value = validIsoDate(year, Number(match[2]), Number(match[3]));
    if (value) found.push({ index:match.index, value });
  }
  const iso = /(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/g;
  for (const match of text.matchAll(iso)) {
    const value = validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (value) found.push({ index:match.index, value });
  }
  found.sort((a, b) => a.index - b.index);
  return { businessKey, dataDates:[...new Set(found.map(item => item.value))] };
}

function monthRange(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    startDate:validIsoDate(year, month, 1),
    endDate:validIsoDate(year, month, lastDay),
    label:`${year}年${month}月`
  };
}

function parseBusinessAndMonths(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  if (!businessKey) return { businessKey:null, months:[] };
  const found = [];
  let inheritedYear = null;
  const jp = /(?:(20\d{2})年\s*)?(\d{1,2})月(?!\s*\d{1,2}日)/g;
  for (const match of text.matchAll(jp)) {
    const year = match[1] ? Number(match[1]) : inheritedYear;
    if (match[1]) inheritedYear = Number(match[1]);
    if (!year) continue;
    const range = monthRange(year, Number(match[2]));
    if (range) found.push({ index:match.index, ...range });
  }
  const iso = /(20\d{2})[-\/]([01]?\d)(?![-\/]\d)/g;
  for (const match of text.matchAll(iso)) {
    const range = monthRange(Number(match[1]), Number(match[2]));
    if (range) found.push({ index:match.index, ...range });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const months = [];
  for (const item of found) {
    const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push({ year:item.year, month:item.month, startDate:item.startDate, endDate:item.endDate, label:item.label });
  }
  return { businessKey, months };
}

function enumerateMonthRanges(first, last, maxMonths = 12) {
  if (!first || !last) return [];
  const startIndex = first.year * 12 + first.month - 1;
  const endIndex = last.year * 12 + last.month - 1;
  if (endIndex < startIndex) return [];
  const count = endIndex - startIndex + 1;
  if (count < 1 || count > maxMonths) return [];
  const result = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const year = Math.floor(index / 12);
    const month = index % 12 + 1;
    const range = monthRange(year, month);
    if (range) result.push(range);
  }
  return result;
}

function parseBusinessAndYears(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  if (!businessKey) return { businessKey:null, years:[] };
  const years = [];
  const seen = new Set();
  const re = /(20\d{2})年(?!\s*\d{1,2}月)/g;
  for (const match of text.matchAll(re)) {
    const year = Number(match[1]);
    if (seen.has(year)) continue;
    seen.add(year);
    years.push({
      year,
      startDate:validIsoDate(year, 1, 1),
      endDate:validIsoDate(year, 12, 31),
      label:`${year}年`
    });
  }
  return { businessKey, years };
}

function enumerateYearRanges(first, last, maxYears = 5) {
  if (!first || !last || !Number.isInteger(first.year) || !Number.isInteger(last.year)) return [];
  if (last.year < first.year) return [];
  const count = last.year - first.year + 1;
  if (count < 1 || count > maxYears) return [];
  const years = [];
  for (let year = first.year; year <= last.year; year += 1) {
    years.push({
      year,
      startDate:validIsoDate(year, 1, 1),
      endDate:validIsoDate(year, 12, 31),
      label:`${year}年`
    });
  }
  return years;
}

function parseBusinessAndYearMonths(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  if (!businessKey) return null;
  const match = text.match(/(20\d{2})年(?!\s*\d{1,2}月)/);
  if (!match) return null;
  const year = Number(match[1]);
  const months = enumerateMonthRanges({ year, month:1 }, { year, month:12 }, 12);
  if (months.length !== 12) return null;
  return { businessKey, year, months };
}

function parseBusinessAndMonthRange(text) {
  const { businessKey, months } = parseBusinessAndMonths(text);
  if (!businessKey || !months.length) return null;
  const first = months[0];
  return { businessKey, startDate:first.startDate, endDate:first.endDate };
}

function detectManagementDataQuery(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const { businessKey, dataDates } = parseBusinessAndDates(text);
  const dataDate = dataDates[0] || null;
  const rangeRequested = /(?:から.*まで|[〜～~]|期間|推移|傾向|トレンド)/.test(text);
  if (businessKey && rangeRequested && dataDates.length >= 2) {
    const [startDate, endDate] = dataDates.slice(0, 2);
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const days = Math.floor((end - start) / 86400000) + 1;
    if (days >= 1 && days <= 31) return { businessKey, metricType:'period_analysis', startDate, endDate };
    return null;
  }
  const comparisonRequested = /比較|比べ|違い|差(?:は|を|が)?/.test(text);
  if (businessKey && comparisonRequested && dataDates.length >= 2) {
    return { businessKey, metricType:'daily_comparison', dataDates:dataDates.slice(0, 2) };
  }
  if (!dataDates.length) {
    const monthParse = parseBusinessAndMonths(text);
    if (comparisonRequested && monthParse.months.length >= 2) {
      return { businessKey:monthParse.businessKey, metricType:'monthly_comparison', months:monthParse.months.slice(0, 2) };
    }
    if (rangeRequested && monthParse.months.length >= 2) {
      const months = enumerateMonthRanges(monthParse.months[0], monthParse.months[1], 12);
      if (!months.length) return null;
      return { businessKey:monthParse.businessKey, metricType:'monthly_period_analysis', months };
    }
    const monthRange = monthParse.months[0] ? {
      businessKey:monthParse.businessKey,
      startDate:monthParse.months[0].startDate,
      endDate:monthParse.months[0].endDate
    } : null;
    const monthRequested = /月次|月間|経営状況|経営数値|売上|来客数|客単価|経費|利益|分析|まとめ|推移|傾向/.test(text);
    if (monthRange && monthRequested) {
      return { businessKey:monthRange.businessKey, metricType:'period_analysis', startDate:monthRange.startDate, endDate:monthRange.endDate };
    }
    const yearCompare = parseBusinessAndYears(text);
    if (comparisonRequested && yearCompare.years.length >= 2) {
      return { businessKey:yearCompare.businessKey, metricType:'annual_comparison', years:yearCompare.years.slice(0, 2) };
    }
    if (rangeRequested && yearCompare.years.length >= 2) {
      const years = enumerateYearRanges(yearCompare.years[0], yearCompare.years[1], 5);
      if (!years.length) return null;
      return { businessKey:yearCompare.businessKey, metricType:'annual_period_analysis', years };
    }
    const yearParse = parseBusinessAndYearMonths(text);
    const yearRequested = /年間|年次|経営状況|経営数値|売上|来客数|客単価|経費|利益|分析|まとめ|推移|傾向/.test(text);
    if (yearParse && yearRequested) {
      return { businessKey:yearParse.businessKey, metricType:'monthly_period_analysis', months:yearParse.months };
    }
  }
  const analysisRequested = /分析|評価|考察|どう(?:だった|でした)|良かった|悪かった/.test(text);
  const summaryRequested = /経営状況|経営数値|日次(?:の)?(?:状況|実績|まとめ)|まとめて/.test(text);
  const metricType = analysisRequested && summaryRequested ? 'daily_analysis' : summaryRequested ? 'daily_summary' : /来客数|客数|来店客数/.test(text) ? 'customers' : /客単価|平均客単価/.test(text) ? 'average_spend' : /経費|費用/.test(text) ? 'expense' : /利益|営業利益/.test(text) ? 'profit' : /売上/.test(text) ? 'revenue' : null;
  if (!businessKey || !metricType || !dataDate) return null;
  return { businessKey, metricType, dataDate };
}

function managementDataContext(entry) {
  if (!entry) return null;
  const rawDate = entry.data_date instanceof Date ? entry.data_date.toISOString().slice(0, 10) : String(entry.data_date || '').slice(0, 10);
  const [year, month, day] = rawDate.split('-');
  const amount = Number(entry.amount);
  if (!year || !month || !day || !Number.isFinite(amount)) return null;
  const businessName = entry.business_key === 'north-star-beans' ? 'NORTH STAR BEANS' : entry.business_key;
  const names = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const metricName = names[entry.metric_type] || entry.metric_type;
  const currency = entry.currency === 'JPY' ? '円' : entry.currency === 'COUNT' ? '人' : ` ${entry.currency}`;
  return { category:'経営数値', title:`${metricName} ${year}/${month}/${day}`, body:`${Number(month)}月${Number(day)}日の${businessName}の${metricName}は${amount.toLocaleString('ja-JP')}${currency}です。`, source:'本人確認済み経営数値' };
}

function managementDataSummaryContext(entries) {
  const contexts = (Array.isArray(entries) ? entries : []).map(managementDataContext).filter(Boolean);
  if (!contexts.length) return null;
  const first = entries.find(Boolean);
  const rawDate = first.data_date instanceof Date ? first.data_date.toISOString().slice(0, 10) : String(first.data_date || '').slice(0, 10);
  const [year, month, day] = rawDate.split('-');
  const businessName = first.business_key === 'north-star-beans' ? 'NORTH STAR BEANS' : first.business_key;
  return { category:'経営数値', title:`日次経営状況 ${year}/${month}/${day}`, body:`${Number(month)}月${Number(day)}日の${businessName}の本人確認済み経営数値: ${contexts.map(item => item.body.replace(/^.*?のNORTH STAR BEANSの/, '')).join('、')}`, source:'本人確認済み経営数値' };
}


function managementDataPeriodAggregates(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry => Number.isFinite(Number(entry?.amount)));
  if (!rows.length) return [];
  const metricNames = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const grouped = new Map();
  for (const entry of rows) {
    if (!grouped.has(entry.metric_type)) grouped.set(entry.metric_type, []);
    grouped.get(entry.metric_type).push(entry);
  }
  const format = (value, currency) => {
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
    const unit = currency === 'JPY' ? '円' : currency === 'COUNT' ? '人' : currency ? ` ${currency}` : '';
    return `${rounded.toLocaleString('ja-JP')}${unit}`;
  };
  const lines = [];
  const additive = new Set(['revenue','expense','profit','customers']);
  for (const [metricType, items] of grouped.entries()) {
    const name = metricNames[metricType] || metricType;
    const currency = items[0]?.currency || '';
    const values = items.map(item => Number(item.amount));
    if (additive.has(metricType)) {
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = total / values.length;
      lines.push(`${name}: 登録済み${values.length}日分の合計${format(total, currency)}、登録済み${values.length}日平均${format(average, currency)}`);
      continue;
    }
    if (metricType === 'average_spend') {
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      lines.push(`${name}: 登録済み${values.length}日平均${format(average, currency)}`);
      continue;
    }
    if (metricType === 'cash_balance') {
      const latest = [...items].sort((a, b) => String(a.data_date).localeCompare(String(b.data_date))).at(-1);
      lines.push(`${name}: 最新の登録値${format(Number(latest.amount), latest.currency || currency)}`);
    }
  }
  return lines;
}

function managementDataPeriodContext(entries, startDate, endDate) {
  const rows = Array.isArray(entries) ? entries : [];
  const groups = new Map();
  for (const entry of rows) {
    const rawDate = entry?.data_date instanceof Date ? entry.data_date.toISOString().slice(0, 10) : String(entry?.data_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    if (!groups.has(rawDate)) groups.set(rawDate, []);
    groups.get(rawDate).push(entry);
  }
  const summaries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => managementDataSummaryContext(items)).filter(Boolean);
  const aggregates = managementDataPeriodAggregates(rows);
  const body = summaries.length
    ? `${startDate}から${endDate}までの期間で、本人確認済み経営数値が保存されている日だけを列挙します（未登録日は0として扱いません）。登録済み日は${summaries.length}日です。合計・平均はサーバー側で計算済みの値を優先して使用し、指定期間の全日数を分母にした平均として表現しないでください。\nサーバー計算済み集計（再計算せずこの値を使用）:\n${aggregates.length ? aggregates.join('\n') : '集計対象の指標はありません。'}\n日別の確認済みデータ:\n${summaries.map(item => item.body).join('\n')}`
    : `${startDate}から${endDate}までの期間に、本人確認済み経営数値はありません。`;
  return { category:'経営数値', title:`期間経営状況 ${startDate}〜${endDate}`, body, source:'本人確認済み経営数値' };
}

function managementDataMultiMonthContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate)
  }));
  if (!items.length) return null;
  const available = items.filter(item => item.context && !/経営数値はありません/.test(item.context.body));
  const missing = items.filter(item => !item.context || /経営数値はありません/.test(item.context.body)).map(item => item.label);
  const body = [
    '本人確認済み経営数値だけで月ごとの推移を分析してください。未登録日・未登録月は0として扱わないでください。',
    '月ごとの登録済み日数が違う場合は、単純な月間合計だけで増減や良し悪しを断定しないでください。',
    missing.length ? `データ未登録の月: ${missing.join('、')}` : '',
    ...available.map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'複数月の経営推移', body, source:'本人確認済み経営数値' };
}

function managementDataMultiYearContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate)
  }));
  if (!items.length) return null;
  const available = items.filter(item => item.context && !/経営数値はありません/.test(item.context.body));
  const missing = items.filter(item => !item.context || /経営数値はありません/.test(item.context.body)).map(item => item.label);
  const body = [
    '本人確認済み経営数値だけで年ごとの推移を分析してください。未登録日・未登録年は0として扱わないでください。',
    '年ごとの登録済み日数が違う場合は、単純な年間合計だけで増減や良し悪しを断定しないでください。',
    missing.length ? `データ未登録の年: ${missing.join('、')}` : '',
    ...available.map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'複数年の経営推移', body, source:'本人確認済み経営数値' };
}

function managementDataAnnualComparisonContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate)
  }));
  if (!items.length) return null;
  const missing = items.filter(item => !item.context || /経営数値はありません/.test(item.context.body)).map(item => item.label);
  const body = [
    '本人確認済み経営数値だけで年ごとに比較してください。未登録日・未登録年は0として扱わないでください。',
    '年ごとの登録済み日数が違う場合は、単純な年間合計だけで増減や良し悪しを断定しないでください。',
    missing.length ? `データ未登録の年: ${missing.join('、')}` : '',
    ...items.filter(item => item.context && !/経営数値はありません/.test(item.context.body))
      .map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'年次経営状況の比較', body, source:'本人確認済み経営数値' };
}

function managementDataMonthlyComparisonContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => {
    const context = managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate);
    return { label:group?.label || `${group?.startDate}〜${group?.endDate}`, context };
  }).filter(item => item.context);
  if (!items.length) return null;
  return {
    category:'経営数値',
    title:'月次経営状況の比較',
    body:`本人確認済み経営数値だけで月ごとに比較してください。未登録日は0として扱わず、各月の登録済み日数が違う場合は単純な月間合計の優劣を断定しないでください。\n${items.map(item => `${item.label}:\n${item.context.body}`).join('\n')}`,
    source:'本人確認済み経営数値'
  };
}

function managementDataComparisonContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    dataDate:group?.dataDate,
    context:managementDataSummaryContext(group?.entries || [])
  })).filter(item => item.dataDate);
  if (!items.length) return null;
  const body = items.map(item => item.context ? item.context.body : `${item.dataDate}の本人確認済み経営数値はありません。`).join('\n');
  return { category:'経営数値', title:'日次経営状況の比較', body, source:'本人確認済み経営数値' };
}

function scopeManagementAnalysisInputs({ query, history = [], knowledge = [], context = null }) {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeKnowledge = Array.isArray(knowledge) ? knowledge : [];
  if (query?.metricType === 'daily_analysis' || query?.metricType === 'daily_comparison' || query?.metricType === 'period_analysis' || query?.metricType === 'monthly_comparison' || query?.metricType === 'monthly_period_analysis' || query?.metricType === 'annual_comparison' || query?.metricType === 'annual_period_analysis') {
    return { history:[], knowledge:context ? [context] : [] };
  }
  return { history:safeHistory, knowledge:context ? [...safeKnowledge, context] : safeKnowledge };
}

module.exports = { detectManagementDataQuery, managementDataContext, managementDataSummaryContext, managementDataComparisonContext, managementDataMonthlyComparisonContext, managementDataAnnualComparisonContext, managementDataMultiMonthContext, managementDataMultiYearContext, managementDataPeriodContext, managementDataPeriodAggregates, scopeManagementAnalysisInputs, parseBusinessAndDates, parseBusinessAndMonths, parseBusinessAndMonthRange, parseBusinessAndYearMonths, parseBusinessAndYears, enumerateMonthRanges, enumerateYearRanges };
