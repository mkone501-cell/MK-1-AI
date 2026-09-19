'use strict';
const { createHash } = require('node:crypto');
const { memoryCandidates } = require('./candidates');
const { validateKnowledge } = require('./validation');

// Each descriptor defines a fact, not a whole document. Extend here for new fields.
const descriptors = [
  { key:'hours', label:'営業時間', re:/(平日|土日祝|土日|祝日)?(?:の)?営業時間(?:は|を|：|:)?\s*(平日|土日祝|土日|祝日)?\s*(\d{1,2}:\d{2}[〜～~\-]\d{1,2}:\d{2})/g },
  { key:'day', label:'定休日', re:/定休日(?:は|を|：|:)\s*([月火水木金土日]曜日)/g },
  { key:'monthly', label:'月商', re:/月商(?:目標)?(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'annual', label:'年商', re:/年商(?:目標)?(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'sales', label:'売上目標', re:/売上目標(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'price', label:'価格', re:/価格(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'staff', label:'スタッフ体制', re:/スタッフ体制(?:は|を|：|:)?\s*(\d+人体制)/g },
  { key:'rent', label:'家賃', re:/家賃(?:は|を|：|:)?\s*(?:月)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'area', label:'面積', re:/面積(?:は|を|：|:)?\s*(\d+(?:\.\d+)?(?:㎡|平米))/g }
];

function facts(text) {
  const found = [];
  for (const d of descriptors) {
    const re = new RegExp(d.re.source, 'g');
    for (const match of text.matchAll(re)) {
      const value = match.at(-1);
      const scope = d.key === 'hours' ? (match[1] || match[2] || '全日') : '';
      found.push({ key:d.key, scope, value, start:match.index + match[0].lastIndexOf(value), length:value.length,
        target:text.slice(0, match.index).replace(/の$/, '').trim(), label:d.label });
    }
  }
  // Hours listed after an initial heading, e.g. 営業時間は平日...、土日祝... .
  if (/営業時間/.test(text)) for (const m of text.matchAll(/(平日|土日祝|土日|祝日)\s*(\d{1,2}:\d{2}[〜～~\-]\d{1,2}:\d{2})/g)) {
    const start = m.index + m[0].lastIndexOf(m[2]);
    if (!found.some(f => f.start === start)) found.push({ key:'hours', scope:m[1], value:m[2], start, length:m[2].length, target:'', label:'営業時間' });
  }
  for (const m of text.matchAll(/([月火水木金土日]曜日)を定休日に/g)) {
    found.push({ key:'day', scope:'', value:m[1], start:m.index, length:m[1].length,
      target:text.slice(0, m.index).replace(/の$/, '').trim(), label:'定休日' });
  }
  return found;
}

function revision(item) {
  return createHash('sha256').update(JSON.stringify([item.id, item.category, item.title, item.body, item.source, item.active, item.updatedAt])).digest('hex');
}
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

async function proposeMemory(message, repository, ownerId, config, req) {
  const initial = memoryCandidates(message, config, req);
  if (!initial.length) return [];
  const candidate = initial[0];
  // Fetch independently of the small AI context limit: never decide uniqueness from top search hits.
  const rows = await repository.candidateRecords(ownerId);
  const review = () => [{ ...candidate, kind:'review', reason:'同じ対象・項目を安全に特定できません。設定画面で既存情報を確認してください。' }];
  if (rows.length > 200) return review();
  const safeRows = rows.filter(row => {
    const checked = validateKnowledge({ ...row, confirmed:true }, config, req);
    return row.active && checked && checked !== 'secret';
  });
  if (safeRows.length !== rows.length) return review();
  const incoming = facts(message);
  if (incoming.length !== 1) return rows.length ? review() : initial;
  const fact = incoming[0];
  const possible = safeRows.flatMap(row => facts(row.body).filter(f => f.key === fact.key && f.scope === fact.scope && (!['monthly', 'annual'].includes(f.key) || /目標/.test(row.title + row.body))).map(f => ({ row, fact:f })));
  const target = normalize(fact.target);
  const matches = possible.filter(({ row, fact:old }) => !target ||
    normalize(old.target) === target || normalize(row.title) === target ||
    normalize(row.title) === target + normalize(fact.label));
  if (!matches.length) {
    // A known field with an unrecognized format/subject must not silently become duplicate knowledge.
    return safeRows.some(row => (row.body + row.title).includes(fact.label)) ? review() : initial;
  }
  if (matches.length !== 1) return review();
  const { row, fact:old } = matches[0];
  if (normalize(old.value) === normalize(fact.value)) return [{ ...candidate, kind:'duplicate', reason:'同じ値がすでに登録されています。登録・更新は不要です。' }];
  const body = row.body.slice(0, old.start) + fact.value + row.body.slice(old.start + old.length);
  const value = validateKnowledge({ ...row, body, confirmed:true }, config, req);
  if (!value || value === 'secret') return review();
  return [{ ...value, kind:'update', knowledgeId:row.id, previousBody:row.body, expectedRevision:revision(row), message,
    reason:`${fact.scope}${fact.label}の値が変わります。${target ? '' : '対象名は発言にないため、表示した既存情報の対象で正しいか確認してください。'}その他の情報は維持します。` }];
}
module.exports = { proposeMemory, facts, revision };
