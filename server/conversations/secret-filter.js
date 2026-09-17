'use strict';

// Known credentials and common credential formats must not enter conversation storage or provider context.
function containsSecret(value, config, req) {
  const text = String(value);
  const known = [config.openai.apiKey, config.database.url, config.owner.passwordHash,
    req?.headers?.cookie, req?.headers?.authorization].filter(item => typeof item === 'string' && item.length >= 8);
  return known.some(secret => text.includes(secret)) ||
    /(?:sk-[A-Za-z0-9_-]{16,}|postgres(?:ql)?:\/\/\S+|scrypt\$[^\s]+|mk1_owner_session=\S+|Bearer\s+\S+)/i.test(text);
}

module.exports = { containsSecret };
