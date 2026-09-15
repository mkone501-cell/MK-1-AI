const test = require('node:test');
const assert = require('node:assert/strict');

// app.js requires tiny DOM/localStorage shims before exporting its testable data.
global.localStorage = { getItem: () => null, setItem: () => {} };
global.location = { hash: '' };
const stub = () => ({ innerHTML: '', textContent: '', classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){}, scrollTop: 0, scrollHeight: 0 });
global.document = { querySelector: stub, createElement: stub, addEventListener(){} };
global.window = { addEventListener(){} };

const { initialState, clone, safe, APP_VERSION } = require('../app.js');

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
