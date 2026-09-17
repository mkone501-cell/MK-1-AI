const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresSessionRepository, poolOptions } = require('../server/session-stores/postgres-session-repository');
const { DatabaseSessionStore } = require('../server/session-stores/database-session-store');
const { createSessionStore } = require('../server/session-store-factory');
const { loadConfig } = require('../server/config');
const { migrateSessions } = require('../server/session-stores/migrate-sessions');
const { createServer, start } = require('../server/server');

function fakePool() {
  const rows = new Map();
  const calls = [];
  return {
    rows, calls,
    async query(sql, args = []) {
      calls.push({ sql, args });
      if (sql.startsWith('INSERT')) rows.set(args[0], { user_id:args[1], user_role:args[2], display_name:args[3], csrf_token:args[4], expires_at:args[5] });
      if (sql.startsWith('DELETE')) rows.delete(args[0]);
      return { rows:sql.startsWith('SELECT user_id') ? (rows.has(args[0]) ? [rows.get(args[0])] : []) : [] };
    },
    async end() {}
  };
}

test('PostgreSQL repositoryは保存・取得・削除にパラメータ付きSQLを使う', async () => {
  const pool = fakePool();
  const repo = new PostgresSessionRepository(pool);
  const hash = 'a'.repeat(64);
  const session = { user:{ id:'owner-inoue', role:'owner', displayName:'井上さん' }, csrfToken:'csrf', expiresAt:Date.now()+10000 };
  await repo.insert({ tokenHash:hash, session });
  assert.deepEqual(await repo.findByTokenHash(hash), session);
  assert.equal(await repo.findByTokenHash('b'.repeat(64)), null);
  await repo.deleteByTokenHash(hash);
  assert.equal(await repo.findByTokenHash(hash), null);
  assert.match(pool.calls[0].sql, /\$1/);
  assert.equal(pool.calls[0].sql.includes(hash), false);
  await migrateSessions(repo);
  assert.match(pool.calls.at(-1).sql, /CREATE TABLE IF NOT EXISTS/);
  assert.doesNotMatch(pool.calls.at(-1).sql, /DROP TABLE/i);
});

test('DBセッションは生トークンを保存せず、期限切れ・存在しないCookieを拒否する', async () => {
  let now = Date.now();
  const pool = fakePool();
  const store = new DatabaseSessionStore({ repository:new PostgresSessionRepository(pool), now:() => now, ttlMs:100 });
  const { token } = await store.create({ id:'owner-inoue', role:'owner', displayName:'井上さん' });
  assert.equal(JSON.stringify(pool.calls).includes(token), false);
  const request = value => ({ headers:{ cookie:`mk1_owner_session=${value}` } });
  assert.equal((await store.getFromRequest(request(token))).session.user.role, 'owner');
  assert.equal(await store.getFromRequest(request('forged')), null);
  now += 101;
  assert.equal(await store.getFromRequest(request(token)), null);
  assert.equal(pool.rows.size, 0);
});

test('DATABASE_URLは安全に検査し、Railway内部は私設接続・外部は証明書検証', () => {
  assert.throws(() => poolOptions(''), /DATABASE_URLが未設定/);
  const secret = 'super-secret-password';
  assert.throws(() => poolOptions(`postgresql://user:${secret}@db.example.invalid/db?sslmode=disable`), e => !e.message.includes(secret));
  assert.equal(poolOptions('postgresql://user:dummy@postgres.railway.internal:5432/railway').ssl, false);
  assert.deepEqual(poolOptions('postgresql://user:dummy@db.example.invalid/db').ssl, { rejectUnauthorized:true });
});

test('SESSION_STORE=databaseはPostgreSQL repositoryをストアへ注入する', async () => {
  const config = loadConfig({ NODE_ENV:'test', SESSION_STORE:'database', DATABASE_URL:'postgresql://user:dummy@postgres.railway.internal/railway' });
  const store = createSessionStore(config);
  assert.ok(store.repository instanceof PostgresSessionRepository);
  assert.equal(store.secure, false);
  await store.repository.close();
});

test('初回起動時に安全なmigrationとDB確認を終えてからPORTで待ち受ける', async () => {
  const pool = fakePool();
  const repo = new PostgresSessionRepository(pool);
  const config = loadConfig({ NODE_ENV:'test', SESSION_STORE:'database', DATABASE_URL:'postgresql://user:dummy@postgres.railway.internal/railway' });
  const server = await start({ config:{ ...config, port:0 }, sessionRepository:repo });
  try {
    assert.match(pool.calls[0].sql, /CREATE TABLE IF NOT EXISTS/);
    assert.match(pool.calls[1].sql, /CREATE TABLE IF NOT EXISTS mirai_conversations/);
    assert.match(pool.calls[2].sql, /CREATE TABLE IF NOT EXISTS management_knowledge/);
    assert.equal(pool.calls[3].sql, 'SELECT 1');
    assert.ok(server.address().port > 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('本番/api/healthは認証必須で、公開/healthはDB障害を秘密なしで返す', async () => {
  const pool = fakePool();
  const repo = new PostgresSessionRepository(pool);
  const config = loadConfig({ NODE_ENV:'production', SESSION_STORE:'database', ALLOWED_ORIGINS:'https://example.invalid', MK1_OWNER_EMAIL:'owner@example.invalid', MK1_OWNER_PASSWORD_HASH:'dummy-hash', DATABASE_URL:'postgresql://user:dummy@postgres.railway.internal/railway' });
  const server = createServer({ config, sessionRepository:repo });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    pool.query = async () => { throw new Error('postgresql://user:secret@host/db'); };
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 503);
    assert.doesNotMatch(await health.text(), /secret/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
