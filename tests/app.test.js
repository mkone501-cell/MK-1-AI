const test = require('node:test');
const assert = require('node:assert/strict');
const listeners = {};

// app.js requires tiny DOM/localStorage shims before exporting its testable data.
global.localStorage = { getItem: () => null, setItem: () => {} };
global.location = { hash: '' };
const stub = () => ({ innerHTML: '', textContent: '', classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, scrollTop: 0, scrollHeight: 0 });
global.document = { querySelector: stub, createElement: stub, addEventListener(name, handler){ listeners[name] = handler; } };
global.window = { addEventListener(){} };

const { initialState, clone, safe, demoChatResult, knowledgeView, APP_VERSION } = require('../app.js');

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
