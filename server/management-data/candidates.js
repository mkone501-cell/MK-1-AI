'use strict';

const METRIC_PATTERNS = [
  { metricType:'revenue', labels:['売上高','売上','revenue','sales'] },
  { metricType:'expense', labels:['経費','費用','expense','expenses'] },
  { metricType:'profit', labels:['営業利益','利益','profit'] },
  { metricType:'cash_balance', labels:['現金残高','預金残高','cash balance'] },
  { metricType:'customers', labels:['来店客数','来客数','客数','customers'] },
  { metricType:'average_spend', labels:['平均客単価','客単価','average ticket','average spend'] }
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


function managementDataCandidateAcknowledgement(candidates) {
  const count = Array.isArray(candidates) ? candidates.length : 0;
  if (!count) return '';
  if (count === 1) {
    return '経営数値の保存候補を作成しました。まだ保存していません。下の内容を確認し、「確認して保存」を押した場合だけ保存します。';
  }
  return `経営数値の保存候補を${count}件作成しました。まだ保存していません。下の内容を確認し、それぞれ「確認して保存」を押した場合だけ保存します。`;
}

function detectManagementDataCandidates(message) {
  if (typeof message !== 'string') return [];
  const text = message.trim();
  if (!text || text.length > 8000) return [];
  if (/[?？]/.test(text) || /(見込み|予想|予定|目標|だいたい|約|くらい|ぐらい|想定|estimate|forecast|target)/i.test(text)) return [];

  const dateMatch = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/);
  const dataDate = dateMatch
    ? dateMatch[1] + '-' + String(dateMatch[2]).padStart(2,'0') + '-' + String(dateMatch[3]).padStart(2,'0')
    : null;
  const businessKey = /NORTH\s+STAR\s+BEANS/i.test(text) ? 'north-star-beans' : null;
  const candidates = [];

  for (const metric of METRIC_PATTERNS) {
    const label = metric.labels
      .filter(item => {
        const lowerText = text.toLowerCase();
        const lowerLabel = item.toLowerCase();
        let from = 0;
        while (true) {
          const index = lowerText.indexOf(lowerLabel, from);
          if (index < 0) return false;
          const tail = text.slice(index + item.length, index + item.length + 32);
          const hasValue = metric.metricType === 'customers'
            ? /^[^\d-]{0,12}-?\d[\d,]*(?:\.\d+)?\s*人/.test(tail)
            : /^[^\d¥￥-]{0,12}(?:¥|￥)?\s*-?\d[\d,]*(?:\.\d+)?\s*(?:億円|万円|千円|円)/.test(tail);
          if (hasValue) return true;
          from = index + lowerLabel.length;
        }
      })
      .sort((a,b) => b.length - a.length)[0];
    if (!label) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const valuePattern = metric.metricType === 'customers'
      ? new RegExp(escaped + '[^\\d-]{0,12}(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*人', 'i')
      : new RegExp(escaped + '[^\\d¥￥-]{0,12}(?:¥|￥)?\\s*(-?\\d[\\d,]*(?:\\.\\d+)?)\\s*(億円|万円|千円|円)', 'i');
    const match = text.match(valuePattern);
    if (!match) continue;
    const amount = metric.metricType === 'customers'
      ? Number(String(match[1]).replace(/,/g, ''))
      : parseAmount(match[1], match[2]);
    if (!Number.isFinite(amount)) continue;
    candidates.push({
      kind:'management-data',
      businessKey,
      metricType:metric.metricType,
      amount,
      currency:metric.metricType === 'customers' ? 'COUNT' : 'JPY',
      dataDate,
      source:'owner conversation',
      originalText:text,
      confirmed:false
    });
  }
  return candidates;
}

module.exports = { detectManagementDataCandidate, detectManagementDataCandidates, managementDataCandidateAcknowledgement, parseAmount };
