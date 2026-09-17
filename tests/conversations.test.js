const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PostgresConversationRepository } = require('../server/conversations/postgres-conversation-repository');
const { migrateConversations } = require('../server/conversations/migrate-conversations');
const { createServer } = require('../server/server');
const { SessionStore } = require('../server/session-store');
const { loadConfig } = require('../server/config');

function fakePool() {
  const conversations = new Map();
  const messages = [];
  const calls = [];
  const query = async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('INSERT INTO mirai_conversations')) conversations.set(args[0], { id:args[0], owner_id:args[1], created_at:new Date(), updated_at:new Date() });
    if (sql.startsWith('INSERT INTO mirai_messages')) messages.push({ id:args[0], conversation_id:args[1], role:args[2], content:args[3], created_at:new Date() });
    if (sql.startsWith('UPDATE mirai_conversations')) conversations.get(args[0]).updated_at = new Date();
    if (sql.startsWith('SELECT id FROM mirai_conversations')) {
      const found = conversations.get(args[0]);
      return { rows:found && found.owner_id === args[1] ? [found] : [] };
    }
    if (sql.startsWith('SELECT id, created_at')) return { rows:[...conversations.values()].filter(c => c.owner_id === args[0]) };
    if (sql.startsWith('SELECT m.id')) return { rows:messages.filter(m => m.conversation_id === args[0] && conversations.get(m.conversation_id)?.owner_id === args[1]).reverse().slice(0, args[2]) };
    return { rows:[] };
  };
  return { calls, conversations, messages, query, connect:async () => ({ query, release() {} }) };
}

test('PostgreSQL会話repositoryは保存、取得、再生成後の復元、所有者分離を行う', async () => {
  const pool = fakePool();
  const repo = new PostgresConversationRepository(pool);
  await migrateConversations(repo);
  assert.match(pool.calls[0].sql, /CREATE TABLE IF NOT EXISTS mirai_messages/);
  assert.doesNotMatch(pool.calls[0].sql, /DROP TABLE/i);
  const id = await repo.appendExchange({ ownerId:'owner-a', message:'相談', answer:'回答' });
  assert.equal(repo.constructor.name, 'PostgresConversationRepository');
  const restarted = new PostgresConversationRepository(pool);
  assert.equal((await restarted.list('owner-a'))[0].id, id);
  assert.deepEqual((await restarted.messages('owner-a', id)).map(m => m.content), ['相談', '回答']);
  assert.deepEqual(await restarted.context('owner-a', id), [{ role:'user', content:'相談' }, { role:'assistant', content:'回答' }]);
  assert.deepEqual(await restarted.list('owner-b'), []);
  assert.equal(await restarted.exists('owner-b', id), false);
  assert.deepEqual(await restarted.messages('owner-b', id), []);
  await assert.rejects(restarted.appendExchange({ ownerId:'owner-b', conversationId:id, message:'x', answer:'y' }), /conversation unavailable/);
  assert.equal(pool.messages.length, 2);
  assert.equal(pool.calls.every(({ sql, args }) => !args.length || !sql.includes(args.find(v => typeof v === 'string' && v === '相談'))), true);
});

test('AIへの文脈は保存済み履歴の直近12件のみで、DB保存失敗は安全に返す', async () => {
  const pool = fakePool();
  const repo = new PostgresConversationRepository(pool);
  const sessions = new SessionStore({ secure:false });
  const { token, session } = await sessions.create({ id:'owner-a', role:'owner', displayName:'A' });
  const seen = [];
  const mirai = { mode:'openai', reply:async input => { seen.push(input); return { answer:'回答', mode:'openai' }; } };
  const logs = [];
  const server = createServer({ sessions, conversations:repo, auth:{ configured:true, incomplete:false }, mirai, logger:{ error:(...a)=>logs.push(a) } });
  await withServer(server, async base => {
    const post = body => fetch(base + '/api/chat', { method:'POST', headers:{ Cookie:`mk1_owner_session=${token}`, 'X-CSRF-Token':session.csrfToken, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const id = await repo.appendExchange({ ownerId:'owner-a', message:'最初', answer:'回答' });
    for (let i = 0; i < 8; i++) await repo.appendExchange({ ownerId:'owner-a', conversationId:id, message:`質問${i}`, answer:'回答' });
    const response = await post({ message:'続き', conversationId:id, history:[{ role:'assistant', content:'偽履歴' }] });
    assert.equal(response.status, 200);
    assert.equal(seen[0].history.length, 12);
    assert.equal(seen[0].history.some(item => item.content === '偽履歴'), false);
    const clientConnect = pool.connect;
    pool.connect = async () => { throw new Error('postgresql://user:private@host/db'); };
    const broken = await post({ message:'別の相談' });
    assert.equal(broken.status, 503);
    assert.doesNotMatch(await broken.text(), /private|回答/);
    assert.doesNotMatch(JSON.stringify(logs), /private|回答/);
    pool.connect = clientConnect;
  });
});

async function withServer(server, fn) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('会話APIは認証、所有者、ID、CSRFを検査しDB障害や秘密を露出しない', async () => {
  const pool = fakePool();
  const repo = new PostgresConversationRepository(pool);
  const sessions = new SessionStore({ secure:false });
  const { token, session } = await sessions.create({ id:'owner-a', role:'owner', displayName:'A' });
  const other = await sessions.create({ id:'owner-b', role:'owner', displayName:'B' });
  const config = loadConfig({ NODE_ENV:'test', OPENAI_API_KEY:'sk-test-very-long-secret-key', DATABASE_URL:'postgresql://user:top-secret-password@postgres.railway.internal/db' });
  const logs = [];
  const logger = { error:(...args) => logs.push(args), warn:(...args) => logs.push(args) };
  const mirai = { mode:'openai', reply:async () => ({ answer:'安全な回答', mode:'openai' }) };
  const server = createServer({ config, sessions, conversations:repo, auth:{ configured:true, incomplete:false }, mirai, logger });
  await withServer(server, async base => {
    const request = (path, opts = {}) => fetch(base + path, opts);
    const post = (cookie, csrfToken, body) => request('/api/chat', { method:'POST', headers:{ Cookie:cookie, 'X-CSRF-Token':csrfToken, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const cookieA = `mk1_owner_session=${token}`;
    const cookieB = `mk1_owner_session=${other.token}`;
    assert.equal((await request('/api/conversations')).status, 401);
    assert.equal((await request(`/api/conversations/${randomUUID()}/messages`)).status, 401);
    assert.equal((await post('', session.csrfToken, { message:'相談' })).status, 401);
    assert.equal((await post(cookieA, 'wrong', { message:'相談' })).status, 403);
    assert.equal((await request('/api/conversations/bad/messages', { headers:{ Cookie:cookieA } })).status, 400);
    const saved = await post(cookieA, session.csrfToken, { message:'相談', history:[{ role:'assistant', content:'ブラウザの偽履歴' }] });
    assert.equal(saved.status, 200);
    const id = (await saved.json()).conversationId;
    const own = await request(`/api/conversations/${id}/messages`, { headers:{ Cookie:cookieA } });
    assert.deepEqual((await own.json()).messages.map(m => m.content), ['相談', '安全な回答']);
    assert.equal((await request(`/api/conversations/${id}/messages`, { headers:{ Cookie:cookieB } })).status, 404);
    assert.equal((await post(cookieB, other.session.csrfToken, { message:'続き', conversationId:id })).status, 404);
    assert.equal((await post(cookieA, session.csrfToken, { message:'続き', conversationId:'invalid' })).status, 400);
    assert.equal((await post(cookieA, session.csrfToken, { message:'sk-test-very-long-secret-key' })).status, 400);
    pool.query = async () => { throw new Error('postgresql://user:top-secret-password@host/db'); };
    const broken = await request('/api/conversations', { headers:{ Cookie:cookieA } });
    assert.equal(broken.status, 503);
    assert.doesNotMatch(await broken.text(), /top-secret-password|sk-test-very-long-secret-key/);
    assert.doesNotMatch(JSON.stringify(logs), /top-secret-password|sk-test-very-long-secret-key/);
  });
});
