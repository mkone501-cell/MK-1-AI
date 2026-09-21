'use strict';
const { createHash } = require('node:crypto');
const { memoryCandidates } = require('./candidates');
const { validateKnowledge } = require('./validation');

// Each descriptor defines a fact, not a whole document. Extend here for new fields.
const descriptors = [
  { key:'hours', label:'営業時間', re:/(平日|土日祝日|土日祝|土日|祝日)?(?:の)?営業時間(?:は|を|：|:)?\s*(平日|土日祝日|土日祝|土日|祝日)?\s*(\d{1,2}:\d{2}[〜～~\-]\d{1,2}:\d{2})/g },
  { key:'day', label:'定休日', re:/定休日(?:は|を|：|:)\s*([月火水木金土日]曜日)/g },
  { key:'monthly', label:'月商', re:/月商(?:目標)?(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'annual', label:'年商', re:/年商(?:目標)?(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'sales', label:'売上目標', re:/売上目標(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'price', label:'価格', re:/価格(?:は|を|：|:)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'staff', label:'スタッフ体制', re:/スタッフ体制(?:は|を|：|:)?\s*(\d+人体制)/g },
  { key:'rent', label:'家賃', re:/家賃(?:は|を|：|:)?\s*(?:月)?\s*(\d+(?:\.\d+)?万?円)/g },
  { key:'area', label:'面積', re:/面積(?:は|を|：|:)?\s*(\d+(?:\.\d+)?(?:㎡|平米))/g }
];

const normalizeScope = scope => scope === '土日祝日' ? '土日祝' : scope;

function facts(text) {
  const found = [];
  // New-menu decisions use natural language rather than a fixed "field: value" form.
  // Extract only the menu name so an explicit replacement can update the existing
  // confirmed decision while preserving the rest of the stored sentence.
  for (const m of text.matchAll(/新メニュー(?:は|を)\s*([^、。]+?)\s*に変更することに決め(?:ました|ます)/g)) {
    found.push({ key:'new_menu', scope:'', value:m[1].trim(), start:m.index + m[0].indexOf(m[1]), length:m[1].trim().length,
      target:'', label:'新メニュー' });
  }
  for (const m of text.matchAll(/([^、。]+?)を新メニューとして(?:販売|提供)することに決め(?:ました|ます)/g)) {
    const value = m[1].trim();
    const start = m.index + m[0].indexOf(m[1]) + (m[1].length - m[1].trimStart().length);
    if (!found.some(f => f.key === 'new_menu' && f.start === start)) {
      found.push({ key:'new_menu', scope:'', value, start, length:value.length, target:'', label:'新メニュー' });
    }
  }
  for (const d of descriptors) {
    const re = new RegExp(d.re.source, 'g');
    for (const match of text.matchAll(re)) {
      const value = match.at(-1);
      const scope = d.key === 'hours' ? normalizeScope(match[1] || match[2] || '全日') : '';
      found.push({ key:d.key, scope, value, start:match.index + match[0].lastIndexOf(value), length:value.length,
        target:text.slice(0, match.index).replace(/の$/, '').trim(), label:d.label });
    }
  }
  const hourTargets = [...new Set(found.filter(f => f.key === 'hours' && f.target).map(f => f.target))];
  // Hours listed after an initial heading, e.g. 営業時間は平日...、土日祝... .
  if (/営業時間/.test(text)) for (const m of text.matchAll(/(平日|土日祝日|土日祝|土日|祝日)\s*(\d{1,2}:\d{2}[〜～~\-]\d{1,2}:\d{2})/g)) {
    const start = m.index + m[0].lastIndexOf(m[2]);
    if (!found.some(f => f.start === start)) found.push({ key:'hours', scope:normalizeScope(m[1]), value:m[2], start, length:m[2].length, target:hourTargets.length === 1 ? hourTargets[0] : '', label:'営業時間' });
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
  const initial = memoryCandidates(message, config, req).map(item => ({ ...item, kind:'create' }));
  if (!initial.length) return [];
  const candidate = initial[0];
  // Fetch independently of the small AI context limit: never decide uniqueness from top search hits.
  const rows = await repository.candidateRecords(ownerId);
  const review = (related = []) => [{ ...candidate, kind:'review', reason:related.length > 1 ? '複数の有効な既存知識が該当します。設定画面で整理してください。' : '同じ対象・項目を安全に特定できません。設定画面で整理してください。',
    existingCount:related.length, existing:related.slice(0, 10).map(({ id, category, title, body }) => ({ id, category, title, body })) }];
  if (rows.length > 200) return review();
  const safeRows = rows.filter(row => {
    const checked = validateKnowledge({ ...row, confirmed:true }, config, req);
    return row.active && checked && checked !== 'secret';
  });
  if (safeRows.length !== rows.length) return review();
  const incoming = facts(message);
  if (incoming.length !== 1) {
    // A shared category is not enough to prove that a new, explicit decision updates
    // an existing record. Categories intentionally contain multiple independent facts.
    const identical = safeRows.filter(row =>
      normalize(row.category) === normalize(candidate.category) &&
      normalize(row.title) === normalize(candidate.title) &&
      normalize(row.body) === normalize(candidate.body));
    if (identical.length) return [{ ...candidate, kind:'duplicate', reason:'同じ内容がすでに登録されています。登録は不要です。' }];
    return initial;
  }
  const fact = incoming[0];
  const possible = safeRows.filter(row => normalize(row.category) === normalize(candidate.category)).flatMap(row => facts(row.body).filter(f => f.key === fact.key && f.scope === fact.scope && (!['monthly', 'annual'].includes(f.key) || /目標/.test(row.title + row.body))).map(f => ({ row, fact:f })));
  const target = normalize(fact.target);
  const matches = possible.filter(({ row, fact:old }) => {
    if (!target) return true;
    // An explicit subject in the body takes precedence over the document title.
    if (old.target) return normalize(old.target) === target;
    return normalize(row.title) === target || normalize(row.title) === target + normalize(fact.label);
  });
  if (!matches.length) {
    // A known field with an unrecognized format/subject must not silently become duplicate knowledge.
    const related = safeRows.filter(row => (row.body + row.title).includes(fact.label));
    return related.length ? review(related) : initial;
  }
  if (matches.length !== 1) return review([...new Map(matches.map(({ row }) => [row.id, row])).values()]);
  const { row, fact:old } = matches[0];
  if (normalize(old.value) === normalize(fact.value)) return [{ ...candidate, kind:'duplicate', reason:'同じ値がすでに登録されています。登録・更新は不要です。' }];
  const body = row.body.slice(0, old.start) + fact.value + row.body.slice(old.start + old.length);
  const value = validateKnowledge({ ...row, body, confirmed:true }, config, req);
  if (!value || value === 'secret') return review();
  return [{ ...value, kind:'update', knowledgeId:row.id, previousBody:row.body, expectedRevision:revision(row), message,
    reason:`${fact.scope}${fact.label}の値が変わります。${target ? '' : '対象名は発言にないため、表示した既存情報の対象で正しいか確認してください。'}その他の情報は維持します。` }];
}
module.exports = { proposeMemory, facts, revision };
