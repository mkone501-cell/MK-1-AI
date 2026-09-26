'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectManagementDataHistoryQuery,
  detectManagementDataHistoryFollowUp,
  isInitialManagementDataRestorePhrase,
  detectManagementDataRestoreRequest,
  detectManagementDataCurrentStateQuery,
  managementDataCurrentStateAnswer,
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
  assert.match(captured.sql, /WHERE owner_email = \$1/);
  assert.match(captured.sql, /data_date = \$2::date/);
  assert.match(captured.sql, /metric_type = \$3/);
  assert.match(captured.sql, /business_key = \$4/);
  assert.match(captured.sql, /ORDER BY changed_at ASC, id ASC/);
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
