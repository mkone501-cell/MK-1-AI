'use strict';

const MAX_TERMS = 36;
const MAX_CANDIDATES = 80;
const MAX_RESULTS = 4;
const aliases = new Map([
  ['お店', ['店舗', 'カフェ']], ['店舗', ['お店', 'カフェ']], ['カフェ', ['店舗', 'お店']],
  ['家賃', ['賃料']], ['賃料', ['家賃']], ['売上', ['売り上げ']], ['売り上げ', ['売上']],
  ['物件', ['不動産']], ['不動産', ['物件']],
  ['方針', ['経営方針']], ['経営方針', ['方針']], ['ec', ['ネットショップ']]
]);

function queryTerms(question) {
  const parts = String(question).normalize('NFKC').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+/gu) || [];
  const terms = [];
  for (const part of parts) {
    if (/^[a-z0-9]+$/i.test(part)) {
      if (part.length >= 2) terms.push(part.toLowerCase());
    } else {
      for (let i = 0; i <= part.length - 3; i++) {
        const term = part.slice(i, i + 3);
        if (/\p{Script=Han}|\p{Script=Katakana}/u.test(term)) terms.push(term);
      }
      for (const kanji of part.match(/\p{Script=Han}{2,}/gu) || []) {
        for (let i = 0; i <= kanji.length - 2; i++) terms.push(kanji.slice(i, i + 2));
      }
      if (part.length === 2 && /\p{Script=Han}|\p{Script=Katakana}/u.test(part)) terms.push(part);
    }
  }
  // 長い質問でも最後の具体的な質問語を候補から落とさない。
  const unique = [...new Set(terms)];
  const direct = unique.length <= MAX_TERMS ? unique :
    [...new Set([...unique.slice(0, MAX_TERMS / 2), ...unique.slice(-MAX_TERMS / 2)])];
  const expanded = new Set();
  for (const [trigger, values] of aliases) {
    if (String(question).normalize('NFKC').toLowerCase().includes(trigger)) values.forEach(value => expanded.add(value));
  }
  return { direct, expanded:[...expanded].filter(value => !direct.includes(value)).slice(0, 8) };
}

function searchPatterns(question) {
  const { direct, expanded } = queryTerms(question);
  return [...direct, ...expanded].map(term => `%${term.replace(/[\\%_]/g, '\\$&')}%`);
}

function rankKnowledge(rows, question) {
  const { direct, expanded } = queryTerms(question);
  const terms = [...direct, ...expanded];
  if (!terms.length) return [];
  const candidates = rows.map(row => {
    const title = String(row.title || '').normalize('NFKC').toLowerCase();
    const category = String(row.category || '').normalize('NFKC').toLowerCase();
    const body = String(row.body || '').normalize('NFKC').toLowerCase();
    const hits = new Map();
    terms.forEach((term, index) => {
      const normalized = term.toLowerCase();
      const weight = index < direct.length ? 1 : 0.35;
      const score = (title.includes(normalized) ? 5 : 0) + (category.includes(normalized) ? 3 : 0) + (body.includes(normalized) ? 1 : 0);
      if (score) hits.set(term, score * weight);
    });
    return { row, hits, score:[...hits.values()].reduce((sum, value) => sum + value, 0) };
  }).filter(entry => entry.score > 0);

  const selected = [], covered = new Set();
  while (selected.length < MAX_RESULTS && candidates.length) {
    candidates.sort((a, b) => {
      const value = entry => entry.score * 0.35 + [...entry.hits].reduce((sum, [term, score]) => sum + (covered.has(term) ? 0 : score * 0.65), 0);
      return value(b) - value(a) || String(a.row.id).localeCompare(String(b.row.id));
    });
    const best = candidates.shift();
    selected.push(best.row);
    for (const term of best.hits.keys()) covered.add(term);
  }
  return selected;
}

module.exports = { queryTerms, searchPatterns, rankKnowledge, MAX_CANDIDATES };
