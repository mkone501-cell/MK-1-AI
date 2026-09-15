'use strict';

const VALID_ENVIRONMENTS = new Set(['development', 'test', 'production']);
const VALID_SAME_SITE = new Set(['Strict', 'Lax', 'None']);

function splitOrigins(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).map(item => new URL(item).origin);
}

function loadConfig(env = process.env) {
  const environment = env.NODE_ENV || 'development';
  if (!VALID_ENVIRONMENTS.has(environment)) throw new Error('NODE_ENVはdevelopment、test、productionのいずれかにしてください。');
  const production = environment === 'production';
  const port = Number(env.PORT || 8000);
  const sameSite = env.COOKIE_SAME_SITE || 'Strict';
  if (!VALID_SAME_SITE.has(sameSite)) throw new Error('COOKIE_SAME_SITEはStrict、Lax、Noneのいずれかにしてください。');
  const secure = production || env.COOKIE_SECURE === 'true';
  if (sameSite === 'None' && !secure) throw new Error('SameSite=NoneにはSecure Cookieが必要です。');

  const config = {
    environment,
    production,
    port,
    allowedOrigins: splitOrigins(env.ALLOWED_ORIGINS || (production ? '' : `http://localhost:${port},http://127.0.0.1:${port}`)),
    cookie: { secure, sameSite },
    session: { driver: env.SESSION_STORE || (production ? 'database' : 'memory'), ttlMs: Number(env.SESSION_TTL_SECONDS || 28800) * 1000 },
    owner: { email: env.MK1_OWNER_EMAIL || '', passwordHash: env.MK1_OWNER_PASSWORD_HASH || '' },
    openai: { apiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-5-mini' }
  };

  if (production) {
    if (!config.allowedOrigins.length || config.allowedOrigins.some(origin => !origin.startsWith('https://'))) throw new Error('本番ALLOWED_ORIGINSにはHTTPSの許可Originが必要です。');
    if (!config.owner.email || !config.owner.passwordHash) throw new Error('本番ではオーナー認証設定が必須です。');
    if (config.session.driver !== 'database') throw new Error('本番では永続DBセッションが必須です。');
  }
  return Object.freeze(config);
}

module.exports = { loadConfig, splitOrigins };
