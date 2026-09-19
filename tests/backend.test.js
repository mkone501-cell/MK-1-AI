const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectApprovalNeed } = require('../server/approval-policy');
const { canExecuteProtectedAction } = require('../server/approval-guard');
const { AuthService } = require('../server/auth-service');
const { SessionStore } = require('../server/session-store');
const { hashPassword, verifyPassword } = require('../server/password');
const { MiraiService, extractOutputText, classifyOpenAIError } = require('../server/mirai-service');
const { createServer } = require('../server/server');

test('重要操作は承認が必要になる', () => {
  const result = inspectApprovalNeed('Instagramへ広告を公開して、3万円支払って');
  assert.equal(result.required, true);
  assert.deepEqual(result.categories, ['外部公開', '支払い']);
});

test('通常の分析相談は承認不要', () => {
  assert.equal(inspectApprovalNeed('先月の売上を分析して').required, false);
});

test('APIキーなしでは外部通信せずデモ応答を返す', async () => {
  let called = false;
  const service = new MiraiService({ apiKey: '', model: 'test', fetchImpl: async () => { called = true; } });
  const result = await service.reply({ message: 'こんにちは' });
  assert.equal(result.mode, 'demo');
  assert.equal(called, false);
});

test('OpenAI応答から文章を安全に取り出す', () => {
  assert.equal(extractOutputText({ output: [{ content: [{ text: '回答です' }] }] }), '回答です');
});

test('APIキーはサーバーからOpenAIへの認証だけに使用する', async () => {
  let request;
  const service = new MiraiService({
    apiKey: 'test-secret-key',
    model: 'test-model',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ output_text: '本物のAI応答' }) };
    }
  });
  const result = await service.reply({ message: '経営状況を教えて' });
  assert.equal(result.answer, '本物のAI応答');
  assert.equal(result.mode, 'openai');
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-secret-key');
  assert.doesNotMatch(JSON.stringify(result), /test-secret-key/);
});

test('単純な知識確認には短い直接回答を促し、定型フォーマットを強制しない', async () => {
  let payload;
  const service = new MiraiService({
    apiKey: 'test-secret-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: '登録されている好きな数字は777です。' }) };
    }
  });
  const result = await service.reply({
    message: '私の好きな数字は何番ですか？',
    knowledge: [{ category:'会社基本情報', title:'代表の好きな数字', body:'代表の好きな数字は777です。', source:'本人確認' }]
  });
  assert.equal(result.answer, '登録されている好きな数字は777です。');
  assert.match(payload.instructions, /通常は1〜2文/);
  assert.match(payload.instructions, /定型フォーマットを毎回使わない/);
  assert.match(payload.instructions, /頼まれていない補足、確認質問、次の作業の提案も付けない/);
  assert.match(payload.instructions, /説明を求められた質問には必要な範囲で詳しく答えてください/);
  assert.match(JSON.stringify(payload.input), /777/);
  assert.equal(result.approval.required, false);
});

test('OpenAIエラーは秘密を含めず安全な分類だけを保持する', async () => {
  const service = new MiraiService({
    apiKey: 'never-log-this-secret',
    model: 'test-model',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'secret upstream detail', code: 'invalid_api_key' } })
    })
  });
  await assert.rejects(
    service.reply({ message: '接続テスト' }),
    error => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.providerStatus, 401);
      assert.equal(error.providerCategory, 'authentication');
      assert.doesNotMatch(JSON.stringify(error), /never-log-this-secret|secret upstream detail/);
      return true;
    }
  );
  assert.equal(classifyOpenAIError(429, 'insufficient_quota'), 'quota');
  assert.equal(classifyOpenAIError(404, 'model_not_found'), 'model');
});

test('パスワードはハッシュ化し、元の文字列を保存しない', async () => {
  const password = 'very-long-test-password';
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt\$/);
  assert.doesNotMatch(hash, new RegExp(password));
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('保護操作は本人セッションからの明示承認だけを許可する', () => {
  const session = { user:{ id:'owner-inoue', role:'owner' } };
  const approval = { status:'承認済み', approvedBy:'owner-inoue', decisionSource:'owner-session' };
  assert.equal(canExecuteProtectedAction({ session, approval }), true);
  assert.equal(canExecuteProtectedAction({ session:null, approval }), false);
  assert.equal(canExecuteProtectedAction({ session, approval:{ ...approval, decisionSource:'ai-message' } }), false);
});

test('ヘルスチェックは秘密情報を返さない', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['authentication', 'database', 'environment', 'mode', 'ok', 'service', 'sessionStore']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('認証設定時は未ログイン利用者のチャットを拒否する', async () => {
  const password = 'owner-test-password-123';
  const auth = new AuthService({ ownerEmail:'owner@example.com', passwordHash:await hashPassword(password) });
  const sessions = new SessionStore({ secure:false });
  const mirai = { mode:'demo', reply:async () => ({ answer:'認証後の回答', mode:'demo' }) };
  const server = createServer({ auth, sessions, mirai });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const denied = await fetch(`${base}/api/chat`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ message:'売上は？' }) });
    assert.equal(denied.status, 401);

    const login = await fetch(`${base}/api/auth/login`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email:'owner@example.com', password }) });
    const loginBody = await login.json();
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal(login.status, 200);
    assert.ok(loginBody.csrfToken);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);

    const noCsrf = await fetch(`${base}/api/chat`, { method:'POST', headers:{ 'Content-Type':'application/json', Cookie:cookie }, body:JSON.stringify({ message:'売上は？' }) });
    assert.equal(noCsrf.status, 403);

    const allowed = await fetch(`${base}/api/chat`, { method:'POST', headers:{ 'Content-Type':'application/json', Cookie:cookie, 'X-CSRF-Token':loginBody.csrfToken }, body:JSON.stringify({ message:'売上は？' }) });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).answer, '認証後の回答');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
