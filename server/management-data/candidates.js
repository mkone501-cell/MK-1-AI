'use strict';

const METRIC_PATTERNS = [
  { metricType:'revenue', labels:['売上','売上高','sales','revenue'] },
  { metricType:'expense', labels:['経費','費用','expense','expenses'] },
  { metricType:'profit', labels:['利益','営業利益','profit'] },
  { metricType:'cash_balance', labels:['現金残高','預金残高','cash balance'] },
  { metricType:'customers', labels:['来客数','客数','来店客数','customers'] },
  { metricType:'average_spend', labels:['客単価','平均客単価','average spend','average ticket'] }
];

function parseAmount(raw, unit) {
  const normalized = String(raw).replace(/,/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  const multiplier = unit === '億円' ? 100000000 : unit === '万円' ? 10000 : unit === '千円' ? 1000 : 1;
  return value * multiplier;
}

function metricFor(text) {
  const lower = text.toLowerCase();
  return METRIC_PATTERNS.find(item => item.labels.some(label => lower.includes(label.toLowerCase())))?.metricType || null;
}

function detectManagementDataCandidate(message) {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  if (!text || text.length > 8000) return null;

  const metricType = metricFor(text);
  if (!metricType) return null;

  // Questions, estimates and plans are not treated as factual management data.
  if (/[?？]/.test(text) || /(見込み|予想|予定|目標|だいたい|約|くらい|ぐらい|想定|estimate|forecast|target)/i.test(text)) return null;

  const amountMatch = metricType === 'customers'
    ? text.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(人)/)
    : text.match(/(?:¥|￥)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(億円|万円|千円|円)/);
  if (!amountMatch) return null;
  const amount = metricType === 'customers' ? Number(String(amountMatch[1]).replace(/,/g, '')) : parseAmount(amountMatch[1], amountMatch[2]);
  if (!Number.isFinite(amount)) return null;

  const dateMatch = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/);
  const dataDate = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2,'0')}-${String(dateMatch[3]).padStart(2,'0')}`
    : null;
  const businessKey = /NORTH\s+STAR\s+BEANS/i.test(text) ? 'north-star-beans' : null;

  return {
    kind:'management-data',
    businessKey,
    metricType,
    amount,
    currency: metricType === 'customers' ? 'COUNT' : 'JPY',
    dataDate,
    source:'owner conversation',
    originalText:text,
    confirmed:false
  };
}

module.exports = { detectManagementDataCandidate, parseAmount };
