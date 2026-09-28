'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  managementDataIdFromText,
  recentUnambiguousManagementDataId,
  detectManagementDataIdHistoryQuery,
  managementDataIdHistoryAnswer,
  detectManagementDataHistoryQuery,
  detectManagementDataHistoryFollowUp,
  isInitialManagementDataRestorePhrase,
  detectManagementDataRestoreRequest,
  detectManagementDataCurrentStateQuery,
  managementDataCurrentStateAnswer,
  detectManagementDataDuplicateResolutionRequest,
  managementDataDuplicateResolutionCandidates,
  managementDataDuplicateResolutionAnswer,
  detectManagementDataDuplicateResolutionHistoryQuery,
  managementDataDuplicateResolutionHistoryAnswer,
  managementAuditLogPeriod,
  managementAuditSummaryAnswerMode,
  detectManagementDataAuditSummaryQuery,
  managementDataAuditSummaryAnswer,
  detectManagementDataAuditLogQuery,
  managementDataAuditLogAnswer,
  detectManagementDataBusinessAuditQuery,
  managementDataBusinessAuditAnswer,
  detectManagementDataHistoryConsistencyQuery,
  managementDataHistoryConsistencyAnswer,
  managementDataHistoryAnswer
} = require('../server/management-data/query');
const { PostgresManagementDataRepository } = require('../server/management-data/postgres-management-data-repository');

test('Phase 6.39 detects a dated revenue history question even when the business name is omitted', () => {
  assert.deepEqual(
    detectManagementDataHistoryQuery('2026年8月15日の売上の変更履歴を教えて'),
    { businessKey:null, dataDate:'2026-08-15', metricType:'revenue', includeActor:false, includeReason:false, includeSourceText:false }
  );
});

test('Phase 6.39 detects an explicit NORTH STAR BEANS history question', () => {
  assert.deepEqual(
    detectManagementDataHistoryQuery('2026年8月15日のNORTH STAR BEANSの売上の更新履歴を教えて'),
    { businessKey:'north-star-beans', dataDate:'2026-08-15', metricType:'revenue', includeActor:false, includeReason:false, includeSourceText:false }
  );
});

test('Phase 6.39 does not treat an ordinary current-value question as history', () => {
  assert.equal(
    detectManagementDataHistoryQuery('2026年8月15日のNORTH STAR BEANSの売上はいくらですか'),
    null
  );
});

test('Phase 6.39 formats chronological old-to-new changes and the current confirmed value', () => {
  const answer = managementDataHistoryAnswer([
    {
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-29T02:00:00.000Z'
    },
    {
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-29T02:05:00.000Z'
    }
  ], {
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.match(answer, /2026年8月15日/);
  assert.match(answer, /NORTH STAR BEANS/);
  assert.match(answer, /変更履歴は2件/);
  assert.match(answer, /125,000円 → 126,000円/);
  assert.match(answer, /126,000円 → 125,000円/);
  assert.match(answer, /現在の登録値は125,000円/);
});

test('Phase 6.39 asks for a business name when an omitted-business history query matches multiple businesses', () => {
  const answer = managementDataHistoryAnswer([
    { business_key:'north-star-beans', previous_amount:1, new_amount:2, previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-29T02:00:00Z' },
    { business_key:'other-business', previous_amount:3, new_amount:4, previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-29T02:01:00Z' }
  ], null, { businessKey:null, dataDate:'2026-08-15', metricType:'revenue' });
  assert.match(answer, /複数事業/);
  assert.match(answer, /事業名を指定/);
});

test('Phase 6.39 history repository is owner-scoped, ordered chronologically and can filter by business', async () => {
  let captured = null;
  const repository = new PostgresManagementDataRepository({
    async query(sql, params) {
      captured = { sql, params };
      return { rows:[] };
    }
  });

  const rows = await repository.findHistory('owner@example.com', {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.deepEqual(rows, []);
  assert.match(captured.sql, /FROM management_data_history/);
  assert.match(captured.sql, /WHERE history\.owner_email = \$1/);
  assert.match(captured.sql, /history\.data_date = \$2::date/);
  assert.match(captured.sql, /history\.metric_type = \$3/);
  assert.match(captured.sql, /history\.business_key = \$4/);
  assert.match(captured.sql, /ORDER BY history\.changed_at ASC, history\.id ASC/);
  assert.deepEqual(captured.params, ['owner@example.com', '2026-08-15', 'revenue', 'north-star-beans']);
});


test('Phase 6.40 detects who and why questions as audit-history detail requests', () => {
  assert.deepEqual(
    detectManagementDataHistoryQuery('2026年8月15日のNORTH STAR BEANSの売上は誰がなぜ変更したの？'),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeActor:true,
      includeReason:true,
      includeSourceText:false
    }
  );
});

test('Phase 6.40 detects original-input requests without requiring the word 履歴', () => {
  assert.deepEqual(
    detectManagementDataHistoryQuery('2026年8月15日の売上を変更した元の入力文を見せて'),
    {
      businessKey:null,
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeActor:false,
      includeReason:false,
      includeSourceText:true
    }
  );
});

test('Phase 6.40 reports confirmed actor, recorded update context and original input without inventing a motive', () => {
  const answer = managementDataHistoryAnswer([
    {
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      source:'owner confirmed correction',
      change_note:'2026年8月15日のNORTH STAR BEANSの売上は126000円です',
      confirmed_by_owner:true,
      changed_at:'2026-09-26T12:51:00.000Z'
    },
    {
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      source:'owner confirmed correction',
      change_note:'2026年8月15日のNORTH STAR BEANSの売上は125000円です',
      confirmed_by_owner:true,
      changed_at:'2026-09-26T13:08:00.000Z'
    }
  ], {
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    includeActor:true,
    includeReason:true,
    includeSourceText:true
  });

  assert.match(answer, /変更者：オーナー本人（確認操作済み）/);
  assert.match(answer, /変更理由：記録上は「オーナー確認による訂正」です。具体的な訂正理由は記録されていません。/);
  assert.match(answer, /確認時の入力文：「2026年8月15日のNORTH STAR BEANSの売上は126000円です」/);
  assert.match(answer, /確認時の入力文：「2026年8月15日のNORTH STAR BEANSの売上は125000円です」/);
  assert.match(answer, /現在の登録値は125,000円/);
});

test('Phase 6.40 states when a specific change reason was not recorded', () => {
  const answer = managementDataHistoryAnswer([
    {
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      source:'legacy import',
      change_note:null,
      confirmed_by_owner:true,
      changed_at:'2026-09-26T12:51:00.000Z'
    }
  ], null, {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    includeActor:false,
    includeReason:true,
    includeSourceText:true
  });

  assert.match(answer, /変更理由は個別には記録されていません/);
  assert.match(answer, /確認時の入力文：記録されていません/);
});


test('Phase 6.41 resolves 「そのとき何と入力したの？」 from the previous dated history question', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上は誰がなぜ変更したの？' },
    { role:'assistant', content:'2026年8月15日のNORTH STAR BEANSの売上の変更履歴は2件です。' }
  ];

  assert.deepEqual(
    detectManagementDataHistoryFollowUp('そのとき私が実際に何と入力したの？', history),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeActor:false,
      includeReason:false,
      includeSourceText:true
    }
  );
});

test('Phase 6.41 can switch a prior history question into a contextual actor-and-reason follow-up', () => {
  const history = [
    { role:'user', content:'2026年8月15日の売上の変更履歴を教えて' },
    { role:'assistant', content:'変更履歴は2件です。' }
  ];

  assert.deepEqual(
    detectManagementDataHistoryFollowUp('その変更は誰が、なぜしたの？', history),
    {
      businessKey:null,
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeActor:true,
      includeReason:true,
      includeSourceText:false
    }
  );
});

test('Phase 6.41 does not guess a history target when the contextual reference is missing', () => {
  const history = [
    { role:'user', content:'2026年8月15日の売上の変更履歴を教えて' }
  ];
  assert.equal(
    detectManagementDataHistoryFollowUp('実際に何と入力しましたか？', history),
    null
  );
});

test('Phase 6.41 ignores unrelated prior turns and uses the latest valid management-history question', () => {
  const history = [
    { role:'user', content:'2026年8月15日の売上の変更履歴を教えて' },
    { role:'assistant', content:'変更履歴は2件です。' },
    { role:'user', content:'ありがとう' },
    { role:'assistant', content:'どういたしまして。' }
  ];
  const result = detectManagementDataHistoryFollowUp('そのとき何て入力したの？', history);
  assert.equal(result.dataDate, '2026-08-15');
  assert.equal(result.metricType, 'revenue');
  assert.equal(result.includeSourceText, true);
});


test('Phase 6.42 detects an explicit request to restore a dated metric to its first audited value', () => {
  assert.equal(isInitialManagementDataRestorePhrase('最初の値に戻して'), true);
  assert.deepEqual(
    detectManagementDataRestoreRequest('2026年8月15日のNORTH STAR BEANSの売上を最初の値に戻して'),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      restoreTarget:'initial'
    }
  );
});

test('Phase 6.42 resolves 「最初の値に戻して」 only from very recent audit-history context', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上は誰がなぜ変更したの？' },
    { role:'assistant', content:'変更履歴は2件です。' },
    { role:'user', content:'そのとき私が実際に何と入力したの？' },
    { role:'assistant', content:'確認時の入力文を表示しました。' }
  ];
  assert.deepEqual(
    detectManagementDataRestoreRequest('最初の値に戻して', history),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      restoreTarget:'initial'
    }
  );
});

test('Phase 6.42 refuses to infer a restore target from stale conversation context', () => {
  const history = [
    { role:'user', content:'2026年8月15日の売上の変更履歴を教えて' },
    { role:'assistant', content:'変更履歴は2件です。' },
    { role:'user', content:'別の話をします' },
    { role:'assistant', content:'はい。' },
    { role:'user', content:'広告について教えて' },
    { role:'assistant', content:'広告について回答します。' }
  ];
  assert.equal(detectManagementDataRestoreRequest('最初の値に戻して', history), null);
});

test('Phase 6.42 does not treat an ambiguous previous-value request as an initial-value restore', () => {
  assert.equal(isInitialManagementDataRestorePhrase('前の値に戻して'), false);
  assert.equal(detectManagementDataRestoreRequest('前の値に戻して', []), null);
});

test('Phase 6.42 history details identify an owner-confirmed history restore without inventing another reason', () => {
  const answer = managementDataHistoryAnswer([
    {
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      source:'owner confirmed history restore',
      change_note:'最初の値に戻して',
      confirmed_by_owner:true,
      changed_at:'2026-09-26T13:30:00.000Z'
    }
  ], {
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    includeActor:true,
    includeReason:true,
    includeSourceText:true
  });
  assert.match(answer, /変更者：オーナー本人/);
  assert.match(answer, /変更履歴から最初の値へ復元/);
  assert.match(answer, /確認時の入力文：「最初の値に戻して」/);
});


test('Phase 6.43 resolves 「今の売上はいくら？」 from the recent explicit restore target', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上を最初の値に戻して' },
    { role:'assistant', content:'変更履歴から最初の値への復元候補を作成しました。' }
  ];
  assert.deepEqual(
    detectManagementDataCurrentStateQuery('今の売上はいくら？', history),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeCurrentValue:true,
      includeLastChangedAt:false
    }
  );
});

test('Phase 6.43 resolves 「最後にいつ変更した？」 from the same recent management target', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上を最初の値に戻して' },
    { role:'assistant', content:'復元しました。' },
    { role:'user', content:'今の売上はいくら？' },
    { role:'assistant', content:'現在の登録売上は125,000円です。' }
  ];
  assert.deepEqual(
    detectManagementDataCurrentStateQuery('最後にいつ変更した？', history),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeCurrentValue:false,
      includeLastChangedAt:true
    }
  );
});

test('Phase 6.43 supports an explicit dated current-value question without conversation context', () => {
  assert.deepEqual(
    detectManagementDataCurrentStateQuery('2026年8月15日のNORTH STAR BEANSの現在の売上はいくらですか？', []),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue',
      includeCurrentValue:true,
      includeLastChangedAt:false
    }
  );
});

test('Phase 6.43 does not guess current state when there is no explicit or recent management target', () => {
  assert.equal(detectManagementDataCurrentStateQuery('今の売上はいくら？', []), null);
  assert.equal(detectManagementDataCurrentStateQuery('最後にいつ変更した？', []), null);
});

test('Phase 6.43 answers current value from the confirmed row and last change from the newest audit row', () => {
  const answer = managementDataCurrentStateAnswer({
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, [
    {
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-26T12:51:00.000Z'
    },
    {
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-26T13:30:00.000Z'
    }
  ], {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    includeCurrentValue:true,
    includeLastChangedAt:true
  });

  assert.match(answer, /現在の登録売上は125,000円/);
  assert.match(answer, /最後の変更は2026\/09\/26 22:30/);
  assert.match(answer, /126,000円 → 125,000円/);
});

test('Phase 6.43 says so when the current row exists but no change history has been recorded', () => {
  const answer = managementDataCurrentStateAnswer({
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, [], {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue',
    includeCurrentValue:true,
    includeLastChangedAt:true
  });
  assert.match(answer, /現在の登録売上は125,000円/);
  assert.match(answer, /保存されている変更履歴がありません/);
});


test('Phase 6.44 resolves 「この売上データは履歴と一致してる？」 from recent management context', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上を最初の値に戻して' },
    { role:'assistant', content:'復元しました。' },
    { role:'user', content:'今の売上はいくら？' },
    { role:'assistant', content:'現在の登録売上は125,000円です。' }
  ];
  assert.deepEqual(
    detectManagementDataHistoryConsistencyQuery('この売上データは履歴と一致してる？', history),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue'
    }
  );
});

test('Phase 6.44 supports an explicit dated history-consistency question', () => {
  assert.deepEqual(
    detectManagementDataHistoryConsistencyQuery('2026年8月15日のNORTH STAR BEANSの売上は変更履歴と一致していますか？', []),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue'
    }
  );
});

test('Phase 6.44 does not guess a consistency target without explicit or recent management context', () => {
  assert.equal(
    detectManagementDataHistoryConsistencyQuery('この売上データは履歴と一致してる？', []),
    null
  );
});

test('Phase 6.44 reports a fully continuous matching audit chain as consistent', () => {
  const answer = managementDataHistoryConsistencyAnswer({
    id:'44',
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, [
    {
      management_data_id:'44',
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY'
    },
    {
      management_data_id:'44',
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY'
    }
  ], {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.match(answer, /履歴と一致しています/);
  assert.match(answer, /現在値125,000円/);
  assert.match(answer, /最新履歴の変更後の値125,000円/);
  assert.match(answer, /履歴2件のつながりにも不整合はありません/);
});

test('Phase 6.44 detects when the current value differs from the latest audit value', () => {
  const answer = managementDataHistoryConsistencyAnswer({
    id:'44',
    business_key:'north-star-beans',
    amount:'124000.00',
    currency:'JPY'
  }, [
    {
      management_data_id:'44',
      business_key:'north-star-beans',
      previous_amount:'126000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY'
    }
  ], {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.match(answer, /履歴との不整合があります/);
  assert.match(answer, /現在値124,000円と最新履歴の変更後の値125,000円が一致していません/);
  assert.match(answer, /自動修正はしていません/);
});

test('Phase 6.44 detects a broken audit chain even when the latest value matches the current row', () => {
  const answer = managementDataHistoryConsistencyAnswer({
    id:'44',
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, [
    {
      management_data_id:'44',
      business_key:'north-star-beans',
      previous_amount:'125000.00',
      new_amount:'126000.00',
      previous_currency:'JPY',
      new_currency:'JPY'
    },
    {
      management_data_id:'44',
      business_key:'north-star-beans',
      previous_amount:'127000.00',
      new_amount:'125000.00',
      previous_currency:'JPY',
      new_currency:'JPY'
    }
  ], {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.match(answer, /履歴との不整合があります/);
  assert.match(answer, /履歴1件目から2件目の値が連続していません/);
});

test('Phase 6.44 does not claim consistency when there is no change history', () => {
  const answer = managementDataHistoryConsistencyAnswer({
    id:'44',
    business_key:'north-star-beans',
    amount:'125000.00',
    currency:'JPY'
  }, [], {
    businessKey:'north-star-beans',
    dataDate:'2026-08-15',
    metricType:'revenue'
  });

  assert.match(answer, /変更履歴がないため履歴との一致は判定できません/);
});


test('Phase 6.44 keeps the target after current-value and last-change follow-ups', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上を最初の値に戻して' },
    { role:'assistant', content:'復元しました。' },
    { role:'user', content:'今の売上はいくら？' },
    { role:'assistant', content:'現在の登録売上は125,000円です。' },
    { role:'user', content:'最後にいつ変更した？' },
    { role:'assistant', content:'最後の変更は2026/09/26 23:44です。' }
  ];

  assert.deepEqual(
    detectManagementDataHistoryConsistencyQuery('この売上データは履歴と一致してる？', history),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-08-15',
      metricType:'revenue'
    }
  );
});


test('Phase 6.45 detects an explicit whole-business management consistency audit', () => {
  assert.deepEqual(
    detectManagementDataBusinessAuditQuery('NORTH STAR BEANSの経営データ全体に不整合がないか確認して', []),
    { businessKey:'north-star-beans' }
  );
});

test('Phase 6.45 can inherit only the business for a read-only whole-business audit', () => {
  const history = [
    { role:'user', content:'2026年8月15日のNORTH STAR BEANSの売上は履歴と一致してる？' },
    { role:'assistant', content:'履歴と一致しています。' }
  ];
  assert.deepEqual(
    detectManagementDataBusinessAuditQuery('経営データ全体もチェックして', history),
    { businessKey:'north-star-beans' }
  );
});

test('Phase 6.45 does not hijack a single-item consistency question', () => {
  assert.equal(
    detectManagementDataBusinessAuditQuery('この売上データは履歴と一致してる？', []),
    null
  );
});

test('Phase 6.45 reports only the summary when all auditable items are consistent', () => {
  const answer = managementDataBusinessAuditAnswer([
    {
      id:'10', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', amount:'125000', currency:'JPY'
    },
    {
      id:'11', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'customers', amount:'80', currency:'COUNT'
    }
  ], [
    {
      id:'1', management_data_id:'10', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', previous_amount:'120000', new_amount:'125000',
      previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T10:00:00Z'
    }
  ], { businessKey:'north-star-beans' });

  assert.match(answer, /登録済み項目は2件/);
  assert.match(answer, /不整合は見つかりませんでした/);
  assert.match(answer, /履歴がある1件は現在値・最新履歴・履歴のつながりが一致しています/);
  assert.match(answer, /履歴のない1件/);
  assert.doesNotMatch(answer, /問題がある項目だけ表示します/);
});

test('Phase 6.45 lists mismatches and broken history chains without auto-repair', () => {
  const answer = managementDataBusinessAuditAnswer([
    {
      id:'10', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', amount:'124000', currency:'JPY'
    },
    {
      id:'11', business_key:'north-star-beans', data_date:'2026-08-16',
      metric_type:'revenue', amount:'130000', currency:'JPY'
    }
  ], [
    {
      id:'1', management_data_id:'10', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', previous_amount:'120000', new_amount:'125000',
      previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T10:00:00Z'
    },
    {
      id:'2', management_data_id:'11', business_key:'north-star-beans', data_date:'2026-08-16',
      metric_type:'revenue', previous_amount:'126000', new_amount:'128000',
      previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T11:00:00Z'
    },
    {
      id:'3', management_data_id:'11', business_key:'north-star-beans', data_date:'2026-08-16',
      metric_type:'revenue', previous_amount:'129000', new_amount:'130000',
      previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T12:00:00Z'
    }
  ], { businessKey:'north-star-beans' });

  assert.match(answer, /不整合が2件見つかりました/);
  assert.match(answer, /2026\/08\/15 売上: 現在値124,000円と最新履歴の変更後の値125,000円が一致していません/);
  assert.match(answer, /2026\/08\/16 売上: 履歴1件目から2件目の値が連続していません/);
  assert.match(answer, /問題がある項目だけ表示します/);
  assert.match(answer, /自動修正はしていません/);
});

test('Phase 6.45 detects duplicate current rows for the same date and metric', () => {
  const answer = managementDataBusinessAuditAnswer([
    {
      id:'10', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', amount:'125000', currency:'JPY'
    },
    {
      id:'12', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', amount:'126000', currency:'JPY'
    }
  ], [], { businessKey:'north-star-beans' });

  assert.match(answer, /不整合が1件見つかりました/);
  assert.match(answer, /現在の本人確認済み登録値が2行あります/);
  assert.match(answer, /管理ID: 10, 12/);
});

test('Phase 6.45 detects audit history without a corresponding current confirmed row', () => {
  const answer = managementDataBusinessAuditAnswer([], [
    {
      id:'1', management_data_id:'99', business_key:'north-star-beans', data_date:'2026-08-15',
      metric_type:'revenue', previous_amount:'120000', new_amount:'125000',
      previous_currency:'JPY', new_currency:'JPY', changed_at:'2026-09-26T10:00:00Z'
    }
  ], { businessKey:'north-star-beans' });

  assert.match(answer, /不整合が1件見つかりました/);
  assert.match(answer, /対応する現在の本人確認済み登録行が見つかりません/);
  assert.match(answer, /管理ID: 99/);
});


test('Phase 6.46 detects an explicit whole-business duplicate cleanup request', () => {
  assert.deepEqual(
    detectManagementDataDuplicateResolutionRequest('NORTH STAR BEANSの重複データを整理する候補を出して', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.46 inherits only a recent explicit business for duplicate cleanup', () => {
  const history = [
    { role:'user', content:'NORTH STAR BEANSの経営データ全体に不整合がないか確認して' },
    { role:'assistant', content:'重複登録を含む論理項目は2件です。' }
  ];
  assert.deepEqual(
    detectManagementDataDuplicateResolutionRequest('重複を整理する候補を出して', history),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.46 does not turn a plain audit question into a cleanup request', () => {
  assert.equal(
    detectManagementDataDuplicateResolutionRequest('NORTH STAR BEANSの経営データ全体に不整合がないか確認して', []),
    null
  );
});

test('Phase 6.46 builds one explicit keep-row choice per duplicate logical item', () => {
  const candidates = managementDataDuplicateResolutionCandidates([
    { id:'4', business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'160000', currency:'JPY', created_at:'2026-09-22T10:00:00Z', updated_at:'2026-09-22T10:00:00Z', source:'owner', note:'' },
    { id:'7', business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue', amount:'161000', currency:'JPY', created_at:'2026-09-22T11:00:00Z', updated_at:'2026-09-22T11:00:00Z', source:'owner', note:'' },
    { id:'2', business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'80', currency:'COUNT', created_at:'2026-09-22T09:00:00Z', updated_at:'2026-09-22T09:00:00Z', source:'owner', note:'' },
    { id:'3', business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'customers', amount:'81', currency:'COUNT', created_at:'2026-09-22T09:30:00Z', updated_at:'2026-09-22T09:30:00Z', source:'owner', note:'' }
  ], [
    { management_data_id:'4' },
    { management_data_id:'4' },
    { management_data_id:'7' }
  ], { businessKey:'north-star-beans' }, '重複を整理する候補を出して');

  assert.equal(candidates.length, 2);
  const revenue = candidates.find(item => item.metricType === 'revenue');
  assert.equal(revenue.rows.length, 2);
  assert.equal(revenue.recommendedKeepId, '4');
  assert.equal(revenue.operation, 'deduplicate');
  assert.equal(revenue.confirmed, false);
  assert.match(revenue.recommendationReason, /最終判断は本人/);
  const customers = candidates.find(item => item.metricType === 'customers');
  assert.equal(customers.recommendedKeepId, '3');
});

test('Phase 6.46 duplicate cleanup answer says nothing has changed before confirmation', () => {
  const answer = managementDataDuplicateResolutionAnswer([{ metricType:'revenue' }, { metricType:'customers' }], 'north-star-beans');
  assert.match(answer, /重複整理候補を2件/);
  assert.match(answer, /まだ何も変更していません/);
  assert.match(answer, /削除せず/);
});


test('Phase 6.47 detects an explicit duplicate-resolution history question', () => {
  assert.deepEqual(
    detectManagementDataDuplicateResolutionHistoryQuery('NORTH STAR BEANSの重複整理履歴を教えて', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.47 can filter duplicate-resolution history by date and metric', () => {
  assert.deepEqual(
    detectManagementDataDuplicateResolutionHistoryQuery('2026年9月22日のNORTH STAR BEANSの売上の重複整理でどの管理IDを残した？', []),
    { businessKey:'north-star-beans', dataDate:'2026-09-22', metricType:'revenue' }
  );
});

test('Phase 6.47 inherits the recent business for a duplicate-resolution history follow-up', () => {
  const history = [
    { role:'user', content:'NORTH STAR BEANSの経営データ全体に不整合がないか確認して' },
    { role:'assistant', content:'不整合は見つかりませんでした。' }
  ];
  assert.deepEqual(
    detectManagementDataDuplicateResolutionHistoryQuery('さっきの重複整理履歴を教えて', history),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.47 history question is not mistaken for a new duplicate cleanup request', () => {
  const text = 'NORTH STAR BEANSの重複整理履歴を教えて';
  assert.deepEqual(
    detectManagementDataDuplicateResolutionHistoryQuery(text, []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
  assert.equal(detectManagementDataDuplicateResolutionRequest(text, []), null);
});

test('Phase 6.47 formats who, when, kept IDs, excluded IDs and row snapshots', () => {
  const answer = managementDataDuplicateResolutionHistoryAnswer([
    {
      business_key:'north-star-beans',
      data_date:'2026-09-22',
      metric_type:'revenue',
      kept_management_data_id:'7',
      superseded_management_data_ids:[4],
      original_rows:[
        { id:'4', amount:160000, currency:'JPY' },
        { id:'7', amount:160000, currency:'JPY' }
      ],
      resolved_at:'2026-09-27T04:18:00.000Z'
    },
    {
      business_key:'north-star-beans',
      data_date:'2026-09-22',
      metric_type:'customers',
      kept_management_data_id:'5',
      superseded_management_data_ids:[2,3],
      original_rows:[
        { id:'2', amount:80, currency:'COUNT' },
        { id:'3', amount:80, currency:'COUNT' },
        { id:'5', amount:80, currency:'COUNT' }
      ],
      resolved_at:'2026-09-27T04:19:00.000Z'
    }
  ], { businessKey:'north-star-beans' });

  assert.match(answer, /重複整理履歴は2件/);
  assert.match(answer, /管理ID 7を残し、管理ID 4を重複扱い/);
  assert.match(answer, /管理ID 5を残し、管理ID 2・3を重複扱い/);
  assert.match(answer, /確認者はオーナー本人/);
  assert.match(answer, /管理ID 4=160,000円/);
  assert.match(answer, /管理ID 5=80人/);
});

test('Phase 6.47 says clearly when no duplicate-resolution history exists', () => {
  const answer = managementDataDuplicateResolutionHistoryAnswer([], { businessKey:'north-star-beans' });
  assert.match(answer, /条件に一致する重複整理履歴はありません/);
});


test('Phase 6.48 detects an explicit comprehensive management audit-log question', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの経営データ総合監査ログを教えて', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.49 recognizes event types in a natural who-what-when management audit question', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSでは、いつ何を誰が変更・整理した？', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['change','duplicate_resolution']
    }
  );
});

test('Phase 6.48 can filter the comprehensive audit log by business date and metric', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('2026年9月22日のNORTH STAR BEANSの売上の監査ログを教えて', []),
    { businessKey:'north-star-beans', dataDate:'2026-09-22', metricType:'revenue' }
  );
});

test('Phase 6.48 inherits only a recent explicit business for an audit-log follow-up', () => {
  const history = [
    { role:'user', content:'NORTH STAR BEANSの重複整理履歴を教えて' },
    { role:'assistant', content:'重複整理履歴は2件です。' }
  ];
  assert.deepEqual(
    detectManagementDataAuditLogQuery('その経営データの監査ログも教えて', history),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.48 does not hijack a business consistency audit or Phase 6.47 duplicate history', () => {
  assert.equal(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの経営データ全体に不整合がないか確認して', []),
    null
  );
  assert.equal(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの重複整理履歴を教えて', []),
    null
  );
});

test('Phase 6.48 formats registration, change and duplicate cleanup in one timeline', () => {
  const answer = managementDataAuditLogAnswer([
    {
      event_type:'duplicate_resolution', event_id:'2', management_data_id:'7',
      business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue',
      kept_management_data_id:'7', superseded_management_data_ids:[4],
      original_rows:[
        { id:'4', amount:160000, currency:'JPY' },
        { id:'7', amount:160000, currency:'JPY' }
      ],
      confirmed_by_owner:true, event_at:'2026-09-27T04:18:00.000Z'
    },
    {
      event_type:'change', event_id:'1', management_data_id:'10',
      business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue',
      previous_amount:125000, new_amount:126000,
      previous_currency:'JPY', new_currency:'JPY',
      action_note:'オーナー確認による訂正',
      confirmed_by_owner:true, event_at:'2026-09-26T12:51:00.000Z'
    },
    {
      event_type:'registration', event_id:'4', management_data_id:'4',
      business_key:'north-star-beans', data_date:'2026-09-22', metric_type:'revenue',
      amount:160000, currency:'JPY', confirmed_by_owner:true,
      superseded_by_management_data_id:'7', event_at:'2026-09-22T13:53:37.000Z'
    }
  ], { businessKey:'north-star-beans' });

  assert.match(answer, /総合監査ログは3件です（登録1件・変更1件・重複整理1件）/);
  assert.match(answer, /管理ID 7を残し、管理ID 4を重複扱い/);
  assert.match(answer, /125,000円から126,000円へ変更/);
  assert.match(answer, /管理ID 4/);
  assert.match(answer, /後に管理ID 7へ重複整理/);
  assert.match(answer, /本人確認済み/);
});

test('Phase 6.48 says clearly when the comprehensive audit log is empty', () => {
  const answer = managementDataAuditLogAnswer([], { businessKey:'north-star-beans' });
  assert.match(answer, /条件に一致する経営データの監査ログはありません/);
});


test('Phase 6.49 filters a standalone audit log to registration events only', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの監査ログで登録だけ見せて', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['registration']
    }
  );
});

test('Phase 6.49 filters a standalone audit log to change events only', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの監査ログで変更だけ見せて', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['change']
    }
  );
});

test('Phase 6.49 filters a standalone audit log to duplicate cleanup only', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの監査ログで重複整理だけ見せて', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['duplicate_resolution']
    }
  );
});

test('Phase 6.49 supports latest-N audit log limits and caps them at 50', () => {
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの監査ログを直近10件だけ見せて', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      limit:10
    }
  );
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの監査ログを最新999件見せて', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      limit:50
    }
  );
});

test('Phase 6.49 supports metric-only follow-ups after a recent audit-log turn', () => {
  const history = [
    { role:'user', content:'NORTH STAR BEANSの経営データ総合監査ログを教えて' },
    { role:'assistant', content:'NORTH STAR BEANSの経営データ総合監査ログは14件です。' }
  ];
  assert.deepEqual(
    detectManagementDataAuditLogQuery('売上だけ見せて', history),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:'revenue'
    }
  );
});

test('Phase 6.49 supports event-type and latest-N follow-ups after a recent audit-log turn', () => {
  const history = [
    { role:'user', content:'NORTH STAR BEANSの経営データ総合監査ログを教えて' },
    { role:'assistant', content:'NORTH STAR BEANSの経営データ総合監査ログは14件です。' }
  ];
  assert.deepEqual(
    detectManagementDataAuditLogQuery('変更だけ直近3件', history),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['change'],
      limit:3
    }
  );
  assert.deepEqual(
    detectManagementDataAuditLogQuery('重複整理だけ見せて', history),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['duplicate_resolution']
    }
  );
});

test('Phase 6.49 does not treat filter-only phrases as audit queries without audit context', () => {
  assert.equal(detectManagementDataAuditLogQuery('売上だけ見せて', []), null);
  assert.equal(detectManagementDataAuditLogQuery('変更だけ直近3件', []), null);
});

test('Phase 6.49 audit answer identifies applied filters', () => {
  const answer = managementDataAuditLogAnswer([
    {
      event_type:'change', event_id:'2', management_data_id:'10',
      business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue',
      previous_amount:125000, new_amount:126000,
      previous_currency:'JPY', new_currency:'JPY',
      confirmed_by_owner:true, event_at:'2026-09-26T12:51:00.000Z'
    }
  ], {
    businessKey:'north-star-beans',
    metricType:'revenue',
    eventTypes:['change'],
    limit:3
  });
  assert.match(answer, /絞り込み: 売上、変更、直近3件/);
  assert.match(answer, /登録0件・変更1件・重複整理0件/);
});


test('Phase 6.50 resolves this month and last month in Japan time', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    managementAuditLogPeriod('今月の監査ログ', now),
    { startDate:'2026-09-01', endDate:'2026-09-30', label:'今月' }
  );
  assert.deepEqual(
    managementAuditLogPeriod('先月の監査ログ', now),
    { startDate:'2026-08-01', endDate:'2026-08-31', label:'先月' }
  );
});

test('Phase 6.50 resolves an explicit month and a same-month day range', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    managementAuditLogPeriod('2026年9月の監査ログ', now),
    { startDate:'2026-09-01', endDate:'2026-09-30', label:'2026年9月' }
  );
  assert.deepEqual(
    managementAuditLogPeriod('9月20日から27日の監査ログ', now),
    { startDate:'2026-09-20', endDate:'2026-09-27', label:'2026年9月20日〜2026年9月27日' }
  );
});

test('Phase 6.50 supports explicit ISO date ranges', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    managementAuditLogPeriod('2026/09/20〜2026/09/27の監査ログ', now),
    { startDate:'2026-09-20', endDate:'2026-09-27', label:'2026/09/20〜2026/09/27' }
  );
});

test('Phase 6.50 applies an operation-date month filter to a standalone audit query', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの今月の監査ログを教えて', [], now),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      auditStartDate:'2026-09-01',
      auditEndDate:'2026-09-30',
      auditPeriodLabel:'今月'
    }
  );
});

test('Phase 6.50 combines month, event-type and metric filters', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSの2026年9月の売上の変更だけ見せて', [], now),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:'revenue',
      eventTypes:['change'],
      auditStartDate:'2026-09-01',
      auditEndDate:'2026-09-30',
      auditPeriodLabel:'2026年9月'
    }
  );
});

test('Phase 6.50 supports a period-only follow-up after an audit-log turn', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  const history = [
    { role:'user', content:'NORTH STAR BEANSの経営データ総合監査ログを教えて' },
    { role:'assistant', content:'NORTH STAR BEANSの経営データ総合監査ログは14件です。' }
  ];
  assert.deepEqual(
    detectManagementDataAuditLogQuery('9月20日から27日だけ見せて', history, now),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      auditStartDate:'2026-09-20',
      auditEndDate:'2026-09-27',
      auditPeriodLabel:'2026年9月20日〜2026年9月27日'
    }
  );
});

test('Phase 6.50 keeps a single dated audit question as a data-date filter', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    detectManagementDataAuditLogQuery('2026年9月22日のNORTH STAR BEANSの売上の監査ログを教えて', [], now),
    {
      businessKey:'north-star-beans',
      dataDate:'2026-09-22',
      metricType:'revenue'
    }
  );
});

test('Phase 6.50 audit answer identifies the applied operation period', () => {
  const answer = managementDataAuditLogAnswer([
    {
      event_type:'change', event_id:'2', management_data_id:'10',
      business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue',
      previous_amount:125000, new_amount:126000,
      previous_currency:'JPY', new_currency:'JPY',
      event_at:'2026-09-26T12:51:00.000Z'
    }
  ], {
    businessKey:'north-star-beans',
    metricType:'revenue',
    eventTypes:['change'],
    auditStartDate:'2026-09-20',
    auditEndDate:'2026-09-27',
    auditPeriodLabel:'2026年9月20日〜2026年9月27日'
  });
  assert.match(answer, /絞り込み: 2026年9月20日〜2026年9月27日、売上、変更/);
});


test('Phase 6.51 detects a direct audit summary request', () => {
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSの監査ログを要約して', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null }
  );
});

test('Phase 6.52 detects a direct change-count question as a focused answer', () => {
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSは何回変更した？', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null, answerMode:'change_count' }
  );
});

test('Phase 6.51 supports period and metric filters in an audit summary', () => {
  const now = new Date('2026-09-27T12:00:00.000Z');
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSの今月の売上の監査ログを集計して', [], now),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:'revenue',
      auditStartDate:'2026-09-01',
      auditEndDate:'2026-09-30',
      auditPeriodLabel:'今月'
    }
  );
});

test('Phase 6.51 supports change-frequency and operator follow-ups after audit context', () => {
  const history = [
    { role:'user', content:'NORTH STAR BEANSの経営データ総合監査ログを教えて' },
    { role:'assistant', content:'NORTH STAR BEANSの経営データ総合監査ログは14件です。' }
  ];
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('変更が一番多いデータはどれ？', history),
    { businessKey:'north-star-beans', dataDate:null, metricType:null, answerMode:'most_changed' }
  );
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('誰が操作した？', history),
    { businessKey:'north-star-beans', dataDate:null, metricType:null, answerMode:'operator' }
  );
});

test('Phase 6.51 preserves the Phase 6.48 who-what-when detailed audit-log question', () => {
  assert.equal(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSでは、いつ何を誰が変更・整理した？', []),
    null
  );
  assert.deepEqual(
    detectManagementDataAuditLogQuery('NORTH STAR BEANSでは、いつ何を誰が変更・整理した？', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['change','duplicate_resolution']
    }
  );
});

test('Phase 6.51 formats counts, owner-confirmation limits and most-changed management data', () => {
  const answer = managementDataAuditSummaryAnswer({
    total_count:14,
    registration_count:8,
    change_count:4,
    duplicate_resolution_count:2,
    owner_confirmed_count:14,
    management_data_count:8,
    first_event_at:'2026-09-20T00:09:00.000Z',
    last_event_at:'2026-09-27T04:21:00.000Z',
    top_changes:[
      {
        management_data_id:8,
        data_date:'2026-08-15',
        metric_type:'revenue',
        change_count:4,
        last_changed_at:'2026-09-26T14:44:00.000Z'
      }
    ]
  }, { businessKey:'north-star-beans' });

  assert.match(answer, /監査イベントは合計14件/);
  assert.match(answer, /登録8件・変更4件・重複整理2件/);
  assert.match(answer, /対象となった管理データは8件、変更操作は4回/);
  assert.match(answer, /14件すべてオーナー本人確認済み/);
  assert.match(answer, /実際の端末操作者を別IDでは保存していない/);
  assert.match(answer, /2026\/08\/15 売上（管理ID 8）：4回/);
});

test('Phase 6.51 summary can be safely narrowed to change events only', () => {
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSの監査ログを変更だけ集計して', []),
    {
      businessKey:'north-star-beans',
      dataDate:null,
      metricType:null,
      eventTypes:['change']
    }
  );
});

test('Phase 6.51 summary is clear when no matching audit events exist', () => {
  const answer = managementDataAuditSummaryAnswer(
    { total_count:0 },
    { businessKey:'north-star-beans', auditPeriodLabel:'先月' }
  );
  assert.match(answer, /条件に一致する経営データの監査イベントはありません/);
});


test('Phase 6.52 classifies focused audit-summary answer modes without changing full-summary requests', () => {
  assert.equal(managementAuditSummaryAnswerMode('監査ログを要約して'), null);
  assert.equal(managementAuditSummaryAnswerMode('何回変更した？'), 'change_count');
  assert.equal(managementAuditSummaryAnswerMode('変更が最も多いデータは？'), 'most_changed');
  assert.equal(managementAuditSummaryAnswerMode('誰が操作した？'), 'operator');
  assert.equal(managementAuditSummaryAnswerMode('登録は何件？'), 'registration_count');
  assert.equal(managementAuditSummaryAnswerMode('重複整理は何件？'), 'duplicate_resolution_count');
});

test('Phase 6.52 answers change-count questions directly instead of repeating the full summary', () => {
  const answer = managementDataAuditSummaryAnswer({
    total_count:14,
    registration_count:8,
    change_count:4,
    duplicate_resolution_count:2,
    owner_confirmed_count:14,
    management_data_count:8,
    top_changes:[]
  }, {
    businessKey:'north-star-beans',
    answerMode:'change_count'
  });

  assert.equal(answer, 'NORTH STAR BEANSの変更操作は4回です。');
  assert.doesNotMatch(answer, /監査イベントは合計/);
  assert.doesNotMatch(answer, /変更回数が多い管理データ/);
});

test('Phase 6.52 answers most-changed questions with only the top management data', () => {
  const answer = managementDataAuditSummaryAnswer({
    total_count:14,
    registration_count:8,
    change_count:4,
    duplicate_resolution_count:2,
    owner_confirmed_count:14,
    management_data_count:8,
    top_changes:[
      {
        management_data_id:8,
        data_date:'2026-08-15',
        metric_type:'revenue',
        change_count:4,
        last_changed_at:'2026-09-26T14:44:00.000Z'
      },
      {
        management_data_id:7,
        data_date:'2026-09-22',
        metric_type:'revenue',
        change_count:1,
        last_changed_at:'2026-09-23T00:07:22.000Z'
      }
    ]
  }, {
    businessKey:'north-star-beans',
    answerMode:'most_changed'
  });

  assert.match(answer, /2026\/08\/15 売上（管理ID 8）で4回/);
  assert.match(answer, /最終変更/);
  assert.doesNotMatch(answer, /管理ID 7/);
  assert.doesNotMatch(answer, /監査イベントは合計/);
});

test('Phase 6.52 answers operator questions concisely without inventing an actor identity', () => {
  const answer = managementDataAuditSummaryAnswer({
    total_count:14,
    registration_count:8,
    change_count:4,
    duplicate_resolution_count:2,
    owner_confirmed_count:14,
    management_data_count:8,
    top_changes:[]
  }, {
    businessKey:'north-star-beans',
    answerMode:'operator'
  });

  assert.match(answer, /14件すべてオーナー本人確認済み/);
  assert.match(answer, /実際の端末操作者を特定するIDは保存していない/);
  assert.match(answer, /誰が操作したかまでは特定できません/);
  assert.doesNotMatch(answer, /監査イベントは合計/);
});

test('Phase 6.52 focused answers keep period and metric scope visible', () => {
  const answer = managementDataAuditSummaryAnswer({
    total_count:4,
    registration_count:0,
    change_count:4,
    duplicate_resolution_count:0,
    owner_confirmed_count:4,
    management_data_count:1,
    top_changes:[]
  }, {
    businessKey:'north-star-beans',
    auditPeriodLabel:'2026年9月20日〜2026年9月27日',
    metricType:'revenue',
    answerMode:'change_count'
  });

  assert.equal(
    answer,
    'NORTH STAR BEANSの変更操作は4回です。（2026年9月20日〜2026年9月27日、売上）'
  );
});

test('Phase 6.52 can answer registration and duplicate-resolution counts directly', () => {
  const summary = {
    total_count:14,
    registration_count:8,
    change_count:4,
    duplicate_resolution_count:2,
    owner_confirmed_count:14,
    management_data_count:8,
    top_changes:[]
  };
  assert.equal(
    managementDataAuditSummaryAnswer(summary, {
      businessKey:'north-star-beans',
      answerMode:'registration_count'
    }),
    'NORTH STAR BEANSの登録は8件です。'
  );
  assert.equal(
    managementDataAuditSummaryAnswer(summary, {
      businessKey:'north-star-beans',
      answerMode:'duplicate_resolution_count'
    }),
    'NORTH STAR BEANSの重複整理は2件です。'
  );
});


test('Phase 6.52 supports direct count questions without requiring prior audit context', () => {
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSの変更は何回？', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null, answerMode:'change_count' }
  );
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSの登録は何件？', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null, answerMode:'registration_count' }
  );
  assert.deepEqual(
    detectManagementDataAuditSummaryQuery('NORTH STAR BEANSの重複整理は何件？', []),
    { businessKey:'north-star-beans', dataDate:null, metricType:null, answerMode:'duplicate_resolution_count' }
  );
});


test('Phase 6.53 detects an explicit management-ID history request', () => {
  assert.equal(managementDataIdFromText('その管理ID8の変更履歴を見せて'), '8');
  assert.deepEqual(
    detectManagementDataIdHistoryQuery('その管理ID8の変更履歴を見せて', []),
    { managementDataId:'8', includeDetails:false }
  );
});

test('Phase 6.53 accepts full-width management IDs', () => {
  assert.equal(managementDataIdFromText('管理ID８の履歴を詳しく'), '8');
  assert.deepEqual(
    detectManagementDataIdHistoryQuery('管理ID８の履歴を詳しく', []),
    { managementDataId:'8', includeDetails:true }
  );
});

test('Phase 6.53 inherits one unambiguous management ID from the latest assistant answer', () => {
  const history = [
    { role:'user', content:'変更が一番多いデータはどれ？' },
    { role:'assistant', content:'変更回数が最も多いのは、2026/08/15 売上（管理ID 8）で4回です。最終変更は2026/09/26 23:44です。' }
  ];
  assert.equal(recentUnambiguousManagementDataId(history), '8');
  assert.deepEqual(
    detectManagementDataIdHistoryQuery('その変更の前後の値を詳しく教えて', history),
    { managementDataId:'8', includeDetails:true }
  );
});

test('Phase 6.53 does not guess a management ID from an answer containing multiple IDs', () => {
  const history = [
    { role:'assistant', content:'管理ID 7を残し、管理ID 4を重複扱いにしました。' }
  ];
  assert.equal(recentUnambiguousManagementDataId(history), null);
  assert.equal(
    detectManagementDataIdHistoryQuery('その変更の前後の値を詳しく教えて', history),
    null
  );
});

test('Phase 6.53 does not turn a write-oriented management-ID instruction into a history lookup', () => {
  assert.equal(
    detectManagementDataIdHistoryQuery('管理ID8を残して重複整理して', []),
    null
  );
});

test('Phase 6.53 formats one management ID history chronologically with current value', () => {
  const answer = managementDataIdHistoryAnswer([
    {
      management_data_id:'8',
      business_key:'north-star-beans',
      data_date:'2026-08-15',
      metric_type:'revenue',
      previous_amount:125000,
      new_amount:126000,
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-26T12:39:00.000Z',
      change_note:'2026年8月15日のNORTH STAR BEANSの売上は126000円です'
    },
    {
      management_data_id:'8',
      business_key:'north-star-beans',
      data_date:'2026-08-15',
      metric_type:'revenue',
      previous_amount:126000,
      new_amount:125000,
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-26T14:44:00.000Z',
      change_note:'2026年8月15日のNORTH STAR BEANSの売上を最初の値に戻して'
    }
  ], {
    id:'8',
    business_key:'north-star-beans',
    data_date:'2026-08-15',
    metric_type:'revenue',
    amount:125000,
    currency:'JPY',
    superseded_by_management_data_id:null
  }, {
    managementDataId:'8',
    includeDetails:false
  });

  assert.match(answer, /管理ID 8（2026\/08\/15 NORTH STAR BEANS 売上）の変更履歴は2件/);
  assert.match(answer, /125,000円 → 126,000円/);
  assert.match(answer, /126,000円 → 125,000円/);
  assert.match(answer, /現在の登録値は125,000円/);
});

test('Phase 6.53 detailed management-ID history includes recorded reason and original input', () => {
  const answer = managementDataIdHistoryAnswer([
    {
      management_data_id:'8',
      business_key:'north-star-beans',
      data_date:'2026-08-15',
      metric_type:'revenue',
      previous_amount:125000,
      new_amount:126000,
      previous_currency:'JPY',
      new_currency:'JPY',
      changed_at:'2026-09-26T12:39:00.000Z',
      change_note:'2026年8月15日のNORTH STAR BEANSの売上は126000円です'
    }
  ], {
    id:'8',
    business_key:'north-star-beans',
    data_date:'2026-08-15',
    metric_type:'revenue',
    amount:126000,
    currency:'JPY'
  }, {
    managementDataId:'8',
    includeDetails:true
  });

  assert.match(answer, /変更理由：/);
  assert.match(answer, /確認時の入力文：「2026年8月15日のNORTH STAR BEANSの売上は126000円です」/);
});

test('Phase 6.53 reports superseded status instead of pretending a duplicate row is current', () => {
  const answer = managementDataIdHistoryAnswer([], {
    id:'4',
    business_key:'north-star-beans',
    data_date:'2026-09-22',
    metric_type:'revenue',
    amount:160000,
    currency:'JPY',
    superseded_by_management_data_id:'7'
  }, {
    managementDataId:'4',
    includeDetails:false
  });

  assert.match(answer, /保存されている変更履歴はありません/);
  assert.match(answer, /現在は管理ID 7へ重複整理済み/);
});


test('Phase 6.55 formats a history point restore as a readable reason and source history ID', () => {
  const row = {
    management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue',
    previous_amount:125000, new_amount:126000, previous_currency:'JPY', new_currency:'JPY',
    source:'owner confirmed history point restore',
    change_note:'owner confirmed history point restore\nsource history id: 1',
    changed_at:'2026-09-28T00:59:00.000Z'
  };
  const answer = managementDataIdHistoryAnswer([row], {
    id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', amount:126000, currency:'JPY'
  }, { managementDataId:'8', includeDetails:true });
  assert.match(answer, /変更理由：変更履歴から指定した過去時点の値へ復元しました。/);
  assert.match(answer, /復元元の変更履歴ID：1/);
  assert.doesNotMatch(answer, /確認時の入力文：「owner confirmed history point restore/);
  assert.doesNotMatch(answer, /変更理由は個別には記録されていません/);
});

test('Phase 6.55 keeps existing history restore, correction, and ordinary input audit displays', () => {
  const rows = [
    { management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', previous_amount:120000, new_amount:125000, previous_currency:'JPY', new_currency:'JPY', source:'owner confirmed history restore', change_note:'最初の値に戻して', changed_at:'2026-09-26T00:00:00.000Z' },
    { management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', previous_amount:125000, new_amount:126000, previous_currency:'JPY', new_currency:'JPY', source:'owner confirmed correction', change_note:'売上を126000円に訂正', changed_at:'2026-09-26T00:01:00.000Z' }
  ];
  const answer = managementDataIdHistoryAnswer(rows, null, { managementDataId:'8', includeDetails:true });
  assert.match(answer, /変更履歴から最初の値へ復元/);
  assert.match(answer, /確認時の入力文：「最初の値に戻して」/);
  assert.match(answer, /オーナー確認による訂正/);
  assert.match(answer, /確認時の入力文：「売上を126000円に訂正」/);
});


function phase656Rows() {
  return [
    { id:'1', management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', previous_amount:124000, new_amount:125000, previous_currency:'JPY', new_currency:'JPY', source:'owner confirmed correction', change_note:'1回目', changed_at:'2026-09-26T00:00:00.000Z', confirmed_by_owner:true },
    { id:'2', management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', previous_amount:125000, new_amount:126000, previous_currency:'JPY', new_currency:'JPY', source:'owner confirmed correction', change_note:'2回目', changed_at:'2026-09-26T00:01:00.000Z', confirmed_by_owner:true },
    { id:'3', management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', previous_amount:126000, new_amount:125000, previous_currency:'JPY', new_currency:'JPY', source:'owner confirmed correction', change_note:'3回目', changed_at:'2026-09-26T00:02:00.000Z', confirmed_by_owner:true },
    { id:'5', management_data_id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', previous_amount:125000, new_amount:126000, previous_currency:'JPY', new_currency:'JPY', source:'owner confirmed history point restore', change_note:'owner confirmed history point restore\nsource history id: 1', changed_at:'2026-09-28T00:59:00.000Z', confirmed_by_owner:true }
  ];
}
function phase656Current() {
  return { id:'8', business_key:'north-star-beans', data_date:'2026-08-15', metric_type:'revenue', amount:126000, currency:'JPY' };
}
test('Phase 6.56 detects first, last, and ordinal single-history read-only requests', () => {
  assert.deepEqual(detectManagementDataIdHistoryQuery('管理ID8の最初の変更だけ見せて'), { managementDataId:'8', includeDetails:false, selection:{ type:'first' } });
  assert.deepEqual(detectManagementDataIdHistoryQuery('管理ID8の最後の変更だけ詳しく教えて'), { managementDataId:'8', includeDetails:true, selection:{ type:'last' } });
  for (const phrase of ['2回目', '2件目', '2番目']) assert.deepEqual(detectManagementDataIdHistoryQuery(`管理ID8の${phrase}の変更を詳しく`), { managementDataId:'8', includeDetails:true, selection:{ type:'index', index:2 } });
  for (const phrase of ['３回目', '３件目', '３番目']) assert.deepEqual(detectManagementDataIdHistoryQuery(`管理ID8の${phrase}の変更を詳しく`), { managementDataId:'8', includeDetails:true, selection:{ type:'index', index:3 } });
});
test('Phase 6.56 shows only the selected original ordinal and keeps Phase 6.55 details', () => {
  const answer = managementDataIdHistoryAnswer(phase656Rows(), phase656Current(), { managementDataId:'8', includeDetails:true, selection:{ type:'last' } });
  assert.match(answer, /管理ID 8（2026\/08\/15 NORTH STAR BEANS 売上）の4回目の変更です。/);
  assert.match(answer, /4\. 2026\/09\/28 09:59：125,000円 → 126,000円/);
  assert.match(answer, /変更履歴から指定した過去時点の値へ復元しました。/);
  assert.match(answer, /復元元の変更履歴ID：1/);
  assert.doesNotMatch(answer, /1\. 2026\/09\/26/);
  assert.doesNotMatch(answer, /確認時の入力文：「owner confirmed history point restore/);
});
test('Phase 6.56 reports an absent ordinal without selecting another history row', () => {
  const answer = managementDataIdHistoryAnswer(phase656Rows(), phase656Current(), { managementDataId:'8', includeDetails:true, selection:{ type:'index', index:7 } });
  assert.equal(answer, '管理ID 8の変更履歴は4件なので、7回目の変更はありません。');
});
test('Phase 6.56 safely inherits one recent ID and never intercepts a history restore request', () => {
  const history = [{ role:'assistant', content:'管理ID 8（2026/08/15 NORTH STAR BEANS 売上）の変更履歴は4件です。' }];
  assert.deepEqual(detectManagementDataIdHistoryQuery('その2回目の変更を詳しく教えて', history), { managementDataId:'8', includeDetails:true, selection:{ type:'index', index:2 } });
  assert.equal(detectManagementDataIdHistoryQuery('2番目の変更後の値に戻して', history), null);
  assert.equal(detectManagementDataIdHistoryQuery('その最後の変更だけ見せて', [{ role:'assistant', content:'管理ID 7と管理ID 8の履歴です。' }]), null);
});