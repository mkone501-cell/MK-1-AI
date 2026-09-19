const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { proposeMemory, revision } = require('../server/knowledge/update-candidates');
const { PostgresKnowledgeRepository } = require('../server/knowledge/postgres-knowledge-repository');
const { migrateKnowledge } = require('../server/knowledge/migrate-knowledge');
const { loadConfig } = require('../server/config');
const { SessionStore } = require('../server/session-store');
const { createServer } = require('../server/server');
const config = loadConfig({ NODE_ENV:'test' });
const original = 'NORTH STAR BEANSの営業時間は平日9:00〜16:00、土日祝8:00〜17:00';
const message = '平日の営業時間を10:00〜17:00に変更する';
function entry(body = original, extra = {}) {
  return { id:randomUUID(), category:'店舗', title:'NORTH STAR BEANS', body, source:'本人確認', active:true, updatedAt:'2026-01-01T00:00:00.000Z', ...extra };
}
function repoOf(rows) { return { candidateRecords:async () => rows }; }

test('営業時間の平日だけ更新し、休日・タイトル・情報源を保持する', async () => {
  const old = entry();
  const [candidate] = await proposeMemory(message, repoOf([old]), 'a', config);
  assert.equal(candidate.kind, 'update');
  assert.equal(candidate.previousBody, original);
  assert.equal(candidate.body, 'NORTH STAR BEANSの営業時間は平日10:00〜17:00、土日祝8:00〜17:00');
  assert.equal(candidate.title, old.title);
  assert.equal(candidate.source, old.source);
  assert.equal(candidate.expectedRevision, revision(old));
  assert.equal(old.body, original);
});

test('目標・価格・スタッフ体制・定休日・物件の項目を対象ごとに照合する', async () => {
  for (const [body, change, expected] of [
    ['ECの月商目標は200万円', 'ECの月商300万円を目標にする', 'ECの月商目標は300万円'],
    ['ECの月商は200万円を目標にする', 'ECの月商300万円を目標にする', 'ECの月商は300万円を目標にする'],
    ['ラテの価格は600円', 'ラテの価格を700円に変更する', 'ラテの価格は700円'],
    ['本店のスタッフ体制は2人体制', '本店のスタッフ体制を3人体制に変更する', '本店のスタッフ体制は3人体制'],
    ['本店の定休日は水曜日', '本店の定休日を木曜日に変更する', '本店の定休日は木曜日'],
    ['北品川ビルの家賃は月200万円', '北品川ビルの家賃を220万円に変更する', '北品川ビルの家賃は月220万円'],
    ['北品川ビルの面積は100㎡', '北品川ビルの面積を110㎡に変更する', '北品川ビルの面積は110㎡']
  ]) {
    const [candidate] = await proposeMemory(change, repoOf([entry(body, { category:require('../server/knowledge/candidates').memoryCandidates(change, config)[0].category })]), 'a', config);
    assert.equal(candidate.kind, expected ? 'update' : 'review', change);
    if (expected) assert.equal(candidate.body, expected);
  }
});

test('同じ対象の別項目・実績と目標・他対象・曖昧な複数候補を上書きしない', async () => {
  for (const [rows, text] of [
    [[entry('本店の価格は600円')], '本店の家賃を20万円に変更する'],
    [[entry('ECの月商は200万円', { title:'売上実績' })], 'ECの月商300万円を目標にする'],
    [[entry(), entry(original.replace('NORTH STAR BEANS','別店舗'), { title:'別店舗' })], message],
    [[entry()], '別店舗の平日の営業時間を10:00〜17:00に変更する'],
    [[entry('本店の営業時間は9:00〜16:00')], message],
    [Array.from({ length:201 }, () => entry()), message]
  ]) {
    const candidates = await proposeMemory(text, repoOf(rows), 'a', config);
    assert.notEqual(candidates[0]?.kind, 'update', text);
  }
  const same = await proposeMemory('平日の営業時間を9:00〜16:00に変更する', repoOf([entry()]), 'a', config);
  assert.equal(same[0].kind, 'duplicate');
  const explicit = await proposeMemory('NORTH STAR BEANSの平日の営業時間を10:00〜17:00に変更する',
    repoOf([entry(), entry(original.replace('NORTH STAR BEANS','別店舗'), { title:'別店舗' })]), 'a', config);
  assert.equal(explicit[0].kind, 'update');
});

test('秘密情報を含む旧知識や入力を候補・監査へコピーしない', async () => {
  const rows = [entry(original + '、パスワード=example-only')];
  const candidates = await proposeMemory(message, repoOf(rows), 'a', config);
  assert.equal(candidates[0].kind, 'review');
  assert.doesNotMatch(JSON.stringify(candidates), /example-only/);
  assert.deepEqual(await proposeMemory('パスワード=example-only、' + message, repoOf([]), 'a', config), []);
});

// Parameterized repository execution with transaction rollback; no production DB/credentials.
function fixture() {
  let rows = new Map(), audit = [], backup;
  const calls = [];
  let failAudit = false;
  const query = async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql === 'BEGIN') backup = structuredClone({ rows, audit });
    else if (sql === 'ROLLBACK') { rows = backup.rows; audit = backup.audit; }
    else if (sql.startsWith('SELECT ')) {
      let found = [...rows.values()].filter(r => r.owner_id === args[0] && r.active);
      if (sql.includes('id = $2')) found = found.filter(r => r.id === args[1]);
      return { rows:structuredClone(found.slice(0, 201)) };
    } else if (sql.startsWith('INSERT INTO management_knowledge_revisions')) {
      if (failAudit) throw new Error('postgresql://example:dummy-secret@localhost/test');
      audit.push(args);
    } else if (sql.startsWith('UPDATE management_knowledge')) {
      const row = rows.get(args[1]);
      assert.equal(row.owner_id, args[0]);
      Object.assign(row, { category:args[2], title:args[3], body:args[4], source:args[5], updated_at:new Date() });
      return { rows:[structuredClone(row)] };
    }
    return { rows:[] };
  };
  const pool = { query, connect:async () => ({ query, release(){} }) };
  const add = (owner, value) => rows.set(value.id, { ...value, owner_id:owner, updated_at:value.updatedAt });
  return { pool, calls, add, get rows(){return rows;}, get audit(){return audit;}, set failAudit(v){failAudit=v;} };
}

test('承認更新と監査は原子的・所有者限定・旧版照合付き、DB失敗時はロールバック', async () => {
  const f = fixture(), repo = new PostgresKnowledgeRepository(f.pool), old = entry();
  f.add('a', old);
  const [candidate] = await proposeMemory(message, repo, 'a', config);
  assert.equal(await repo.approveUpdate('b', old.id, candidate, candidate.expectedRevision), null);
  assert.equal(await repo.approveUpdate('a', old.id, candidate, 'stale'), null);
  f.failAudit = true;
  await assert.rejects(repo.approveUpdate('a', old.id, candidate, candidate.expectedRevision));
  assert.equal(f.rows.get(old.id).body, original);
  assert.equal(f.audit.length, 0);
  f.failAudit = false;
  assert.ok(await repo.approveUpdate('a', old.id, candidate, candidate.expectedRevision));
  assert.equal(f.rows.size, 1);
  assert.equal(f.audit.length, 1);
  assert.equal(JSON.parse(f.audit[0][3]).body, original);
  assert.equal(await repo.approveUpdate('a', old.id, candidate, candidate.expectedRevision), null);
  assert.equal(f.audit.length, 1);
  assert.ok(f.calls.some(c => c.sql.includes('FOR UPDATE')));
  for (const c of f.calls) assert.equal(c.sql.includes('NORTH STAR BEANS'), false);
  assert.equal((await new PostgresKnowledgeRepository(f.pool).candidateRecords('a'))[0].body, candidate.body);
  await migrateKnowledge(repo);
  assert.ok(f.calls.some(c => /CREATE TABLE IF NOT EXISTS management_knowledge_revisions/.test(c.sql)));
  assert.ok(f.calls.every(c => !/DROP TABLE|DELETE FROM/i.test(c.sql)));
});

test('更新承認APIは明示承認・CSRF・所有者・改変・期限中の編集を検査する', async () => {
  const f = fixture(), knowledge = new PostgresKnowledgeRepository(f.pool), old = entry();
  f.add('a', old);
  const sessions = new SessionStore({ secure:false });
  const owner = await sessions.create({ id:'a', role:'owner' });
  const other = await sessions.create({ id:'b', role:'owner' });
  const logs = [];
  const histories = [];
  const server = createServer({ config, sessions, knowledge,
    conversations:{ context:async () => [], appendExchange:async () => '11111111-1111-4111-8111-111111111111' },
    mirai:{ reply:async input => { histories.push(input.history); return { answer:'変更内容を確認してください。' }; } },
    auth:{ configured:true }, logger:{ error:(...args)=>logs.push(args) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/knowledge/${old.id}/approve-update`;
  try {
    const response = await fetch(url.replace(`/api/knowledge/${old.id}/approve-update`, '/api/chat'), { method:'POST', headers:{ 'Content-Type':'application/json', Cookie:`mk1_owner_session=${owner.token}`, 'X-CSRF-Token':owner.session.csrfToken }, body:JSON.stringify({ message, history:[{ role:'user', content:'前の会話' }] }) });
    assert.equal(response.status, 200);
    const [candidate] = (await response.json()).memoryCandidates;
    assert.equal(candidate.kind, 'update');
    assert.deepEqual(histories, [[]]);
    assert.equal(f.rows.get(old.id).body, original);
    assert.equal(f.audit.length, 0);
    const payload = { message, confirmed:true, proposedBody:candidate.body, expectedRevision:candidate.expectedRevision };
    const post = (user, body=payload, csrf=user?.session.csrfToken, origin) => fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', ...(origin ? {Origin:origin} : {}), ...(user ? { Cookie:`mk1_owner_session=${user.token}`, 'X-CSRF-Token':csrf } : {}) }, body:JSON.stringify(body) });
    assert.equal((await post(null)).status, 401);
    assert.equal((await post(owner, payload, 'invalid')).status, 403);
    assert.equal((await post(owner, payload, owner.session.csrfToken, 'https://evil.example')).status, 403);
    assert.equal((await post(owner, { ...payload, confirmed:false })).status, 400);
    assert.equal((await post(other)).status, 409);
    assert.equal((await post(owner, { ...payload, proposedBody:'偽造内容' })).status, 409);
    assert.equal((await post(owner, { ...payload, message:'パスワード=example-only、' + message })).status, 409);
    assert.equal(f.audit.length, 0);
    f.failAudit = true;
    const failure = await post(owner);
    assert.equal(failure.status, 503);
    assert.doesNotMatch(await failure.text() + JSON.stringify(logs), /dummy-secret|example-only/);
    f.failAudit = false;
    const updated = await post(owner);
    assert.equal(updated.status, 200);
    assert.equal(f.rows.size, 1);
    assert.equal(f.audit.length, 1);
    assert.equal((await post(owner)).status, 409); // repeated or stale approval
    assert.equal(f.rows.get(old.id).body, candidate.body);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('本番の決定文・汎用タイトルでも店舗と営業時間を照合し土日祝日を保持する', async () => {
  const old = entry('NORTH STAR BEANSの営業時間を平日9:00〜16:00、土日祝日8:00〜17:00に変更する', { title:'営業時間の決定' });
  const text = 'NORTH STAR BEANSの平日の営業時間を9:00〜15:00に変更します';
  const [candidate] = await proposeMemory(text, repoOf([old]), 'a', config);
  assert.equal(candidate.kind, 'update');
  assert.equal(candidate.knowledgeId, old.id);
  assert.equal(candidate.body, 'NORTH STAR BEANSの営業時間を平日9:00〜15:00、土日祝日8:00〜17:00に変更する');
  assert.equal(candidate.previousBody, old.body);
  const { facts } = require('../server/knowledge/update-candidates');
  assert.deepEqual(facts(old.body).map(f => [f.scope, f.target]), [['平日','NORTH STAR BEANS'],['土日祝','NORTH STAR BEANS']]);
  const [weekend] = await proposeMemory('NORTH STAR BEANSの土日祝の営業時間を8:00〜18:00に変更します', repoOf([old]), 'a', config);
  assert.equal(weekend.kind, 'update');
  assert.match(weekend.body, /平日9:00〜16:00、土日祝日8:00〜18:00/);
  const conflict = entry(old.body.replace('16:00','15:00'), { title:old.title });
  assert.equal((await proposeMemory(text, repoOf([old, conflict]), 'a', config))[0].kind, 'review');
  assert.equal(old.active, true);
  assert.equal(conflict.active, true);
});

test('同じタイトルでも店舗・カテゴリ・項目が違う知識を更新しない', async () => {
  const text = 'NORTH STAR BEANSの平日の営業時間を9:00〜15:00に変更します';
  for (const old of [
    entry('別店舗の営業時間は平日9:00〜16:00', { title:'営業時間の決定' }),
    entry(original, { category:'不動産', title:'営業時間の決定' }),
    entry('別店舗の営業時間は平日9:00〜16:00', { title:'NORTH STAR BEANS' }),
    entry('NORTH STAR BEANSの定休日は木曜日', { title:'営業時間の決定' })
  ]) assert.notEqual((await proposeMemory(text, repoOf([old]), 'a', config))[0].kind, 'update');
});

test('本番文の承認は同じIDと監査へ保存し、古い新規登録API経由では重複を拒否する', async () => {
  const f = fixture(), knowledge = new PostgresKnowledgeRepository(f.pool);
  const old = entry('NORTH STAR BEANSの営業時間を平日9:00〜16:00、土日祝日8:00〜17:00に変更する', { title:'営業時間の決定' });
  f.add('a', old);
  const sessions = new SessionStore({ secure:false });
  const owner = await sessions.create({ id:'a', role:'owner' });
  const server = createServer({ config, sessions, knowledge, auth:{ configured:true },
    conversations:{ appendExchange:async()=>randomUUID() }, mirai:{ reply:async()=>({ answer:'確認してください。' }) } });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method:'POST', headers:{ 'Content-Type':'application/json', Cookie:`mk1_owner_session=${owner.token}`, 'X-CSRF-Token':owner.session.csrfToken }, body:JSON.stringify(body) });
  try {
    const message = 'NORTH STAR BEANSの平日の営業時間を9:00〜15:00に変更します';
    const response = await post('/api/chat', { message });
    assert.equal(response.status, 200);
    const [candidate] = (await response.json()).memoryCandidates;
    assert.equal(candidate.kind,'update');
    assert.equal(f.rows.get(old.id).body, old.body);
    assert.equal(f.audit.length, 0);
    const stale = await post('/api/knowledge', { category:'店舗', title:'営業時間の決定', body:message, source:'本人確認', confirmed:true });
    assert.equal(stale.status,409);
    const approved = await post(`/api/knowledge/${old.id}/approve-update`, { message, proposedBody:candidate.body, expectedRevision:candidate.expectedRevision, confirmed:true });
    assert.equal(approved.status,200);
    assert.equal((await approved.json()).knowledge.id,old.id);
    assert.equal(f.rows.size,1);
    assert.equal(f.audit.length,1);
    assert.equal(JSON.parse(f.audit[0][3]).body,old.body);
    assert.equal(f.rows.get(old.id).body,candidate.body);
    assert.equal(f.calls.some(c => /^INSERT INTO management_knowledge\s/.test(c.sql)),false);
    const duplicate = entry(old.body, { title:old.title });
    f.add('a', duplicate);
    const before = JSON.stringify([...f.rows]);
    assert.equal((await post('/api/knowledge', { category:'店舗', title:'営業時間の決定', body:message, source:'本人確認', confirmed:true })).status,409);
    assert.equal(JSON.stringify([...f.rows]),before);
    assert.equal(f.audit.length,1);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('本番再現：句点付き変更文は2件なら比較付きreview、1件なら同一ID更新になる', async () => {
  const f = fixture(), knowledge = new PostgresKnowledgeRepository(f.pool);
  const a = entry('NORTH STAR BEANSの営業時間を平日9:00〜15:00、土日祝8:00〜17:00に変更する', { title:'営業時間の決定' });
  const b = entry(a.body.replace('15:00','16:00'), { title:a.title });
  f.add('a',a); f.add('a',b);
  const foreign = entry(a.body, { title:'他人の非公開知識' }); f.add('b',foreign);
  const sessions = new SessionStore({ secure:false });
  const owner = await sessions.create({ id:'a', role:'owner' });
  const server = createServer({ config, sessions, knowledge, auth:{ configured:true },
    conversations:{ appendExchange:async()=>randomUUID() }, mirai:{ reply:async()=>({ answer:'確認してください。' }) } });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method:'POST', headers:{ 'Content-Type':'application/json', Cookie:`mk1_owner_session=${owner.token}`, 'X-CSRF-Token':owner.session.csrfToken }, body:JSON.stringify(body) });
  try {
    const message = 'NORTH STAR BEANSの平日の営業時間を9:00〜14:00に変更します。';
    const before = JSON.stringify([...f.rows]);
    const chat = await post('/api/chat', { message });
    assert.equal(chat.status,200);
    const candidates = (await chat.json()).memoryCandidates;
    assert.equal(candidates[0].kind,'review');
    assert.deepEqual(candidates[0].existing.map(i=>[i.id,i.title,i.body]), [a,b].map(i=>[i.id,i.title,i.body]));
    const rejected = await post('/api/knowledge', { category:'店舗', title:a.title, body:message, source:'本人確認', confirmed:true });
    assert.equal(rejected.status,409);
    const denial = await rejected.json();
    assert.equal(denial.code,'KNOWLEDGE_REVIEW_REQUIRED');
    assert.deepEqual(denial.memoryCandidates,candidates);
    assert.equal(JSON.stringify([...f.rows]),before);
    assert.equal(f.audit.length,0);
    // Simulate the owner's manual cleanup only in this fixture, never production.
    f.rows.get(b.id).active = false;
    const next = await post('/api/chat', { message });
    const [update] = (await next.json()).memoryCandidates;
    assert.equal(update.kind,'update');
    assert.equal(update.knowledgeId,a.id);
    assert.equal(update.previousBody,a.body);
    assert.match(update.body,/平日9:00〜14:00、土日祝8:00〜17:00/);
    const approved = await post(`/api/knowledge/${a.id}/approve-update`, { message, expectedRevision:update.expectedRevision, proposedBody:update.body, confirmed:true });
    assert.equal(approved.status,200);
    assert.equal((await approved.json()).knowledge.id,a.id);
    assert.equal(f.rows.size,3);
    assert.equal(f.audit.length,1);
    assert.equal(JSON.parse(f.audit[0][3]).body,a.body);
    assert.equal(f.rows.get(b.id).body,b.body);
    const html = await fetch(base + '/');
    assert.equal(html.headers.get('cache-control'),'no-cache');
    assert.match(await html.text(),/app\.js\?v=phase54-edit-1/);
    const js = await fetch(base + '/app.js?v=phase54-edit-1');
    assert.equal(js.status,200);
    assert.equal(js.headers.get('cache-control'),'no-cache');
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
