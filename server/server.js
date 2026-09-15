'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { MiraiService } = require('./mirai-service');
const { AuthService } = require('./auth-service');
const { SessionStore } = require('./session-store');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8000);
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

function sameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

function createApplication(options = {}) {
  const auth = options.auth || new AuthService({ ownerEmail: process.env.MK1_OWNER_EMAIL, passwordHash: process.env.MK1_OWNER_PASSWORD_HASH });
  const sessions = options.sessions || new SessionStore();
  const mirai = options.mirai || new MiraiService({
    // 認証未設定のサーバーから有料APIを利用しない安全弁です。
    apiKey: auth.configured ? (process.env.OPENAI_API_KEY || '') : '',
    model: process.env.OPENAI_MODEL || 'gpt-5-mini'
  });
  const rateBuckets = new Map();

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

  function requireOwner(req, res, { csrf = false } = {}) {
    if (!auth.configured) return { setupMode: true };
    const current = sessions.getFromRequest(req);
    if (!current?.session?.user || current.session.user.role !== 'owner') {
      sendJson(res, 401, { error: 'ログインが必要です。', code: 'AUTH_REQUIRED' });
      return null;
    }
    if (csrf && req.headers['x-csrf-token'] !== current.session.csrfToken) {
      sendJson(res, 403, { error: '安全確認に失敗しました。もう一度ログインしてください。', code: 'CSRF_INVALID' });
      return null;
    }
    return current.session;
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'mk1-mirai', mode: mirai.mode, authentication: auth.incomplete ? 'invalid' : auth.configured ? 'required' : 'setup' });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/status') {
      const current = auth.configured ? sessions.getFromRequest(req) : null;
      return sendJson(res, 200, {
        configured: auth.configured,
        authenticated: Boolean(current),
        user: current ? current.session.user : null,
        csrfToken: current ? current.session.csrfToken : null
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!sameOriginRequest(req)) return sendJson(res, 403, { error: 'この画面からログインしてください。' });
      if (!auth.configured) return sendJson(res, 503, { error: 'ログイン設定がまだ完了していません。', code: 'AUTH_NOT_CONFIGURED' });
      if (isRateLimited(req, 'login', 5)) return sendJson(res, 429, { error: 'ログイン試行が多すぎます。1分後にお試しください。' });
      try {
        const body = await readJson(req);
        const user = await auth.authenticate(body.email, body.password);
        if (!user) return sendJson(res, 401, { error: 'メールアドレスまたはパスワードが違います。' });
        const { token, session } = sessions.create(user);
        return sendJson(res, 200, { authenticated: true, user, csrfToken: session.csrfToken }, { 'Set-Cookie': sessions.cookie(token) });
      } catch (error) {
        return sendJson(res, error.statusCode || 400, { error: 'ログイン情報を確認できませんでした。' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (!sameOriginRequest(req)) return sendJson(res, 403, { error: '安全確認に失敗しました。' });
      const session = requireOwner(req, res, { csrf: true });
      if (!session) return;
      sessions.destroy(req);
      return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': sessions.clearCookie() });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!sameOriginRequest(req)) return sendJson(res, 403, { error: 'この画面からミライをご利用ください。' });
      const session = requireOwner(req, res, { csrf: auth.configured });
      if (!session) return;
      if (isRateLimited(req, 'chat')) return sendJson(res, 429, { error: 'しばらく待ってから、もう一度お試しください。' });
      try {
        const body = await readJson(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message || message.length > 8000) return sendJson(res, 400, { error: 'メッセージは1文字以上8,000文字以内で入力してください。' });
        const history = Array.isArray(body.history) ? body.history : [];
        return sendJson(res, 200, await mirai.reply({ message, history }));
      } catch (error) {
        const status = error.statusCode || 502;
        console.error('[mirai]', error.message);
        return sendJson(res, status, { error: status === 502 ? 'ミライとの通信に失敗しました。時間をおいてお試しください。' : 'リクエストを確認できませんでした。' });
      }
    }

    if (req.method === 'GET' && publicFiles.has(url.pathname)) {
      const file = path.join(ROOT, publicFiles.get(url.pathname));
      const type = contentTypes[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, securityHeaders({ 'Content-Type': type, 'Cache-Control': 'public, max-age=300' }));
      return fs.createReadStream(file).pipe(res);
    }

    sendJson(res, 404, { error: '見つかりません。' });
  }

  return { handler, auth, sessions, mirai };
}

function createServer(options = {}) {
  const app = createApplication(options);
  return http.createServer((req, res) => app.handler(req, res).catch(error => {
    console.error('[server]', error.message);
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
  http.createServer((req, res) => app.handler(req, res)).listen(PORT, '0.0.0.0', () => {
    console.log(`MK-1 AI経営本部: http://localhost:${PORT}`);
    console.log(`ログイン: ${app.auth.configured ? '井上さん専用認証' : '未設定・デモのみ'}`);
    console.log(`ミライ: ${app.mirai.mode === 'openai' ? 'OpenAI接続モード' : 'APIキー未設定・デモモード'}`);
  });
}

module.exports = { createApplication, createServer, securityHeaders, sameOriginRequest };
