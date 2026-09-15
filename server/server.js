'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { MiraiService } = require('./mirai-service');
const { AuthService } = require('./auth-service');
const { loadConfig } = require('./config');
const { createSessionStore } = require('./session-store-factory');
const { createAuthGuard } = require('./auth-guard');
const { createLogger } = require('./safe-logger');

const ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 30;
const publicFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/auth.js', 'auth.js'], ['/styles.css', 'styles.css']]);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }));
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let rejected = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      if (rejected) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        rejected = true;
        reject(Object.assign(new Error('too large'), { statusCode: 413 }));
      }
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('invalid json'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function requestOriginAllowed(req, config) {
  const origin = req.headers.origin;
  if (!origin) return !config.production;
  try { return config.allowedOrigins.includes(new URL(origin).origin); }
  catch { return false; }
}

function createApplication(options = {}) {
  const config = options.config || loadConfig(options.env || process.env);
  const logger = options.logger || createLogger();
  const auth = options.auth || new AuthService({ ownerEmail: config.owner.email, passwordHash: config.owner.passwordHash });
  const sessions = options.sessions || createSessionStore(config, { sessionRepository: options.sessionRepository });
  const mirai = options.mirai || new MiraiService({
    // 認証未設定のサーバーから有料APIを利用しない安全弁です。
    apiKey: auth.configured ? config.openai.apiKey : '',
    model: config.openai.model
  });
  const rateBuckets = new Map();

  function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !requestOriginAllowed(req, config)) return { Vary: 'Origin' };
    return {
      'Access-Control-Allow-Origin': new URL(origin).origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin'
    };
  }

  function respondJson(req, res, status, value, extraHeaders = {}) {
    sendJson(res, status, value, { ...corsHeaders(req), ...extraHeaders });
  }

  const requireOwner = createAuthGuard({ auth, sessions, sendJson: respondJson });

  function isRateLimited(req, scope = 'general', limit = RATE_LIMIT) {
    const key = `${scope}:${req.socket.remoteAddress || 'unknown'}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= 60_000) {
      rateBuckets.set(key, { startedAt: now, count: 1 });
      return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if ((url.pathname.startsWith('/api/') || url.pathname === '/health') && req.headers.origin && !requestOriginAllowed(req, config)) {
      return respondJson(req, res, 403, { error: '許可されていない接続元です。', code: 'ORIGIN_NOT_ALLOWED' });
    }

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204, securityHeaders({ ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token', 'Access-Control-Max-Age': '600' }));
      return res.end();
    }

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
      return respondJson(req, res, 200, { ok: true, service: 'mk1-mirai', mode: mirai.mode, environment: config.environment, sessionStore: config.session.driver, authentication: auth.incomplete ? 'invalid' : auth.configured ? 'required' : 'setup' });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const current = auth.configured ? await sessions.getFromRequest(req) : null;
      return respondJson(req, res, 200, {
        configured: auth.configured,
        authenticated: Boolean(current),
        user: current ? current.session.user : null,
        csrfToken: current ? current.session.csrfToken : null
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error: 'この画面からログインしてください。' });
      if (!auth.configured) return respondJson(req, res, 503, { error: 'ログイン設定がまだ完了していません。', code: 'AUTH_NOT_CONFIGURED' });
      if (isRateLimited(req, 'login', 5)) return respondJson(req, res, 429, { error: 'ログイン試行が多すぎます。1分後にお試しください。' });
      try {
        const body = await readJson(req);
        const user = await auth.authenticate(body.email, body.password);
        if (!user) return respondJson(req, res, 401, { error: 'メールアドレスまたはパスワードが違います。' });
        const { token, session } = await sessions.create(user);
        return respondJson(req, res, 200, { authenticated: true, user, csrfToken: session.csrfToken }, { 'Set-Cookie': sessions.cookie(token) });
      } catch (error) {
        logger.warn('auth.login_failed', { reason: error.message });
        return respondJson(req, res, error.statusCode || 400, { error: 'ログイン情報を確認できませんでした。' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error: '安全確認に失敗しました。' });
      const session = await requireOwner(req, res, { csrf: true });
      if (!session) return;
      await sessions.destroy(req);
      return respondJson(req, res, 200, { authenticated: false }, { 'Set-Cookie': sessions.clearCookie() });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!requestOriginAllowed(req, config)) return respondJson(req, res, 403, { error: 'この画面からミライをご利用ください。' });
      const session = await requireOwner(req, res, { csrf: auth.configured, allowSetupMode: !config.production });
      if (!session) return;
      if (isRateLimited(req, 'chat')) return respondJson(req, res, 429, { error: 'しばらく待ってから、もう一度お試しください。' });
      try {
        const body = await readJson(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message || message.length > 8000) return respondJson(req, res, 400, { error: 'メッセージは1文字以上8,000文字以内で入力してください。' });
        const history = Array.isArray(body.history) ? body.history : [];
        return respondJson(req, res, 200, await mirai.reply({ message, history }));
      } catch (error) {
        const status = error.statusCode || 502;
        logger.error('mirai.request_failed', { message: error.message });
        return respondJson(req, res, status, { error: status === 502 ? 'ミライとの通信に失敗しました。時間をおいてお試しください。' : 'リクエストを確認できませんでした。' });
      }
    }

    // 将来の非公開APIは必ずこの共通ガードを通すテンプレートです。
    if (req.method === 'GET' && url.pathname === '/api/private/ping') {
      const session = await requireOwner(req, res);
      if (!session) return;
      return respondJson(req, res, 200, { ok: true, role: session.user.role });
    }

    if (req.method === 'GET' && publicFiles.has(url.pathname)) {
      const file = path.join(ROOT, publicFiles.get(url.pathname));
      const type = contentTypes[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, securityHeaders({ 'Content-Type': type, 'Cache-Control': 'public, max-age=300' }));
      return fs.createReadStream(file).pipe(res);
    }

    respondJson(req, res, 404, { error: '見つかりません。' });
  }

  return { handler, auth, sessions, mirai, config };
}

function createServer(options = {}) {
  const app = createApplication(options);
  return http.createServer((req, res) => app.handler(req, res).catch(error => {
    (options.logger || createLogger()).error('server.unhandled', { message: error.message });
    if (!res.headersSent) sendJson(res, 500, { error: 'サーバーエラーが発生しました。' });
    else res.end();
  }));
}

if (require.main === module) {
  const app = createApplication();
  if (app.auth.incomplete) {
    console.error('MK1_OWNER_EMAILとMK1_OWNER_PASSWORD_HASHの両方を設定してください。');
    process.exit(1);
  }
  http.createServer((req, res) => app.handler(req, res)).listen(app.config.port, '0.0.0.0', () => {
    console.log(`MK-1 AI経営本部: http://localhost:${app.config.port}`);
    console.log(`ログイン: ${app.auth.configured ? '井上さん専用認証' : '未設定・デモのみ'}`);
    console.log(`ミライ: ${app.mirai.mode === 'openai' ? 'OpenAI接続モード' : 'APIキー未設定・デモモード'}`);
  });
}

module.exports = { createApplication, createServer, securityHeaders, requestOriginAllowed };
