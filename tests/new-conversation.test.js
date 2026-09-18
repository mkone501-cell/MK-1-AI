const test = require('node:test');
const assert = require('node:assert/strict');
const { PostgresConversationRepository } = require('../server/conversations/postgres-conversation-repository');
const { PostgresKnowledgeRepository } = require('../server/knowledge/postgres-knowledge-repository');
const { SessionStore } = require('../server/session-store');
const { MiraiService } = require('../server/mirai-service');
const { createServer } = require('../server/server');
const { loadConfig } = require('../server/config');

// 同じ疑似PostgreSQLを別のrepositoryインスタンスから参照し、再起動後の復元を検証する。
function poolFixture() {
  const conversations = new Map(), messages = [], knowledge = new Map(), calls = [];
  let clock = 0;
  const query = async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.startsWith('INSERT INTO mirai_conversations')) {
      const time = new Date(1000 + ++clock * 1000);
      const row = { id:args[0], owner_id:args[1], created_at:time, updated_at:time };
      conversations.set(row.id, row);
      return { rows:[{ ...row }] };
    }
    if (sql.startsWith('SELECT id, created_at, updated_at FROM mirai_conversations')) {
      return { rows:[...conversations.values()].filter(c => c.owner_id === args[0]).sort((a,b) => b.created_at - a.created_at).slice(0,args[1]) };
    }
    if (sql.startsWith('SELECT id FROM mirai_conversations')) {
      const row = conversations.get(args[0]);
      return { rows:row?.owner_id === args[1] ? [{ id:row.id }] : [] };
    }
    if (sql.startsWith('INSERT INTO mirai_messages')) {
      messages.push({ id:args[0], conversation_id:args[1], role:args[2], content:args[3], created_at:new Date(1000 + ++clock * 1000) });
    }
    if (sql.startsWith('UPDATE mirai_conversations')) conversations.get(args[0]).updated_at = new Date(1000 + ++clock * 1000);
    if (sql.startsWith('SELECT m.id')) {
      return { rows:messages.filter(m => m.conversation_id === args[0] && conversations.get(m.conversation_id)?.owner_id === args[1]).slice(-args[2]).reverse() };
    }
    if (sql.startsWith('INSERT INTO management_knowledge')) {
      const row = { id:args[0], owner_id:args[1], category:args[2], title:args[3], body:args[4], source:args[5], active:true, created_at:new Date(), updated_at:new Date() };
      knowledge.set(row.id, row);
      return { rows:[{ ...row }] };
    }
    if (sql.includes('FROM management_knowledge') && sql.includes('ILIKE ANY')) {
      return { rows:[...knowledge.values()].filter(row => row.owner_id === args[0] && row.active && args[1].some(pattern => [row.title,row.body,row.category].some(value => value.includes(pattern.slice(1,-1))))).slice(0,args[2]) };
    }
    return { rows:[] };
  };
  return { conversations, messages, knowledge, calls, query, connect:async () => ({ query, release() {} }) };
}

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('新しい会話は空の別IDで永続化し、旧履歴を送らず長期知識777を参照する', async () => {
  const pool = poolFixture();
  const conversations = new PostgresConversationRepository(pool);
  const knowledge = new PostgresKnowledgeRepository(pool);
  const sessions = new SessionStore({ secure:false });
  const owner = await sessions.create({ id:'owner-a', role:'owner' });
  const other = await sessions.create({ id:'owner-b', role:'owner' });
  const config = loadConfig({ NODE_ENV:'test', OPENAI_API_KEY:'sk-test-placeholder-key', OPENAI_MODEL:'unchanged-model' });
  const providerInputs = [];
  const mirai = new MiraiService({ apiKey:config.openai.apiKey, model:config.openai.model, fetchImpl:async (_url, options) => {
    const request = JSON.parse(options.body);
    providerInputs.push(request);
    return { ok:true, json:async () => ({ output_text:request.input[0]?.content.includes('777') ? '好きな数字は777です。' : 'まだ分かりません。' }) };
  } });
  const oldId = await conversations.appendExchange({ ownerId:'owner-a', message:'前回だけの情報：青い傘', answer:'青い傘を覚えました' });
  await knowledge.create('owner-a', { category:'会社基本情報', title:'代表の好きな数字', body:'代表の好きな数字は777です', source:'本人が確認して登録' });
  const options = { config, sessions, conversations, knowledge, mirai, auth:{ configured:true, incomplete:false } };
  let newId;
  await withServer(options, async base => {
    const post = (person, path, data, csrf = person?.session.csrfToken) => fetch(base + path, { method:'POST', headers:{ ...(person ? { Cookie:`mk1_owner_session=${person.token}`, 'X-CSRF-Token':csrf } : {}), 'Content-Type':'application/json' }, body:JSON.stringify(data) });
    assert.equal((await post(null, '/api/conversations', {})).status, 401);
    assert.equal((await post(owner, '/api/conversations', {}, 'invalid')).status, 403);
    const created = await post(owner, '/api/conversations', {});
    assert.equal(created.status, 201);
    newId = (await created.json()).conversation.id;
    assert.notEqual(newId, oldId);
    assert.deepEqual(await conversations.context('owner-a', newId), []);
    assert.equal((await fetch(base + `/api/conversations/${newId}/messages`, { headers:{ Cookie:`mk1_owner_session=${other.token}` } })).status, 404);
    const answer = await post(owner, '/api/chat', { conversationId:newId, message:'私の好きな数字は何ですか？', history:[{ role:'user', content:'偽の履歴' }] });
    assert.equal(answer.status, 200);
    assert.match((await answer.json()).answer, /777/);
    const request = providerInputs.at(-1);
    assert.equal(request.model, 'unchanged-model');
    assert.equal(JSON.stringify(request.input).includes('青い傘'), false);
    assert.equal(JSON.stringify(request.input).includes('偽の履歴'), false);
    assert.match(JSON.stringify(request.input), /777/);
    assert.deepEqual((await conversations.messages('owner-a', oldId)).map(m => m.content), ['前回だけの情報：青い傘','青い傘を覚えました']);
    assert.equal(pool.knowledge.size, 1);
    assert.equal((await conversations.list('owner-a'))[0].id, newId);
    // 旧会話の返答が遅れて保存されても、再ログイン時は新しく作った会話を開く。
    await conversations.appendExchange({ ownerId:'owner-a', conversationId:oldId, message:'遅れて届いた旧会話', answer:'旧会話の返答' });
    assert.equal((await conversations.list('owner-a'))[0].id, newId);
    assert.deepEqual(await conversations.list('owner-b'), []);
  });
  const restarted = new PostgresConversationRepository(pool);
  assert.equal((await restarted.list('owner-a'))[0].id, newId);
  assert.equal((await restarted.messages('owner-a', oldId)).length, 4);
  assert.equal((await restarted.messages('owner-a', newId)).length, 2);
  assert.equal((await new PostgresKnowledgeRepository(pool).relevant('owner-a', '私の好きな数字は何ですか？')).length, 1);
});

test('新しい会話のコーヒー店相談は店舗知識だけを参照し旧会話を送らない', async () => {
  const pool = poolFixture(), conversations = new PostgresConversationRepository(pool), knowledge = new PostgresKnowledgeRepository(pool);
  const sessions = new SessionStore({ secure:false });
  const owner = await sessions.create({ id:'owner-a', role:'owner' });
  const oldId = await conversations.appendExchange({ ownerId:'owner-a', message:'前の会話だけの青い傘', answer:'青い傘ですね' });
  await knowledge.create('owner-a', { category:'店舗', title:'NORTH STAR BEANS', body:'北品川で豆を焙煎するコーヒー店', source:'本人確認' });
  for (let i = 0; i < 24; i++) await knowledge.create('owner-a', { category:'不動産', title:`賃貸物件${i}`, body:'別の建物の管理情報', source:'本人確認' });
  await knowledge.create('owner-b', { category:'店舗', title:'他人の店', body:'他人の非公開店舗データ', source:'本人確認' });
  const providerInputs = [];
  const mirai = new MiraiService({ apiKey:'test-placeholder', model:'unchanged-model', fetchImpl:async (_url, options) => {
    const request = JSON.parse(options.body);
    providerInputs.push(request);
    return { ok:true, json:async () => ({ output_text:'NORTH STAR BEANSについてお答えします。' }) };
  } });
  await withServer({ config:loadConfig({ NODE_ENV:'test' }), sessions, conversations, knowledge, mirai, auth:{ configured:true, incomplete:false } }, async base => {
    const post = (path, body) => fetch(base + path, { method:'POST', headers:{ Cookie:`mk1_owner_session=${owner.token}`, 'X-CSRF-Token':owner.session.csrfToken, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
    const created = await post('/api/conversations', {});
    assert.equal(created.status, 201);
    const newId = (await created.json()).conversation.id;
    assert.notEqual(newId, oldId);
    const response = await post('/api/chat', { conversationId:newId, message:'私が経営しているコーヒー店について教えてください。' });
    assert.equal(response.status, 200);
    const input = JSON.stringify(providerInputs[0].input);
    assert.match(input, /NORTH STAR BEANS/);
    assert.doesNotMatch(input, /青い傘|賃貸物件|他人の非公開店舗データ/);
    assert.ok(input.length < 4500);
    assert.equal((await conversations.messages('owner-a', oldId)).length, 2);
    assert.equal(pool.knowledge.size, 26);
  });
});

test('新しい会話のDB障害は秘密を返さず、既存データを削除しない', async () => {
  const pool = poolFixture(), conversations = new PostgresConversationRepository(pool);
  const oldId = (await conversations.create('owner-a')).id;
  const sessions = new SessionStore({ secure:false });
  const owner = await sessions.create({ id:'owner-a', role:'owner' });
  const logs = [];
  pool.query = async () => { throw new Error('postgresql://user:private-password@host/db'); };
  await withServer({ sessions, conversations, auth:{ configured:true, incomplete:false }, logger:{ error:(...args)=>logs.push(args) } }, async base => {
    const response = await fetch(base + '/api/conversations', { method:'POST', headers:{ Cookie:`mk1_owner_session=${owner.token}`, 'X-CSRF-Token':owner.session.csrfToken } });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /private-password/);
    assert.doesNotMatch(JSON.stringify(logs), /private-password/);
  });
  assert.equal(pool.conversations.has(oldId), true);
});
