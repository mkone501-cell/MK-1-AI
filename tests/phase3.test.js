const test = require('node:test');
const assert = require('node:assert/strict');

const { AuthService } = require('../server/auth-service');
const { loadConfig } = require('../server/config');
const { hashPassword } = require('../server/password');
const { redact } = require('../server/safe-logger');
const { MemorySessionStore } = require('../server/session-stores/memory-session-store');
const { DatabaseSessionStore } = require('../server/session-stores/database-session-store');
const { createServer } = require('../server/server');

const owner = { id:'owner-inoue', role:'owner', displayName:'井上さん' };
const request = cookie => ({ headers:{ cookie:`mk1_owner_session=${cookie}` } });

function fakeRepository() {
  const rows = new Map();
  return {
    rows,
    async insert({ tokenHash, session }) { rows.set(tokenHash, structuredClone(session)); },
    async findByTokenHash(tokenHash) { return rows.get(tokenHash) || null; },
    async deleteByTokenHash(tokenHash) { rows.delete(tokenHash); }
  };
}

async function runningServer(options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base:`http://127.0.0.1:${server.address().port}` };
}

test('永続ストアへ渡すのはセッションIDではなくハッシュだけ', async () => {
  const repository = fakeRepository();
  const store = new DatabaseSessionStore({ repository, secure:true });
  const { token } = await store.create(owner);
  const [savedKey] = repository.rows.keys();
  assert.notEqual(savedKey, token);
  assert.match(savedKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify([...repository.rows.entries()]).includes(token), false);
  assert.equal((await store.getFromRequest(request(token))).session.user.role, 'owner');
});

test('偽造Cookie・他人のセッション・期限切れセッションを拒否', async () => {
  let now = 1000;
  const store = new MemorySessionStore({ ttlMs:100, now:() => now });
  assert.equal(await store.getFromRequest(request('forged-cookie')), null);
  const other = await store.create({ id:'other', role:'viewer' });
  assert.equal((await store.getFromRequest(request(other.token))).session.user.role, 'viewer');
  now = 1101;
  assert.equal(await store.getFromRequest(request(other.token)), null);
});

test('未認証・他人・偽造Cookieでは非公開APIを返さない', async () => {
  const password = 'owner-test-password-123';
  const auth = new AuthService({ ownerEmail:'owner@example.com', passwordHash:await hashPassword(password) });
  const sessions = new MemorySessionStore();
  const { server, base } = await runningServer({ auth, sessions, mirai:{ mode:'demo' }, env:{ NODE_ENV:'test' } });
  try {
    assert.equal((await fetch(`${base}/api/private/ping`)).status, 401);
    assert.equal((await fetch(`${base}/api/private/ping`, { headers:{ Cookie:'mk1_owner_session=forged' } })).status, 401);
    const other = await sessions.create({ id:'other', role:'viewer' });
    assert.equal((await fetch(`${base}/api/private/ping`, { headers:{ Cookie:`mk1_owner_session=${other.token}` } })).status, 401);
    const valid = await sessions.create(owner);
    const allowed = await fetch(`${base}/api/private/ping`, { headers:{ Cookie:`mk1_owner_session=${valid.token}` } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok:true, role:'owner' });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('CORSは許可Originだけへ資格情報付き応答を許可', async () => {
  const config = loadConfig({ NODE_ENV:'test', ALLOWED_ORIGINS:'https://mk1.example.invalid' });
  const { server, base } = await runningServer({ config, mirai:{ mode:'demo' } });
  try {
    const denied = await fetch(`${base}/api/health`, { headers:{ Origin:'https://evil.example.invalid' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const allowed = await fetch(`${base}/api/health`, { headers:{ Origin:'https://mk1.example.invalid' } });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://mk1.example.invalid');
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('本番はHTTPS Origin・Secure Cookie・DBセッションを強制', () => {
  assert.throws(() => loadConfig({ NODE_ENV:'production', ALLOWED_ORIGINS:'http://example.invalid', MK1_OWNER_EMAIL:'x', MK1_OWNER_PASSWORD_HASH:'x' }), /HTTPS/);
  assert.throws(() => loadConfig({ NODE_ENV:'production', ALLOWED_ORIGINS:'https://example.invalid', MK1_OWNER_EMAIL:'x', MK1_OWNER_PASSWORD_HASH:'x', SESSION_STORE:'memory' }), /永続DB/);
  const config = loadConfig({ NODE_ENV:'production', ALLOWED_ORIGINS:'https://example.invalid', MK1_OWNER_EMAIL:'x', MK1_OWNER_PASSWORD_HASH:'x' });
  assert.equal(config.cookie.secure, true);
  assert.equal(config.session.driver, 'database');
});

test('ログ保護は秘密項目・Bearer値・DB接続情報を伏せる', () => {
  const protectedValue = redact({ password:'secret', cookie:'session', apiKey:'key', note:'Bearer abc123', error:'postgresql://user:pass@db.example.invalid/db', safe:'ok' });
  assert.deepEqual(protectedValue, { password:'[REDACTED]', cookie:'[REDACTED]', apiKey:'[REDACTED]', note:'Bearer [REDACTED]', error:'postgresql://[REDACTED]@db.example.invalid/db', safe:'ok' });
});
