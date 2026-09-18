'use strict';

const { containsSecret } = require('../conversations/secret-filter');
const { searchPatterns } = require('./retrieval');

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

module.exports = { validateKnowledge, searchPatterns };
