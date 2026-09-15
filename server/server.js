'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { MiraiService } = require('./mirai-service');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8000);
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT = 30;
const rateBuckets = new Map();
const mirai = new MiraiService({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.OPENAI_MODEL || 'gpt-5-mini'
});

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css']
]);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

function sendJson(res, status, value) {
  res.writeHead(status, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) reject(Object.assign(new Error('too large'), { statusCode: 413 }));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('invalid json'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function isRateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'mk1-mirai', mode: mirai.mode });
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    if (isRateLimited(req)) return sendJson(res, 429, { error: 'しばらく待ってから、もう一度お試しください。' });
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

function createServer() {
  return http.createServer((req, res) => handler(req, res).catch(error => {
    console.error('[server]', error.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'サーバーエラーが発生しました。' });
    else res.end();
  }));
}

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`MK-1 AI経営本部: http://localhost:${PORT}`);
    console.log(`ミライ: ${mirai.mode === 'openai' ? 'OpenAI接続モード' : 'APIキー未設定・デモモード'}`);
  });
}

module.exports = { createServer, handler, securityHeaders };

