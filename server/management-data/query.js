'use strict';

function normalizeDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractManagementDates(text) {
  const dates = [];
  const pattern = /(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日|(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/g;
  for (const match of String(text || '').matchAll(pattern)) {
    const year = Number(match[1] || match[4]);
    const month = Number(match[2] || match[5]);
    const day = Number(match[3] || match[6]);
    const value = normalizeDateParts(year, month, day);
    if (value && !dates.includes(value)) dates.push(value);
  }
  return dates;
}

function parseBusinessAndDate(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  const [dataDate = null] = extractManagementDates(text);
  return { businessKey, dataDate };
}

function detectManagementDataQuery(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const { businessKey, dataDate } = parseBusinessAndDate(text);
  const dates = extractManagementDates(text);
  const comparisonRequested = /比較|比べ|違い|差/.test(text);
  const analysisRequested = /分析|評価|考察|どう(?:だった|でした)|良かった|悪かった/.test(text);
  const summaryRequested = /経営状況|経営数値|日次(?:の)?(?:状況|実績|まとめ)|まとめて/.test(text);
  if (comparisonRequested && summaryRequested) {
    if (!businessKey || dates.length !== 2) return null;
    return { businessKey, metricType:'daily_comparison', dataDates:dates };
  }
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


function scopeManagementAnalysisInputs({ query, history = [], knowledge = [], context = null }) {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeKnowledge = Array.isArray(knowledge) ? knowledge : [];
  const suppliedContexts = Array.isArray(context) ? context.filter(Boolean) : context ? [context] : [];
  if (query?.metricType === 'daily_analysis' || query?.metricType === 'daily_comparison') {
    return { history:[], knowledge:suppliedContexts };
  }
  return { history:safeHistory, knowledge:suppliedContexts.length ? [...safeKnowledge, ...suppliedContexts] : safeKnowledge };
}

module.exports = { detectManagementDataQuery, managementDataContext, managementDataSummaryContext, scopeManagementAnalysisInputs, extractManagementDates };
