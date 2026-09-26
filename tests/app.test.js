const test = require('node:test');
const assert = require('node:assert/strict');
const listeners = {};

// app.js requires tiny DOM/localStorage shims before exporting its testable data.
global.localStorage = { getItem: () => null, setItem: () => {} };
global.location = { hash: '' };
const stub = () => ({ innerHTML: '', textContent: '', classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, scrollTop: 0, scrollHeight: 0 });
global.document = { querySelector: stub, createElement: stub, addEventListener(name, handler){ listeners[name] = handler; } };
global.window = { addEventListener(){} };

const { initialState, clone, safe, demoChatResult, knowledgeView, knowledgeItemView, APP_VERSION } = require('../app.js');

test('Ver.0.1として起動する', () => assert.equal(APP_VERSION, '0.1.0'));

test('必要なデータをすべて保持できる', () => {
  for (const key of ['clients','projects','conversations','tasks','responses','adPlans','approvals','adMetrics','salesMetrics','auditLog']) {
    assert.ok(Array.isArray(initialState[key]), `${key} should be an array`);
  }
});

test('初期案件はクライアントIDで分離され、追加可能な構造になっている', () => {
  assert.equal(initialState.projects[0].clientId, initialState.clients[0].id);
  assert.equal(initialState.clients[0].name, 'NORTH STAR BEANS');
});

test('広告費と外部公開は承認待ちで始まる', () => {
  const protectedCategories = ['広告費', '外部公開'];
  for (const category of protectedCategories) {
    const item = initialState.approvals.find(a => a.category === category);
    assert.ok(item);
    assert.equal(item.status, '承認待ち');
  }
  assert.equal(initialState.settings.approvalRequired, true);
});

test('保存用コピーを変更しても初期データを壊さない', () => {
  const copied = clone(initialState);
  copied.clients[0].name = '変更';
  assert.equal(initialState.clients[0].name, 'NORTH STAR BEANS');
});

test('入力された文章を画面へ安全に表示する', () => {
  assert.equal(safe('<script>"危険"</script>'), '&lt;script&gt;&quot;危険&quot;&lt;/script&gt;');
});

test('バックエンドが使えない場合も従来のデモ応答を維持する', () => {
  assert.match(demoChatResult('今月の売上はどう？').answer, /EC売上/);
  assert.equal(demoChatResult('動画広告を作って').task.agent, '制作AI');
});

test('知識確認ボタンは登録フォームの必須チェックと送信から独立する', async () => {
  const html = knowledgeView(true);
  assert.match(html, /id="knowledge-form"[\s\S]*?required[\s\S]*?<\/form>[\s\S]*?id="knowledge-preview-question"/);
  assert.match(html, /type="button" id="knowledge-preview-button"/);
  assert.doesNotMatch(html, /id="knowledge-preview-form"|id="knowledge-preview-question"[^>]*required/);

  const originalQuery = document.querySelector, originalFetch = global.fetch, originalTimeout = global.setTimeout;
  const calls = [], result = { children:[], replaceChildren(){ this.children = []; }, append(node){ this.children.push(node); } };
  const toast = stub();
  document.querySelector = selector => selector === '#knowledge-preview-question' ? { value:'私の店について教えて' } :
    selector === '#knowledge-preview-result' ? result : selector === '#toast' ? toast : stub();
  global.fetch = async (path, options) => {
    calls.push({ path, options });
    return { ok:true, json:async () => ({ knowledge:[{ category:'店舗', title:'NORTH STAR BEANS' }] }) };
  };
  try {
    listeners.click({ target:{ closest:selector => selector === '#knowledge-preview-button' ? {} : null } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.map(call => call.path), ['api/knowledge/preview']);
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), { question:'私の店について教えて' });
    assert.equal(result.children[0].textContent, '店舗：NORTH STAR BEANS');
    global.setTimeout = () => 0;
    document.querySelector = selector => selector === '#knowledge-preview-question' ? { value:'  ' } :
      selector === '#toast' ? toast : stub();
    listeners.click({ target:{ closest:selector => selector === '#knowledge-preview-button' ? {} : null } });
    assert.equal(calls.length, 1);
    assert.equal(toast.textContent, '確認したい質問を入力してください。');
  } finally {
    document.querySelector = originalQuery;
    global.fetch = originalFetch;
    global.setTimeout = originalTimeout;
  }
});

test('設定で確認した候補は未承認のまま新規知識フォームへ引き継ぐ', () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const calls = [];
  const context = vm.createContext({
    module:{ exports:{} }, console, Date, JSON, structuredClone, setTimeout:() => 0,
    localStorage:{ getItem:()=>null, setItem(){} }, location:{ hash:'' },
    document:{ querySelector:stub, createElement:stub, addEventListener(){} }, window:{ addEventListener(){} },
    fetch:async (...args) => { calls.push(args); return { ok:true, json:async()=>({ knowledge:[] }) }; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(`serverConversation = true; memoryProposals = [{ id:'review-1', kind:'review', category:'商品', title:'新メニューの決定', body:'抹茶プリンを販売する', reason:'本人の今回の明確な決定' }]; reviewMemoryCandidateInSettings('review-1');`, context);
  const html = vm.runInContext('knowledgeView()', context);
  for (const value of ['value="商品"', 'value="新メニューの決定"', '抹茶プリンを販売する', 'value="本人の今回の明確な決定"']) assert.ok(html.includes(value));
  assert.match(html, /<input type="checkbox" name="confirmed" required>/);
  assert.doesNotMatch(html, /name="confirmed"[^>]*checked/);
  assert.match(html, /今回は登録しない/);
  assert.equal(calls.length, 0);
  assert.equal(vm.runInContext('memoryProposals.length', context), 1);
});

test('候補を設定で確認した後は、確認チェック付きの送信だけが一度だけ登録する', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const handlers = {}, calls = [];
  const node = () => ({ innerHTML:'', textContent:'', classList:{ add(){}, remove(){}, toggle(){} } });
  const context = vm.createContext({
    module:{ exports:{} }, console, Date, JSON, structuredClone, setTimeout:() => 0,
    localStorage:{ getItem:()=>null, setItem(){} }, location:{ hash:'#/settings' }, window:{ addEventListener(){} },
    FormData:class { constructor(form) { this.values = form.values; } get(key) { return this.values[key] ?? null; } },
    document:{ querySelector:()=>node(), querySelectorAll:()=>[], createElement:node, addEventListener:(name, handler)=>{ handlers[name] = handler; } },
    fetch:async (route, options={}) => { calls.push({ route, options }); return { ok:true, json:async()=> options.method === 'POST' ? { knowledge:{ id:'saved' } } : { knowledge:[] } }; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(`serverConversation = true; memoryProposals = [{ id:'review-1', kind:'review', category:'商品', title:'新メニューの決定', body:'新メニューとして抹茶プリンを販売することに決めました', reason:'本人の今回の明確な決定' }]; settingsMemoryReviewId = 'review-1';`, context);
  const form = confirmed => ({ id:'knowledge-form', dataset:{ knowledgeId:'' }, values:{ category:'商品', title:'新メニューの決定', body:'新メニューとして抹茶プリンを販売することに決めました', source:'本人の今回の明確な決定', ...(confirmed ? { confirmed:'on' } : {}) } });
  await handlers.submit({ preventDefault(){}, target:form(false) });
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
  await handlers.submit({ preventDefault(){}, target:form(true) });
  const writes = calls.filter(call => call.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].route, 'api/knowledge');
  assert.deepEqual(JSON.parse(writes[0].options.body).confirmed, true);
  assert.equal(vm.runInContext('memoryProposals.length', context), 0);
  assert.equal(vm.runInContext('settingsMemoryReviewId', context), null);
});

test('登録済み知識はアイコン用の固定幅列を使わず本文と操作を配置する', () => {
  const item = { id:'test-id', category:'店舗', title:'NORTH STAR BEANSの店舗情報',
    body:'日本語の長い説明文。'.repeat(30), source:'本人確認', active:true };
  const html = knowledgeItemView(item);
  assert.doesNotMatch(html, /approval-detail|row-main/);
  assert.match(html, /class="knowledge-content"/);
  assert.match(html, /class="knowledge-actions"/);
  for (const value of [item.category, item.title, item.body, item.source]) assert.ok(html.includes(value));
  assert.match(html, /type="button" data-knowledge-edit="test-id"/);
  assert.match(html, /type="button" data-knowledge-disable="test-id"/);
  assert.doesNotMatch(knowledgeItemView({ ...item, active:false }), /data-knowledge-(?:edit|disable)/);
  assert.ok(knowledgeItemView({ ...item, title:'<script>test</script>' }).includes('&lt;script&gt;'));

  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.knowledge-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/);
  assert.match(css, /\.knowledge-content\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)\s*\{\s*\.knowledge-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
});


test('候補UIは確認項目をエスケープし、承認操作だけが登録APIを呼ぶ', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const calls = [], stored = [];
  const context = vm.createContext({
    module:{ exports:{} }, console, Date, JSON, structuredClone, setTimeout:() => 0,
    localStorage:{ getItem:() => null, setItem:(_key, value) => stored.push(value) },
    location:{ hash:'' }, document:{ querySelector:stub, createElement:stub, addEventListener(){} },
    window:{ addEventListener(){} },
    fetch:async (path, options) => {
      calls.push({ path, options });
      return { ok:true, json:async () => path === 'api/conversations' ? { conversation:{ id:'new-id' } } : { knowledge:[] } };
    }
  });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(`memoryProposals = [{ id:'1', kind:'create', category:'店舗', title:'<script>test</script>', body:'木曜日を定休日にする', source:'本人の決定' }];`, context);
  assert.doesNotMatch(vm.runInContext('chatView()', context), /data-memory-accept/); // public demo
  vm.runInContext('serverConversation = true;', context);
  const html = vm.runInContext('chatView()', context);
  assert.match(html, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.match(html, /本人の決定/);
  assert.match(html, /type="button"[^>]*data-memory-accept="1"/);
  assert.match(html, /今回は登録しない/);
  assert.equal(calls.length, 0);
  await vm.runInContext(`decideMemoryCandidate('1', false)`, context);
  assert.equal(calls.length, 0);
  assert.equal(vm.runInContext('memoryProposals.length', context), 0);
  vm.runInContext(`memoryProposals = [{ id:'2', kind:'create', category:'店舗', title:'定休日', body:'木曜日を定休日にする', source:'本人の決定' }]; saveState();`, context);
  assert.ok(stored.every(value => !value.includes('木曜日')));
  const first = vm.runInContext(`decideMemoryCandidate('2', true)`, context);
  await vm.runInContext(`decideMemoryCandidate('2', true)`, context); // double click while pending
  await first;
  const writes = calls.filter(call => call.options?.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'api/knowledge');
  assert.equal(JSON.parse(writes[0].options.body).confirmed, true);
  assert.equal(vm.runInContext('memoryProposals.length', context), 0);
  vm.runInContext(`memoryProposals = [{ id:'u', kind:'update', knowledgeId:'knowledge-id', category:'店舗', title:'営業時間', previousBody:'旧', body:'新', message:'決定文', expectedRevision:'revision' }];`, context);
  await vm.runInContext(`decideMemoryCandidate('u', false)`, context);
  assert.equal(calls.filter(call => call.options?.method === 'POST').length, 1);
  vm.runInContext(`memoryProposals = [{ id:'u', kind:'update', knowledgeId:'knowledge-id', category:'店舗', title:'営業時間', previousBody:'旧', body:'新', message:'決定文', expectedRevision:'revision' }];`, context);
  await vm.runInContext(`decideMemoryCandidate('u', true)`, context);
  const update = calls.find(call => call.path.endsWith('/approve-update'));
  assert.equal(update.path, 'api/knowledge/knowledge-id/approve-update');
  assert.deepEqual(JSON.parse(update.options.body), { message:'決定文', proposedBody:'新', expectedRevision:'revision', confirmed:true });
  assert.equal(calls.filter(call => call.path === 'api/knowledge' && call.options?.method === 'POST').length, 1);
  vm.runInContext(`memoryProposals = [{ id:'3' }];`, context);
  await vm.runInContext('startNewConversation()', context);
  assert.equal(vm.runInContext('memoryProposals.length', context), 0);
  assert.equal(calls.filter(call => call.options?.method === 'POST').length, 3); // registration, update approval, new conversation creation
  const existing = [{ title:'営業時間の決定', category:'店舗', body:'平日9:00〜15:00、土日祝8:00〜17:00' },
    { title:'営業時間の決定', category:'店舗', body:'平日9:00〜16:00、土日祝8:00〜17:00' }];
  const review = { kind:'review', category:'店舗', title:'営業時間の決定', body:'変更文', reason:'複数の有効な既存知識が該当します。設定画面で整理してください。', existing, existingCount:2 };
  context.fetch = async () => ({ ok:false, status:409, json:async()=>({ code:'KNOWLEDGE_REVIEW_REQUIRED', memoryCandidates:[review], error:'表示してはいけない生の詳細' }) });
  vm.runInContext(`memoryProposals = [{ id:'stale', kind:'create', category:'店舗', title:'営業時間の決定', body:'変更文', source:'本人確認' }];`,context);
  await vm.runInContext(`decideMemoryCandidate('stale',true)`,context);
  const blocked = vm.runInContext('chatView()',context);
  assert.match(blocked,/確認が必要/);
  assert.match(blocked,/設定画面で整理してください/);
  for (const item of existing) assert.ok(blocked.includes(item.body));
  assert.doesNotMatch(blocked,/data-memory-accept|表示してはいけない生の詳細/);
  context.fetch = async () => { throw new Error('review must not submit'); };
  await vm.runInContext(`decideMemoryCandidate('stale',true)`,context);
  // Old/malformed responses lacking a decision must also fail closed.
  vm.runInContext(`memoryProposals = [{ id:'unknown', body:'変更文' }];`,context);
  assert.doesNotMatch(vm.runInContext('chatView()',context),/data-memory-accept/);
  await vm.runInContext(`decideMemoryCandidate('unknown',true)`,context);

});


test('更新候補は新旧を比較表示し、不確かな候補には登録・更新ボタンを出さない', () => {
  const { memoryCandidateView } = require('../app.js');
  const item = { id:'candidate', kind:'update', title:'店舗営業時間', category:'店舗',
    previousBody:'平日9:00〜16:00', body:'平日10:00〜17:00', reason:'本人の決定' };
  const html = memoryCandidateView(item);
  for (const text of ['長期記憶の更新候補', '現在登録されている内容', '新しい内容', item.previousBody, item.body, '更新理由', '更新する', '今回は更新しない']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, />登録する</);
  assert.match(memoryCandidateView({ ...item, previousBody:'<script>旧</script>' }), /&lt;script&gt;/);
  for (const kind of ['review','duplicate']) assert.doesNotMatch(memoryCandidateView({ ...item, kind }), /data-memory-accept/);
});


test('サーバーの複数候補判定をUIへそのまま渡すと比較表示だけになり保存ボタンはない', async () => {
  const { proposeMemory } = require('../server/knowledge/update-candidates');
  const { loadConfig } = require('../server/config');
  const { memoryCandidateView } = require('../app.js');
  const rows = [15,16].map(hour => ({ id:String(hour), category:'店舗', title:'営業時間の決定',
    body:`NORTH STAR BEANSの営業時間を平日9:00〜${hour}:00、土日祝8:00〜17:00に変更する`, source:'本人確認', active:true }));
  const [candidate] = await proposeMemory('NORTH STAR BEANSの平日の営業時間を9:00〜14:00に変更します。', { candidateRecords:async()=>rows }, 'a', loadConfig({NODE_ENV:'test'}));
  const html = memoryCandidateView(candidate);
  assert.match(html,/確認が必要/);
  for (const row of rows) assert.ok(html.includes(row.body));
  assert.doesNotMatch(html,/data-memory-accept|>登録する<|>更新する</);
  const [update] = await proposeMemory('NORTH STAR BEANSの平日の営業時間を9:00〜14:00に変更します。', { candidateRecords:async()=>[rows[0]] }, 'a', loadConfig({NODE_ENV:'test'}));
  const updateHtml = memoryCandidateView(update);
  for (const label of ['現在登録されている内容','新しい内容','更新理由','更新する','今回は更新しない']) assert.ok(updateHtml.includes(label));
  const escaped = memoryCandidateView({ ...candidate, existing:[{ title:'<script>x</script>', body:'<img src=x>', category:'店舗' }] });
  assert.doesNotMatch(escaped,/<script>|<img/);
});


test('Phase 6.38 fix prevents overlapping chat requests from replacing a pending management-data candidate', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(source, /let chatRequestPending = false/);
  assert.match(source, /conversationLoading \|\| newConversationPending \|\| chatRequestPending/);
  assert.match(source, /chatRequestPending = true/);
  assert.match(source, /finally \{\s*chatRequestPending = false;\s*render\(\);\s*\}/);
  assert.match(source, /if \(!message\.trim\(\) \|\| chatRequestPending\) return/);
  assert.match(source, /input\.value = ''/);
});

test('Phase 6.38 fix hydrates returned candidate lists even when conversationId is not used for the assignment guard', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(source, /if \(serverConversation\) \{/);
  assert.match(source, /if \(result\.conversationId\) activeConversationId = result\.conversationId/);
  assert.match(source, /managementDataProposals = \(result\.managementDataCandidates \|\| \[\]\)/);
  assert.doesNotMatch(source, /if \(serverConversation && result\.conversationId\) \{/);
});


test('Phase 6.42 UI shows restore as a separate owner-confirmed action and sends the audited history id', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(source, /経営数値の復元候補があります/);
  assert.match(source, /変更履歴上の最初の値/);
  assert.match(source, /確認して復元/);
  assert.match(source, /今回は復元しない/);
  assert.match(source, /restoreHistoryEntryId:item\.restoreHistoryEntryId \|\| null/);
  assert.match(source, /result\.restored \? '確認した経営数値を最初の値へ復元しました。'/);
});


test('Phase 6.46 duplicate cleanup UI shows every row and only writes after an explicit keep-row click', async () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const calls = [];
  const context = vm.createContext({
    module:{ exports:{} }, console, Date, JSON, structuredClone, setTimeout:() => 0,
    localStorage:{ getItem:()=>null, setItem(){} }, location:{ hash:'#/chat' }, window:{ addEventListener(){} },
    document:{ querySelector:stub, querySelectorAll:()=>[], createElement:stub, addEventListener(){} },
    fetch:async (route, options={}) => {
      calls.push({ route, options });
      return { ok:true, json:async()=>({ resolved:true, keepEntryId:'7', supersededCount:1 }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(`serverConversation = true;
    managementDataCleanupProposals = [{
      id:'cleanup-1', operation:'deduplicate', businessKey:'north-star-beans',
      dataDate:'2026-09-22', metricType:'revenue', recommendedKeepId:'7',
      recommendationReason:'最終判断は本人が行います。',
      originalText:'NORTH STAR BEANSの重複データを整理する候補を出して',
      rows:[
        { id:'4', amount:160000, currency:'JPY', createdAt:'2026-09-22T10:00:00.000Z', updatedAt:'2026-09-22T10:00:00.000Z', historyCount:0 },
        { id:'7', amount:161000, currency:'JPY', createdAt:'2026-09-22T11:00:00.000Z', updatedAt:'2026-09-22T11:00:00.000Z', historyCount:1 }
      ]
    }];`, context);
  const html = vm.runInContext('chatView()', context);
  assert.match(html, /管理ID 4/);
  assert.match(html, /管理ID 7（残す候補）/);
  assert.match(html, /ID 4を残して整理/);
  assert.match(html, /ID 7を残して整理/);
  assert.match(html, /今回は整理しない/);
  assert.match(html, /削除せず/);
  assert.equal(calls.length, 0);

  await vm.runInContext(`decideManagementDataCleanupCandidate('cleanup-1', null)`, context);
  assert.equal(calls.length, 0);

  vm.runInContext(`managementDataCleanupProposals = [{
    id:'cleanup-2', operation:'deduplicate', businessKey:'north-star-beans',
    dataDate:'2026-09-22', metricType:'revenue', recommendedKeepId:'7',
    originalText:'NORTH STAR BEANSの重複データを整理する候補を出して',
    rows:[
      { id:'4', amount:160000, currency:'JPY', updatedAt:'2026-09-22T10:00:00.000Z' },
      { id:'7', amount:161000, currency:'JPY', updatedAt:'2026-09-22T11:00:00.000Z' }
    ]
  }];`, context);
  await vm.runInContext(`decideManagementDataCleanupCandidate('cleanup-2', '7')`, context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, 'api/management-data/resolve-duplicates');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.confirmed, true);
  assert.equal(body.operation, 'deduplicate');
  assert.equal(body.keepEntryId, '7');
  assert.equal(body.expectedRows.length, 2);
});

test('Phase 6.46 new conversations clear unapproved duplicate cleanup candidates', () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(source, /let managementDataCleanupProposals = \[\]/);
  assert.match(source, /managementDataCleanupProposals = \(result\.managementDataCleanupCandidates \|\| \[\]\)/);
  assert.match(source, /managementDataCleanupProposals = \[\];[\s\S]*saveState\(\)/);
});
