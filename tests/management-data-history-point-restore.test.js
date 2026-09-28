'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectHistoryPointRestoreRequest,
  historyPointRestoreTargetSide,
  recentSingleDisplayedHistoryReference,
  resolveHistoryPoint,
  orderedHistory,
  historyMinute
} = require('../server/management-data/history-point-restore');

const rows = [
  { id:11, previous_amount:'125000', new_amount:'126000', previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T13:00:00.000Z' },
  { id:12, previous_amount:'126000', new_amount:'125000', previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T13:05:00.000Z' },
  { id:13, previous_amount:'125000', new_amount:'126000', previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T13:08:00.000Z' },
  { id:14, previous_amount:'126000', new_amount:'125000', previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T13:10:00.000Z' }
];

test('Phase 6.54 resolves the second displayed history row in changed_at/id ascending order', () => {
  const request = detectHistoryPointRestoreRequest('管理ID8の2番目の変更後の値に戻して');
  assert.deepEqual(request, { managementDataId:8, selector:{ type:'index', index:2 }, targetSide:'new', error:null });
  const resolved = resolveHistoryPoint(rows, request.selector, request.targetSide);
  assert.equal(resolved.historyEntry.id, 12);
  assert.equal(resolved.historyIndex, 2);
  assert.equal(resolved.amount, 125000);
  assert.equal(resolved.currency, 'JPY');
});

test('Phase 6.54 carries one immediately preceding management ID only for a numbered restore', () => {
  const request = detectHistoryPointRestoreRequest('3番目に戻して', [
    { role:'assistant', content:'管理ID 8 の変更履歴です。' }
  ]);
  assert.equal(request.managementDataId, 8);
  assert.deepEqual(request.selector, { type:'index', index:3 });
});


test('Phase 6.57 restores only the single history entry just displayed by Phase 6.56', () => {
  const history = [{ role:'assistant', content:'管理ID 8（2026/08/15 NORTH STAR BEANS 売上）の2回目の変更です。\n2. 2026/09/26 22:05：126,000円 → 125,000円\n   変更理由：記録済みです。' }];
  assert.deepEqual(recentSingleDisplayedHistoryReference(history), { managementDataId:8, selector:{ type:'index', index:2 } });
  for (const message of ['この変更後の値に戻して', 'その変更に戻して', '今見せてもらった変更に戻して']) {
    assert.deepEqual(detectHistoryPointRestoreRequest(message, history), { managementDataId:8, selector:{ type:'index', index:2 }, targetSide:'new', error:null, contextual:true });
  }
});

test('Phase 6.57 never infers a contextual restore from a full or multi-ID history response', () => {
  assert.deepEqual(detectHistoryPointRestoreRequest('この変更に戻して', [{ role:'assistant', content:'管理ID 8の変更履歴は2件です。\n1. 125,000円 → 126,000円\n2. 126,000円 → 125,000円' }]), { managementDataId:null, selector:null, error:'historyPointRequired' });
  assert.deepEqual(detectHistoryPointRestoreRequest('その変更に戻して', [{ role:'assistant', content:'管理ID 7と管理ID 8の変更履歴です。\n2. 125,000円 → 126,000円' }]), { managementDataId:null, selector:null, error:'historyPointRequired' });
  assert.equal(detectHistoryPointRestoreRequest('戻して', [{ role:'assistant', content:'管理ID 8（x）の2回目の変更です。\n2. x' }]), null);
});

test('Phase 6.57 keeps explicit ordinal restores first and accepts 回目・件目・full-width numbers', () => {
  for (const phrase of ['2番目', '2回目', '2件目', '３番目', '３回目', '３件目']) {
    const expected = phrase.startsWith('３') ? 3 : 2;
    assert.deepEqual(detectHistoryPointRestoreRequest(`管理ID8の${phrase}の変更後の値に戻して`, []), { managementDataId:8, selector:{ type:'index', index:expected }, targetSide:'new', error:null });
  }
});

test('Phase 6.54 does not guess a history target without management ID or safe context', () => {
  assert.deepEqual(
    detectHistoryPointRestoreRequest('3番目に戻して', []),
    { managementDataId:null, selector:{ type:'index', index:3 }, error:'managementDataIdRequired' }
  );
});

test('Phase 6.54 resolves an explicitly unique historical amount but rejects duplicate values', () => {
  const unique = resolveHistoryPoint(rows.slice(0, 2), { type:'newAmount', amount:126000, currency:'JPY' });
  assert.equal(unique.historyEntry.id, 11);
  const duplicate = resolveHistoryPoint(rows, { type:'newAmount', amount:126000, currency:'JPY' });
  assert.equal(duplicate.error, 'historyPointAmbiguous');
});

test('Phase 6.54 resolves a uniquely specified changed-at minute in Japan time', () => {
  const request = detectHistoryPointRestoreRequest('管理ID8の2026/09/26 22:08の変更後の値に戻して');
  assert.deepEqual(request.selector, { type:'changedAtMinute', value:'2026/09/26 22:08' });
  assert.equal(historyMinute(rows[2].changed_at), '2026/09/26 22:08');
  const resolved = resolveHistoryPoint(rows, request.selector);
  assert.equal(resolved.historyEntry.id, 13);
  assert.equal(resolved.amount, 126000);
});

test('Phase 6.54 rejects an absent ordinal and a vague previous-value instruction', () => {
  assert.equal(resolveHistoryPoint(rows, { type:'index', index:9 }).error, 'historyPointNotFound');
  assert.deepEqual(
    detectHistoryPointRestoreRequest('管理ID8の前の値に戻して'),
    { managementDataId:8, selector:null, error:'historyPointRequired' }
  );
});

test('Phase 6.54 keeps Phase 6.42 initial restore and Phase 6.53 read-only history separate', () => {
  assert.equal(detectHistoryPointRestoreRequest('管理ID8を最初の値に戻して'), null);
  assert.equal(detectHistoryPointRestoreRequest('管理ID8の変更の前後の値を詳しく教えて'), null);
});

test('Phase 6.54 ordering uses history id as deterministic tie breaker', () => {
  const ordered = orderedHistory([
    { id:22, changed_at:'2026-09-26T13:00:00.000Z' },
    { id:21, changed_at:'2026-09-26T13:00:00.000Z' }
  ]);
  assert.deepEqual(ordered.map(row => row.id), [21, 22]);
});

test('Phase 6.54 server confirmation remains owner-scoped, stale-checked and server-history-derived', async () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../server/server'), 'utf8');
  assert.match(source, /managementData\.findById\(auth\.ownerEmail, expectedEntryId\)/);
  assert.match(source, /managementData\.findHistoryByManagementDataId\(auth\.ownerEmail, expectedEntryId\)/);
  assert.match(source, /historyPointRestoreTargetSide\(body\.originalText\)/);
  assert.match(source, /resolveHistoryPoint\(entries, request\.selector \|\| \{ type:'index', index:expectedHistoryIndex \}, expectedTargetSide\)/);
  assert.match(source, /new Date\(existing\.updated_at\)\.getTime\(\) !== new Date\(expectedUpdatedAt\)\.getTime\(\)/);
  assert.match(source, /owner confirmed history point restore/);
  assert.match(source, /source history id:/);
  assert.match(source, /source history side:/);
});

test('Phase 6.54 candidate UI has no write action until explicit confirmation and sends only a history reference', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../app'), 'utf8');
  assert.match(source, /確認して復元/);
  assert.match(source, /今回は復元しない/);
  assert.match(source, /restoreHistoryEntryId:item\.restoreHistoryEntryId/);
  assert.match(source, /expectedUpdatedAt:item\.expectedUpdatedAt/);
  assert.match(source, /restoreTargetSide:item\.restoreTargetSide \|\| 'new'/);
  assert.match(source, /選択した変更前の過去値/);
  assert.match(source, /選択した変更後の過去値/);
});

test('Phase 6.58 resolves explicitly selected previous and new values only from the history row', () => {
  const previous = detectHistoryPointRestoreRequest('管理ID8の2回目の変更前の値に戻して');
  assert.deepEqual(previous, { managementDataId:8, selector:{ type:'index', index:2 }, targetSide:'previous', error:null });
  const previousTarget = resolveHistoryPoint(rows, previous.selector, previous.targetSide);
  assert.equal(previousTarget.historyEntry.id, 12);
  assert.equal(previousTarget.targetSide, 'previous');
  assert.equal(previousTarget.amount, 126000);
  assert.equal(previousTarget.currency, 'JPY');
  const next = detectHistoryPointRestoreRequest('管理ID8の2回目の変更後の値に戻して');
  assert.deepEqual(next, { managementDataId:8, selector:{ type:'index', index:2 }, targetSide:'new', error:null });
  assert.equal(resolveHistoryPoint(rows, next.selector, next.targetSide).amount, 125000);
});

test('Phase 6.58 accepts ordinal variants and safely carries the selected side from one single-history display', () => {
  for (const phrase of ['2件目', '2番目', '２回目', '２件目', '２番目']) {
    const request = detectHistoryPointRestoreRequest(`管理ID8の${phrase}の変更前の値へ復元して`);
    assert.equal(request.selector.index, 2);
    assert.equal(request.targetSide, 'previous');
  }
  assert.equal(historyPointRestoreTargetSide('管理ID8の2番目に戻して'), 'new');
  const history = [{ role:'assistant', content:'管理ID 8（2026/08/15 NORTH STAR BEANS 売上）の2回目の変更です。\n2. 2026/09/26 22:05：126,000円 → 125,000円' }];
  assert.equal(detectHistoryPointRestoreRequest('この変更前の値に戻して', history).targetSide, 'previous');
  assert.equal(detectHistoryPointRestoreRequest('その変更後の値に戻して', history).targetSide, 'new');
  assert.equal(detectHistoryPointRestoreRequest('この変更に戻して', history).targetSide, 'new');
  const standalone = detectHistoryPointRestoreRequest('前の値に戻して', history);
  assert.equal(standalone.managementDataId, null);
  assert.equal(standalone.selector, null);
});
