const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectApprovalNeed } = require('../server/approval-policy');
const { MiraiService, extractOutputText } = require('../server/mirai-service');
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

test('ヘルスチェックは秘密情報を返さない', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['mode', 'ok', 'service']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
