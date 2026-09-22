'use strict';

function detectManagementDataQuery(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  const metricType = /来客数|客数|来店客数/.test(text) ? 'customers' : /客単価|平均客単価/.test(text) ? 'average_spend' : /経費|費用/.test(text) ? 'expense' : /利益|営業利益/.test(text) ? 'profit' : /売上/.test(text) ? 'revenue' : null;

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

  if (!businessKey || !metricType || !dataDate) return null;
  return { businessKey, metricType, dataDate };
}

function managementDataContext(entry) {
  if (!entry) return null;
  const rawDate = entry.data_date instanceof Date
    ? entry.data_date.toISOString().slice(0, 10)
    : String(entry.data_date || '').slice(0, 10);
  const [year, month, day] = rawDate.split('-');
  const amount = Number(entry.amount);
  if (!year || !month || !day || !Number.isFinite(amount)) return null;
  const businessName = entry.business_key === 'north-star-beans' ? 'NORTH STAR BEANS' : entry.business_key;
  const names = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };\n  const metricName = names[entry.metric_type] || entry.metric_type;
  const currency = entry.currency === 'JPY' ? '円' : entry.currency === 'COUNT' ? '人' : ` ${entry.currency}`;
  return {
    category: '経営数値',
    title: `${metricName} ${year}/${month}/${day}`,
    body: `${Number(month)}月${Number(day)}日の${businessName}の${metricName}は${amount.toLocaleString('ja-JP')}${currency}です。`,
    source: '本人確認済み経営数値'
  };
}

module.exports = { detectManagementDataQuery, managementDataContext };
