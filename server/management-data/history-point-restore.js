'use strict';

function managementDataIdFromText(message) {
  const match = String(message || '').match(/管理\s*ID\s*#?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function recentManagementDataId(history) {
  const recent = Array.isArray(history) ? history.slice(-4) : [];
  const ids = new Set();
  for (const item of recent) {
    const value = managementDataIdFromText(item?.content || item?.text || '');
    if (Number.isInteger(value) && value > 0) ids.add(value);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

function japaneseOrdinal(value) {
  const map = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10 };
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  if (/^十[一二三四五六七八九]$/.test(value)) return 10 + map[value[1]];
  if (/^[二三四五六七八九]十$/.test(value)) return map[value[0]] * 10;
  if (/^[二三四五六七八九]十[一二三四五六七八九]$/.test(value)) return map[value[0]] * 10 + map[value[2]];
  return null;
}

function parseHistoryPointSelectors(message) {
  const text = String(message || '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));
  const selectors = [];
  const indexMatch = text.match(/(\d+|[一二三四五六七八九十]+)番目/);
  if (indexMatch) {
    const index = japaneseOrdinal(indexMatch[1]);
    if (Number.isInteger(index) && index > 0) selectors.push({ type:'index', index });
  }
  const dateMatch = text.match(/(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})[\s　]+(\d{1,2}):(\d{2})/);
  if (dateMatch) {
    const [, year, month, day, hour, minute] = dateMatch;
    selectors.push({ type:'changedAtMinute', value:`${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${minute}` });
  }
  const amounts = [...text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)\s*円(?:だった(?:時点)?|の時点)?/g)]
    .map(match => Number(match[1].replace(/,/g, '')))
    .filter(Number.isFinite);
  if (amounts.length === 1) selectors.push({ type:'newAmount', amount:amounts[0], currency:'JPY' });
  if (amounts.length > 1) selectors.push({ type:'ambiguousAmount' });
  return selectors;
}

function isInitialRestorePhrase(message) {
  const text = String(message || '');
  return /(一番最初|最初|当初|初回).{0,20}(戻して|戻す|復元して|復元する)/.test(text);
}

function detectHistoryPointRestoreRequest(message, history = []) {
  const text = String(message || '').trim();
  const hasRestoreIntent = /(戻して|戻す|復元して|復元する|この値に戻す|戻したい)/.test(text);
  const hasHistoryReference = /(管理\s*ID|番目|変更後|履歴|過去|時点|前の値|その変更|その履歴)/.test(text);
  if (!hasRestoreIntent || !hasHistoryReference || isInitialRestorePhrase(text)) return null;

  const selectors = parseHistoryPointSelectors(text);
  const concrete = selectors.filter(selector => selector.type !== 'ambiguousAmount');
  const explicitId = managementDataIdFromText(text);
  const managementDataId = explicitId || recentManagementDataId(history);
  if (!managementDataId) return { managementDataId:null, selector:concrete.length === 1 ? concrete[0] : null, error:'managementDataIdRequired' };
  if (selectors.some(selector => selector.type === 'ambiguousAmount') || concrete.length !== 1) {
    return { managementDataId, selector:null, error:'historyPointRequired' };
  }
  return { managementDataId, selector:concrete[0], error:null };
}

function historyMinute(changedAt) {
  const date = new Date(changedAt);
  if (Number.isNaN(date.getTime())) return '';
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date).reduce((all, part) => {
    if (part.type !== 'literal') all[part.type] = part.value;
    return all;
  }, {});
  return `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute}`;
}

function orderedHistory(entries) {
  return (Array.isArray(entries) ? entries : []).slice().sort((left, right) => {
    const changed = new Date(left.changed_at).getTime() - new Date(right.changed_at).getTime();
    if (changed) return changed;
    return Number(left.id) - Number(right.id);
  });
}

function resolveHistoryPoint(entries, selector) {
  const rows = orderedHistory(entries);
  if (!selector) return { error:'historyPointRequired', rows };
  let matches = [];
  if (selector.type === 'index') matches = rows[selector.index - 1] ? [rows[selector.index - 1]] : [];
  if (selector.type === 'newAmount') {
    matches = rows.filter(row => Number(row.new_amount) === Number(selector.amount) &&
      String(row.new_currency || '').trim().toUpperCase() === selector.currency);
  }
  if (selector.type === 'changedAtMinute') matches = rows.filter(row => historyMinute(row.changed_at) === selector.value);
  if (!matches.length) return { error:'historyPointNotFound', rows };
  if (matches.length !== 1) return { error:'historyPointAmbiguous', rows, matches };
  const historyEntry = matches[0];
  const amount = Number(historyEntry.new_amount);
  const currency = String(historyEntry.new_currency || '').trim().toUpperCase();
  if (!Number.isFinite(amount) || !currency) return { error:'historyPointInvalid', rows };
  return { historyEntry, historyIndex:rows.findIndex(row => String(row.id) === String(historyEntry.id)) + 1, amount, currency, rows };
}

module.exports = {
  detectHistoryPointRestoreRequest,
  resolveHistoryPoint,
  orderedHistory,
  historyMinute
};
