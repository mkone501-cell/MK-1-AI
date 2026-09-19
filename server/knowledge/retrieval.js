'use strict';

const MAX_TERMS = 36;
const MAX_CANDIDATES = 80;
const MAX_RESULTS = 4;
// 質問の言い換えと登録カテゴリを同じ話題として扱う。分野を増やす場合はここに追加する。
// 関連カテゴリは弱く扱い、店舗の相談で会社・事業の概要も候補にできるようにする。
const topics = [
  { name:'store', words:['店舗', 'お店', 'カフェ', 'コーヒー店', '珈琲店', 'コーヒーショップ', '喫茶店'],
    contentWords:['コーヒー', '珈琲', '焙煎', 'coffee', '店舗'], categories:['店舗'], related:['事業', '会社基本情報'] },
  { name:'company', words:['会社', '法人', '自社', '当社'], categories:['会社基本情報'], related:['事業'] },
  { name:'business', words:['事業', 'ビジネス'], categories:['事業'], related:['会社基本情報'] },
  { name:'property', words:['不動産', '物件', 'ビル', '賃貸'], categories:['不動産'], related:[] },
  { name:'commerce', words:['EC', '通販', 'ネットショップ', 'オンラインショップ'], categories:['EC'], related:[] },
  { name:'advertising', words:['広告', '宣伝', '集客'], categories:['広告'], related:[] },
  { name:'finance', words:['財務', '資金', '会計'], categories:['財務'], related:[] },
  { name:'policy', words:['経営方針', '承認ルール', '経営ルール'], categories:['経営方針', '承認ルール'], related:[] }
];
const aliases = new Map([
  ['お店', ['店舗', 'カフェ']], ['店舗', ['お店', 'カフェ']], ['カフェ', ['店舗', 'お店']],
  ['家賃', ['賃料']], ['賃料', ['家賃']], ['売上', ['売り上げ']], ['売り上げ', ['売上']],
  ['物件', ['不動産']], ['不動産', ['物件']],
  ['方針', ['経営方針']], ['経営方針', ['方針']], ['ec', ['ネットショップ']]
]);

function queryTerms(question) {
  const normalizedQuestion = String(question).normalize('NFKC').toLowerCase();
  // 英語の固有名詞の直後に日本語が続いても、両方の語を残す。
  const parts = normalizedQuestion.match(/[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]+/gu) || [];
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
    if (normalizedQuestion.includes(trigger.toLowerCase())) values.forEach(value => expanded.add(value));
  }
  const matchedTopics = topics.filter(topic => topic.words.some(word =>
    word === 'EC' ? /(?:^|[^a-z0-9])ec(?=$|[^a-z0-9])/.test(normalizedQuestion) : normalizedQuestion.includes(word.toLowerCase())) ||
    (topic.name === 'store' && /(?:私の|うちの|自分の|経営している|経営する)店(?!長)/u.test(normalizedQuestion)));
  for (const topic of matchedTopics) {
    topic.words.forEach(word => expanded.add(word));
    (topic.contentWords || []).forEach(word => expanded.add(word));
    topic.categories.concat(topic.related).forEach(category => expanded.add(category));
  }
  return { direct, expanded:[...expanded].filter(value => !direct.includes(value)).slice(0, 32), topics:matchedTopics };
}

function searchPatterns(question) {
  const { direct, expanded } = queryTerms(question);
  return [...direct, ...expanded].map(term => `%${term.replace(/[\\%_]/g, '\\$&')}%`);
}

function categoryPatterns(question) {
  const { topics:matchedTopics } = queryTerms(question);
  const primary = new Set(matchedTopics.flatMap(topic => topic.categories));
  const related = new Set(matchedTopics.flatMap(topic => topic.related).filter(value => !primary.has(value)));
  const pattern = term => `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  return { primary:[...primary].map(pattern), related:[...related].map(pattern) };
}

function rankKnowledge(rows, question) {
  const { direct, expanded, topics:matchedTopics } = queryTerms(question);
  const terms = [...direct, ...expanded];
  if (!terms.length) return [];
  const distinctive = direct.filter(term => !['経営', '教えて', 'について', '基本', '情報', '現在', '登録', '知りたい', 'ください'].includes(term) &&
    !matchedTopics.some(topic => topic.words.some(word => word.normalize('NFKC').toLowerCase().includes(term.toLowerCase()))));
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
    for (const topic of matchedTopics) {
      if (topic.categories.some(value => value.toLowerCase() === category)) hits.set(`topic:${topic.name}`, 6);
      else if (topic.related.some(value => value.toLowerCase() === category)) hits.set(`topic:${topic.name}`, 1.5);
    }
    const specific = distinctive.some(term => title.includes(term.toLowerCase()) || body.includes(term.toLowerCase()));
    return { row, hits, specific, score:[...hits.values()].reduce((sum, value) => sum + value, 0) };
  }).filter(entry => entry.score > 0);

  // 物件名などが一致する知識があれば、一般語だけで一致した別分野の知識は除く。
  // ただし質問に対応する主カテゴリ・関連カテゴリは、複数知識の回答のため残す。
  const specificCategories = new Set(candidates.filter(entry => entry.specific).map(entry => entry.row.category));
  const topicCategories = new Set(matchedTopics.flatMap(topic => topic.categories.concat(topic.related)));
  const hasSpecific = specificCategories.size > 0;
  const relevant = hasSpecific
    ? candidates.filter(entry => entry.specific || (topicCategories.has(entry.row.category) && !specificCategories.has(entry.row.category)))
    : candidates.filter(entry => entry.specific || !specificCategories.has(entry.row.category));

  const selected = [], covered = new Set();
  while (selected.length < MAX_RESULTS && relevant.length) {
    relevant.sort((a, b) => {
      const value = entry => entry.score * 0.35 + [...entry.hits].reduce((sum, [term, score]) => sum + (covered.has(term) ? 0 : score * 0.65), 0);
      return value(b) - value(a) || String(a.row.id).localeCompare(String(b.row.id));
    });
    const best = relevant.shift();
    selected.push(best.row);
    for (const term of best.hits.keys()) covered.add(term);
  }
  return selected;
}

module.exports = { queryTerms, searchPatterns, categoryPatterns, rankKnowledge, MAX_CANDIDATES };
