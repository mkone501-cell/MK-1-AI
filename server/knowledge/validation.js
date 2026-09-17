'use strict';

const { containsSecret } = require('../conversations/secret-filter');

// 登録前に本文だけでなく、タイトル・カテゴリ・情報源も同様に検査する。
const credentialHint = /(?:api[_ -]?key|password|passwd|パスワード|cookie|クッキー|session[_ -]?(?:id|token)|セッション(?:id|ＩＤ)|authorization|secret[_ -]?key|秘密鍵|private\s+key|bearer|access[_ -]?token|トークン)/i;

function validateKnowledge(body, config, req) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmed !== true) return null;
  const limits = { category:40, title:120, body:3000, source:500 };
  const item = {};
  for (const [field, max] of Object.entries(limits)) {
    if (typeof body[field] !== 'string') return null;
    const value = body[field].trim();
    if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
    item[field] = value;
  }
  const combined = Object.values(item).join('\n');
  if (containsSecret(combined, config, req) || credentialHint.test(combined)) return 'secret';
  return item;
}

// 単純な文字列検索。特殊なLIKE文字を除き、候補数を固定する。
function searchPatterns(question) {
  const chunks = String(question).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]+/gu) || [];
  const terms = [];
  for (const chunk of chunks) {
    if (/^[a-z0-9]+$/i.test(chunk)) {
      if (chunk.length >= 3) terms.push(chunk.toLowerCase());
    } else {
      for (let i = 0; i <= chunk.length - 3; i++) terms.push(chunk.slice(i, i + 3));
    }
  }
  return [...new Set(terms)].slice(0, 20).map(term => `%${term.replace(/[\\%_]/g, '\\$&')}%`);
}

module.exports = { validateKnowledge, searchPatterns };
