'use strict';

function parseBusinessAndDate(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  let dataDate = null;
  const jp = text.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const iso = text.match(/(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
  const match = jp || iso;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      dataDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return { businessKey, dataDate };
}

function validIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseBusinessAndDates(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  const found = [];
  let inheritedYear = null;
  const jp = /(?:(20\d{2})年\s*)?(\d{1,2})月\s*(\d{1,2})日/g;
  for (const match of text.matchAll(jp)) {
    const year = match[1] ? Number(match[1]) : inheritedYear;
    if (match[1]) inheritedYear = Number(match[1]);
    if (!year) continue;
    const value = validIsoDate(year, Number(match[2]), Number(match[3]));
    if (value) found.push({ index:match.index, value });
  }
  const iso = /(20\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/g;
  for (const match of text.matchAll(iso)) {
    const value = validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (value) found.push({ index:match.index, value });
  }
  found.sort((a, b) => a.index - b.index);
  return { businessKey, dataDates:[...new Set(found.map(item => item.value))] };
}

function monthRange(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    startDate:validIsoDate(year, month, 1),
    endDate:validIsoDate(year, month, lastDay),
    label:`${year}年${month}月`
  };
}

function parseBusinessAndMonths(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  if (!businessKey) return { businessKey:null, months:[] };
  const found = [];
  let inheritedYear = null;
  const jp = /(?:(20\d{2})年\s*)?(\d{1,2})月(?!\s*\d{1,2}日)/g;
  for (const match of text.matchAll(jp)) {
    const year = match[1] ? Number(match[1]) : inheritedYear;
    if (match[1]) inheritedYear = Number(match[1]);
    if (!year) continue;
    const range = monthRange(year, Number(match[2]));
    if (range) found.push({ index:match.index, ...range });
  }
  const iso = /(20\d{2})[-\/]([01]?\d)(?![-\/]\d)/g;
  for (const match of text.matchAll(iso)) {
    const range = monthRange(Number(match[1]), Number(match[2]));
    if (range) found.push({ index:match.index, ...range });
  }
  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  const months = [];
  for (const item of found) {
    const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push({ year:item.year, month:item.month, startDate:item.startDate, endDate:item.endDate, label:item.label });
  }
  return { businessKey, months };
}

function enumerateMonthRanges(first, last, maxMonths = 12) {
  if (!first || !last) return [];
  const startIndex = first.year * 12 + first.month - 1;
  const endIndex = last.year * 12 + last.month - 1;
  if (endIndex < startIndex) return [];
  const count = endIndex - startIndex + 1;
  if (count < 1 || count > maxMonths) return [];
  const result = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const year = Math.floor(index / 12);
    const month = index % 12 + 1;
    const range = monthRange(year, month);
    if (range) result.push(range);
  }
  return result;
}

function parseBusinessAndYears(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  if (!businessKey) return { businessKey:null, years:[] };
  const years = [];
  const seen = new Set();
  const re = /(20\d{2})年(?!\s*\d{1,2}月)/g;
  for (const match of text.matchAll(re)) {
    const year = Number(match[1]);
    if (seen.has(year)) continue;
    seen.add(year);
    years.push({
      year,
      startDate:validIsoDate(year, 1, 1),
      endDate:validIsoDate(year, 12, 31),
      label:`${year}年`
    });
  }
  return { businessKey, years };
}

function enumerateYearRanges(first, last, maxYears = 5) {
  if (!first || !last || !Number.isInteger(first.year) || !Number.isInteger(last.year)) return [];
  if (last.year < first.year) return [];
  const count = last.year - first.year + 1;
  if (count < 1 || count > maxYears) return [];
  const years = [];
  for (let year = first.year; year <= last.year; year += 1) {
    years.push({
      year,
      startDate:validIsoDate(year, 1, 1),
      endDate:validIsoDate(year, 12, 31),
      label:`${year}年`
    });
  }
  return years;
}

function parseBusinessAndYearMonths(text) {
  const businessKey = /NORTH\s*STAR\s*BEANS/i.test(text) ? 'north-star-beans' : null;
  if (!businessKey) return null;
  const match = text.match(/(20\d{2})年(?!\s*\d{1,2}月)/);
  if (!match) return null;
  const year = Number(match[1]);
  const months = enumerateMonthRanges({ year, month:1 }, { year, month:12 }, 12);
  if (months.length !== 12) return null;
  return { businessKey, year, months };
}

function parseBusinessAndMonthRange(text) {
  const { businessKey, months } = parseBusinessAndMonths(text);
  if (!businessKey || !months.length) return null;
  const first = months[0];
  return { businessKey, startDate:first.startDate, endDate:first.endDate };
}

function detectManagementAnalysisFocus(text) {
  const value = String(text || '');
  if (/収益性|採算|粗利|利益|営業利益|経費|費用/.test(value)) return 'profit';
  if (/来客数|客数|来店客数|客単価|平均客単価/.test(value)) return 'traffic';
  if (/現金残高|資金|キャッシュ/.test(value)) return 'cash';
  if (/売上/.test(value)) return 'sales';
  return null;
}

function detectManagementDataHistoryQuery(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const includeActor = /誰が|変更者|更新者|訂正者|修正者|だれが/.test(text);
  const includeReason = /なぜ|どうして|理由|経緯|原因/.test(text);
  const includeSourceText = /元の入力|入力文|入力内容|根拠|情報源|ソース|詳しく|詳細/.test(text);
  const historyRequested = /(?:変更履歴|更新履歴|訂正履歴|修正履歴|何円から何円|いつ[^。！？\n]{0,30}(?:変更|更新|訂正)|(?:変更|更新|訂正)[^。！？\n]{0,30}いつ)/.test(text)
    || ((includeActor || includeReason || includeSourceText) && /変更|更新|訂正|修正/.test(text));
  if (!historyRequested) return null;
  const { businessKey, dataDate } = parseBusinessAndDate(text);
  const metricType = /客単価|平均客単価/.test(text)
    ? 'average_spend'
    : /来客数|客数|来店客数/.test(text)
      ? 'customers'
      : /経費|費用/.test(text)
        ? 'expense'
        : /利益|営業利益/.test(text)
          ? 'profit'
          : /現金残高|預金残高/.test(text)
            ? 'cash_balance'
            : /売上/.test(text)
              ? 'revenue'
              : null;
  if (!dataDate || !metricType) return null;
  return { businessKey, dataDate, metricType, includeActor, includeReason, includeSourceText };
}

function detectManagementDataHistoryFollowUp(message, history = []) {
  const text = String(message || '').trim();
  if (!text) return null;

  const includeActor = /誰が|変更者|更新者|訂正者|修正者|だれが/.test(text);
  const includeReason = /なぜ|どうして|理由|経緯|原因/.test(text);
  const includeSourceText = /元の入力|入力文|入力内容|何と入力|何て入力|なにと入力|なんて入力|実際に[^。！？\n]{0,20}入力|どんな入力|根拠|情報源|ソース/.test(text);
  const detailRequested = includeActor || includeReason || includeSourceText;
  if (!detailRequested) return null;

  // Phase 6.41 only resolves clearly contextual follow-ups. It never guesses a date/metric
  // when the user starts a new, unrelated question.
  const contextualReference = /その(?:とき|時|変更|更新|訂正|修正|履歴)|この(?:変更|更新|訂正|修正|履歴)|さっき|先ほど|今の|それ|あの(?:変更|更新|訂正|修正)/.test(text);
  if (!contextualReference) return null;

  const turns = Array.isArray(history) ? history : [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (!turn || turn.role !== 'user') continue;
    const previous = detectManagementDataHistoryQuery(turn.content);
    if (!previous) continue;
    return {
      ...previous,
      includeActor,
      includeReason,
      includeSourceText
    };
  }
  return null;
}

function isInitialManagementDataRestorePhrase(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const initial = '(?:一番最初|最初|当初|初回)';
  const value = '(?:の)?(?:登録(?:されていた)?(?:値|数値|金額)?|値|数値|金額)?';
  const restore = '(?:に)?(?:戻して|戻す|復元して|復元する)';
  return new RegExp(initial + '[^。！？\\n]{0,24}' + value + '[^。！？\\n]{0,12}' + restore).test(text)
    || new RegExp('(?:戻して|戻す|復元して|復元する)[^。！？\\n]{0,24}' + initial).test(text);
}

function managementHistoryMetricType(text) {
  const value = String(text || '');
  return /客単価|平均客単価/.test(value)
    ? 'average_spend'
    : /来客数|客数|来店客数/.test(value)
      ? 'customers'
      : /経費|費用/.test(value)
        ? 'expense'
        : /利益|営業利益/.test(value)
          ? 'profit'
          : /現金残高|預金残高/.test(value)
            ? 'cash_balance'
            : /売上/.test(value)
              ? 'revenue'
              : null;
}

function detectManagementDataRestoreRequest(message, history = []) {
  const text = String(message || '').trim();
  if (!isInitialManagementDataRestorePhrase(text)) return null;

  const { businessKey, dataDate } = parseBusinessAndDate(text);
  const metricType = managementHistoryMetricType(text);
  if (dataDate && metricType) {
    return { businessKey, dataDate, metricType, restoreTarget:'initial' };
  }

  // A write request without its own date/metric may only inherit from the very recent
  // audit-history conversation. Older unrelated context is deliberately ignored.
  const turns = Array.isArray(history) ? history.slice(-4) : [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (!turn || turn.role !== 'user') continue;
    const previous = detectManagementDataHistoryQuery(turn.content);
    if (!previous) continue;
    return {
      businessKey:previous.businessKey,
      dataDate:previous.dataDate,
      metricType:previous.metricType,
      restoreTarget:'initial'
    };
  }
  return null;
}

function managementTargetFromExplicitMessage(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const direct = parseBusinessAndDate(text);
  const directMetricType = managementHistoryMetricType(text);
  if (direct.dataDate && directMetricType) {
    return { businessKey:direct.businessKey, dataDate:direct.dataDate, metricType:directMetricType };
  }

  const historyQuery = detectManagementDataHistoryQuery(text);
  if (historyQuery) {
    return { businessKey:historyQuery.businessKey, dataDate:historyQuery.dataDate, metricType:historyQuery.metricType };
  }

  if (isInitialManagementDataRestorePhrase(text)) {
    const restoreQuery = detectManagementDataRestoreRequest(text, []);
    if (restoreQuery) {
      return { businessKey:restoreQuery.businessKey, dataDate:restoreQuery.dataDate, metricType:restoreQuery.metricType };
    }
  }

  const query = detectManagementDataQuery(text);
  const exactMetricTypes = new Set(['revenue','expense','profit','cash_balance','customers','average_spend']);
  if (query?.dataDate && exactMetricTypes.has(query.metricType)) {
    return { businessKey:query.businessKey, dataDate:query.dataDate, metricType:query.metricType };
  }
  return null;
}

function detectManagementDataCurrentStateQuery(message, history = []) {
  const text = String(message || '').trim();
  if (!text) return null;

  const includeLastChangedAt = /(?:最後|直近|最新)(?:に)?[^。！？\n]{0,24}(?:いつ)[^。！？\n]{0,24}(?:変更|更新|訂正|修正|復元)/.test(text)
    || /(?:最後|直近|最新)(?:に)?[^。！？\n]{0,24}(?:変更|更新|訂正|修正|復元)[^。！？\n]{0,24}(?:いつ)/.test(text);
  const includeCurrentValue = /(?:今|現在|最新)(?:の)?(?:登録(?:値|数値|金額)?|値|数値|金額|売上|来客数|客数|来店客数|客単価|平均客単価|経費|費用|利益|営業利益|現金残高|預金残高)[^。！？\n]{0,24}(?:いくら|何円|何人|いくつ|どのくらい|教えて|[？?]$)/.test(text);

  if (!includeCurrentValue && !includeLastChangedAt) return null;

  const direct = managementTargetFromExplicitMessage(text);
  const recentTurns = Array.isArray(history) ? history.slice(-4) : [];
  let contextualTarget = null;
  for (let index = recentTurns.length - 1; index >= 0; index--) {
    const turn = recentTurns[index];
    if (!turn || turn.role !== 'user') continue;
    const target = managementTargetFromExplicitMessage(turn.content);
    if (!target) continue;
    contextualTarget = target;
    break;
  }

  let target = direct || contextualTarget;
  if (direct && contextualTarget &&
      direct.dataDate === contextualTarget.dataDate &&
      direct.metricType === contextualTarget.metricType &&
      !direct.businessKey && contextualTarget.businessKey) {
    target = { ...direct, businessKey:contextualTarget.businessKey };
  }
  if (!target?.dataDate || !target?.metricType) return null;

  return {
    businessKey:target.businessKey || null,
    dataDate:target.dataDate,
    metricType:target.metricType,
    includeCurrentValue,
    includeLastChangedAt
  };
}

function detectManagementDataHistoryConsistencyQuery(message, history = []) {
  const text = String(message || '').trim();
  if (!text) return null;

  const asksHistoryConsistency = /(?:変更履歴|更新履歴|訂正履歴|監査履歴|履歴)[^。！？\n]{0,28}(?:一致|整合|食い違|ずれ|ズレ|矛盾|合って|正しい)/.test(text)
    || /(?:一致|整合|食い違|ずれ|ズレ|矛盾|合って|正しい)[^。！？\n]{0,28}(?:変更履歴|更新履歴|訂正履歴|監査履歴|履歴)/.test(text);
  if (!asksHistoryConsistency) return null;

  const direct = managementTargetFromExplicitMessage(text);
  // Consistency checks are read-only, so a slightly wider window is safe and
  // lets follow-ups work after "今の売上" and "最後にいつ変更した" have already
  // consumed a few turns. We still require a concrete dated management target.
  const recentTurns = Array.isArray(history) ? history.slice(-8) : [];
  let contextualTarget = null;
  for (let index = recentTurns.length - 1; index >= 0; index--) {
    const turn = recentTurns[index];
    if (!turn || turn.role !== 'user') continue;
    const target = managementTargetFromExplicitMessage(turn.content);
    if (!target) continue;
    contextualTarget = target;
    break;
  }

  let target = direct || contextualTarget;
  if (direct && contextualTarget &&
      direct.dataDate === contextualTarget.dataDate &&
      direct.metricType === contextualTarget.metricType &&
      !direct.businessKey && contextualTarget.businessKey) {
    target = { ...direct, businessKey:contextualTarget.businessKey };
  }
  if (!target?.dataDate || !target?.metricType) return null;

  return {
    businessKey:target.businessKey || null,
    dataDate:target.dataDate,
    metricType:target.metricType
  };
}

function managementDataHistoryConsistencyAnswer(currentEntry, historyEntries, query = {}) {
  const rows = (Array.isArray(historyEntries) ? historyEntries : []).filter(Boolean);
  const businessKeys = [...new Set(rows.map(row => String(row.business_key || '').trim()).filter(Boolean))];
  const businessKey = query.businessKey || currentEntry?.business_key || (businessKeys.length === 1 ? businessKeys[0] : null);
  const businessName = businessKey === 'north-star-beans' ? 'NORTH STAR BEANS' : businessKey || '対象事業';
  const metricNames = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const metricName = metricNames[query.metricType] || query.metricType || '経営数値';
  const dateLabel = String(query.dataDate || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${Number(y)}年${Number(m)}月${Number(d)}日`);
  const subject = `${dateLabel}の${businessName}の${metricName}`;

  if (!currentEntry && !rows.length) {
    return `${subject}は、現在の本人確認済み登録値も変更履歴もないため、整合性を確認できません。`;
  }

  if (!currentEntry) {
    const latest = rows.at(-1);
    const latestValue = formatManagementHistoryValue(latest?.new_amount, latest?.new_currency) || '不明';
    return `${subject}は履歴と一致していません。変更履歴の最新値は${latestValue}ですが、現在の本人確認済み登録値がありません。自動修正はしていません。`;
  }

  const currentValue = formatManagementHistoryValue(currentEntry.amount, currentEntry.currency) || '不明';
  if (!rows.length) {
    return `${subject}の現在値は${currentValue}ですが、変更履歴がないため履歴との一致は判定できません。`;
  }

  const latest = rows.at(-1);
  const latestValue = formatManagementHistoryValue(latest.new_amount, latest.new_currency) || '不明';
  const sameLatestValue = Number(currentEntry.amount) === Number(latest.new_amount)
    && String(currentEntry.currency || '').trim().toUpperCase() === String(latest.new_currency || '').trim().toUpperCase();
  const sameEntity = String(currentEntry.id ?? '') === String(latest.management_data_id ?? '');

  const chainIssues = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (String(row.management_data_id ?? '') !== String(currentEntry.id ?? '')) {
      chainIssues.push(`履歴${index + 1}件目が現在の登録行とは異なる管理IDを参照しています`);
    }
    if (index === 0) continue;
    const previous = rows[index - 1];
    const amountContinues = Number(previous.new_amount) === Number(row.previous_amount);
    const currencyContinues = String(previous.new_currency || '').trim().toUpperCase() === String(row.previous_currency || '').trim().toUpperCase();
    if (!amountContinues || !currencyContinues) {
      chainIssues.push(`履歴${index}件目から${index + 1}件目の値が連続していません`);
    }
  }

  if (sameLatestValue && sameEntity && !chainIssues.length) {
    return `${subject}は履歴と一致しています。現在値${currentValue}と、最新履歴の変更後の値${latestValue}が一致し、履歴${rows.length}件のつながりにも不整合はありません。`;
  }

  const issues = [];
  if (!sameLatestValue) issues.push(`現在値${currentValue}と最新履歴の変更後の値${latestValue}が一致していません`);
  if (!sameEntity) issues.push('最新履歴が現在の登録行とは異なる管理IDを参照しています');
  issues.push(...chainIssues.filter((item, index, list) => list.indexOf(item) === index));

  return `${subject}には履歴との不整合があります。\n- ${issues.join('\n- ')}\n自動修正はしていません。`;
}

function managementDataCurrentStateAnswer(currentEntry, historyEntries, query = {}) {
  const rows = (Array.isArray(historyEntries) ? historyEntries : []).filter(Boolean);
  const businessKeys = [...new Set(rows.map(row => String(row.business_key || '').trim()).filter(Boolean))];
  const businessKey = query.businessKey || currentEntry?.business_key || (businessKeys.length === 1 ? businessKeys[0] : null);
  const businessName = businessKey === 'north-star-beans' ? 'NORTH STAR BEANS' : businessKey || '対象事業';
  const metricNames = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const metricName = metricNames[query.metricType] || query.metricType || '経営数値';
  const dateLabel = String(query.dataDate || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${Number(y)}年${Number(m)}月${Number(d)}日`);
  const lines = [];

  if (query.includeCurrentValue) {
    const currentValue = currentEntry ? formatManagementHistoryValue(currentEntry.amount, currentEntry.currency) : null;
    lines.push(currentValue
      ? `${dateLabel}の${businessName}の現在の登録${metricName}は${currentValue}です。`
      : `${dateLabel}の${businessName}の${metricName}には、現在の本人確認済み登録値がありません。`);
  }

  if (query.includeLastChangedAt) {
    const latest = rows.at(-1) || null;
    if (!latest) {
      lines.push(`${dateLabel}の${businessName}の${metricName}には、保存されている変更履歴がありません。`);
    } else {
      const changedAt = formatManagementHistoryChangedAt(latest.changed_at);
      const before = formatManagementHistoryValue(latest.previous_amount, latest.previous_currency);
      const after = formatManagementHistoryValue(latest.new_amount, latest.new_currency);
      const change = before && after ? `（${before} → ${after}）` : '';
      lines.push(changedAt
        ? `最後の変更は${changedAt}です${change}。`
        : `最後の変更日時は記録から確認できません${change}。`);
    }
  }

  return lines.join('\n');
}

function formatManagementHistoryValue(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
  const unit = currency === 'JPY' ? '円' : currency === 'COUNT' ? '人' : currency ? ` ${currency}` : '';
  return `${rounded.toLocaleString('ja-JP')}${unit}`;
}

function formatManagementHistoryChangedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone:'Asia/Tokyo',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}`;
}

function managementHistoryActor(row) {
  if (row?.confirmed_by_owner === true) return 'オーナー本人（確認操作済み）';
  return '変更者を確認できません';
}

function managementHistoryReason(row) {
  const source = String(row?.source || '').trim();
  if (source === 'owner confirmed correction') {
    return '記録上は「オーナー確認による訂正」です。具体的な訂正理由は記録されていません。';
  }
  if (source === 'owner confirmed history restore') {
    return '記録上は「変更履歴から最初の値へ復元」です。復元の指示内容は確認時の入力文に記録されています。';
  }
  if (source === 'owner confirmed conversation') {
    return 'オーナーが会話内容を確認して保存しました。';
  }
  return '変更理由は個別には記録されていません。';
}

function managementHistoryOriginalInput(row) {
  const note = String(row?.change_note || '').trim();
  return note || null;
}

function managementDataHistoryAnswer(entries, currentEntry, query = {}) {
  const rows = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const businessKeys = [...new Set(rows.map(row => String(row.business_key || '').trim()).filter(Boolean))];
  const businessKey = query.businessKey || currentEntry?.business_key || (businessKeys.length === 1 ? businessKeys[0] : null);
  if (!query.businessKey && businessKeys.length > 1) {
    return '同じ日・同じ項目に複数事業の変更履歴があります。事業名を指定して聞いてください。';
  }
  const businessName = businessKey === 'north-star-beans' ? 'NORTH STAR BEANS' : businessKey || '対象事業';
  const metricNames = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const metricName = metricNames[query.metricType] || query.metricType || '経営数値';
  const dateLabel = String(query.dataDate || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${Number(y)}年${Number(m)}月${Number(d)}日`);
  const currentValue = currentEntry ? formatManagementHistoryValue(currentEntry.amount, currentEntry.currency) : null;

  if (!rows.length) {
    const currentText = currentValue ? ` 現在の登録値は${currentValue}です。` : '';
    return `${dateLabel || '指定日'}の${businessName}の${metricName}には、保存されている変更履歴はありません。${currentText}`.trim();
  }

  const includeDetails = Boolean(query.includeActor || query.includeReason || query.includeSourceText);
  const lines = rows.map((row, index) => {
    const before = formatManagementHistoryValue(row.previous_amount, row.previous_currency) || '不明';
    const after = formatManagementHistoryValue(row.new_amount, row.new_currency) || '不明';
    const changedAt = formatManagementHistoryChangedAt(row.changed_at);
    const base = `${index + 1}. ${changedAt ? `${changedAt}：` : ''}${before} → ${after}`;
    if (!includeDetails) return base;
    const details = [];
    if (query.includeActor) details.push(`変更者：${managementHistoryActor(row)}`);
    if (query.includeReason) details.push(`変更理由：${managementHistoryReason(row)}`);
    if (query.includeSourceText) {
      const originalInput = managementHistoryOriginalInput(row);
      details.push(originalInput ? `確認時の入力文：「${originalInput}」` : '確認時の入力文：記録されていません');
    }
    return `${base}\n   ${details.join('\n   ')}`;
  });
  const currentText = currentValue
    ? `\n現在の登録値は${currentValue}です。`
    : `\n現在値は変更履歴だけでは確定できません。`;
  return `${dateLabel || '指定日'}の${businessName}の${metricName}の変更履歴は${rows.length}件です。\n${lines.join('\n')}${currentText}`;
}

function detectManagementDataQuery(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const { businessKey, dataDates } = parseBusinessAndDates(text);
  const dataDate = dataDates[0] || null;
  const rangeRequested = /(?:から.*まで|[〜～~]|期間|推移|傾向|トレンド)/.test(text);
  if (businessKey && rangeRequested && dataDates.length >= 2) {
    const [startDate, endDate] = dataDates.slice(0, 2);
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    const days = Math.floor((end - start) / 86400000) + 1;
    if (days >= 1 && days <= 31) {
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey, metricType:'period_analysis', startDate, endDate, ...(analysisFocus ? { analysisFocus } : {}) };
    }
    return null;
  }
  const comparisonRequested = /比較|比べ|違い|差(?:は|を|が)?/.test(text);
  if (businessKey && comparisonRequested && dataDates.length >= 2) {
    return { businessKey, metricType:'daily_comparison', dataDates:dataDates.slice(0, 2) };
  }
  if (!dataDates.length) {
    const monthParse = parseBusinessAndMonths(text);
    if (comparisonRequested && monthParse.months.length >= 2) {
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey:monthParse.businessKey, metricType:'monthly_comparison', months:monthParse.months.slice(0, 2), ...(analysisFocus ? { analysisFocus } : {}) };
    }
    if (rangeRequested && monthParse.months.length >= 2) {
      const months = enumerateMonthRanges(monthParse.months[0], monthParse.months[1], 12);
      if (!months.length) return null;
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey:monthParse.businessKey, metricType:'monthly_period_analysis', months, ...(analysisFocus ? { analysisFocus } : {}) };
    }
    const monthRange = monthParse.months[0] ? {
      businessKey:monthParse.businessKey,
      startDate:monthParse.months[0].startDate,
      endDate:monthParse.months[0].endDate
    } : null;
    const monthRequested = /月次|月間|経営状況|経営数値|売上|来客数|客単価|経費|利益|分析|まとめ|推移|傾向/.test(text);
    if (monthRange && monthRequested) {
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey:monthRange.businessKey, metricType:'period_analysis', startDate:monthRange.startDate, endDate:monthRange.endDate, ...(analysisFocus ? { analysisFocus } : {}) };
    }
    const yearCompare = parseBusinessAndYears(text);
    if (comparisonRequested && yearCompare.years.length >= 2) {
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey:yearCompare.businessKey, metricType:'annual_comparison', years:yearCompare.years.slice(0, 2), ...(analysisFocus ? { analysisFocus } : {}) };
    }
    if (rangeRequested && yearCompare.years.length >= 2) {
      const years = enumerateYearRanges(yearCompare.years[0], yearCompare.years[1], 5);
      if (!years.length) return null;
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey:yearCompare.businessKey, metricType:'annual_period_analysis', years, ...(analysisFocus ? { analysisFocus } : {}) };
    }
    const yearParse = parseBusinessAndYearMonths(text);
    const yearRequested = /年間|年次|経営状況|経営数値|売上|来客数|客単価|経費|利益|分析|まとめ|推移|傾向/.test(text);
    if (yearParse && yearRequested) {
      const analysisFocus = detectManagementAnalysisFocus(text);
      return { businessKey:yearParse.businessKey, metricType:'monthly_period_analysis', months:yearParse.months, ...(analysisFocus ? { analysisFocus } : {}) };
    }
  }
  const analysisRequested = /分析|評価|考察|どう(?:だった|でした)|良かった|悪かった/.test(text);
  const summaryRequested = /経営状況|経営数値|日次(?:の)?(?:状況|実績|まとめ)|まとめて/.test(text);
  const focusedMetricRequested = /売上|来客数|客数|来店客数|客単価|平均客単価|経費|費用|利益|営業利益|収益性|採算|粗利|現金残高|資金|キャッシュ/.test(text);
  const metricType = analysisRequested && (summaryRequested || focusedMetricRequested)
    ? 'daily_analysis'
    : summaryRequested
      ? 'daily_summary'
      : /来客数|客数|来店客数/.test(text)
        ? 'customers'
        : /客単価|平均客単価/.test(text)
          ? 'average_spend'
          : /経費|費用/.test(text)
            ? 'expense'
            : /利益|営業利益/.test(text)
              ? 'profit'
              : /売上/.test(text)
                ? 'revenue'
                : null;
  if (!businessKey || !metricType || !dataDate) return null;
  if (metricType === 'daily_analysis' && !summaryRequested) {
    const analysisFocus = detectManagementAnalysisFocus(text);
    return { businessKey, metricType, dataDate, ...(analysisFocus ? { analysisFocus } : {}) };
  }
  return { businessKey, metricType, dataDate };
}

function managementDataContext(entry) {
  if (!entry) return null;
  const rawDate = entry.data_date instanceof Date ? entry.data_date.toISOString().slice(0, 10) : String(entry.data_date || '').slice(0, 10);
  const [year, month, day] = rawDate.split('-');
  const amount = Number(entry.amount);
  if (!year || !month || !day || !Number.isFinite(amount)) return null;
  const businessName = entry.business_key === 'north-star-beans' ? 'NORTH STAR BEANS' : entry.business_key;
  const names = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const metricName = names[entry.metric_type] || entry.metric_type;
  const currency = entry.currency === 'JPY' ? '円' : entry.currency === 'COUNT' ? '人' : ` ${entry.currency}`;
  return { category:'経営数値', title:`${metricName} ${year}/${month}/${day}`, body:`${Number(month)}月${Number(day)}日の${businessName}の${metricName}は${amount.toLocaleString('ja-JP')}${currency}です。`, source:'本人確認済み経営数値' };
}

function managementDataSummaryContext(entries) {
  const contexts = (Array.isArray(entries) ? entries : []).map(managementDataContext).filter(Boolean);
  if (!contexts.length) return null;
  const first = entries.find(Boolean);
  const rawDate = first.data_date instanceof Date ? first.data_date.toISOString().slice(0, 10) : String(first.data_date || '').slice(0, 10);
  const [year, month, day] = rawDate.split('-');
  const businessName = first.business_key === 'north-star-beans' ? 'NORTH STAR BEANS' : first.business_key;
  return { category:'経営数値', title:`日次経営状況 ${year}/${month}/${day}`, body:`${Number(month)}月${Number(day)}日の${businessName}の本人確認済み経営数値: ${contexts.map(item => item.body.replace(/^.*?のNORTH STAR BEANSの/, '')).join('、')}`, source:'本人確認済み経営数値' };
}


function managementDataPeriodAggregates(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry => Number.isFinite(Number(entry?.amount)));
  if (!rows.length) return [];
  const metricNames = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const grouped = new Map();
  for (const entry of rows) {
    if (!grouped.has(entry.metric_type)) grouped.set(entry.metric_type, []);
    grouped.get(entry.metric_type).push(entry);
  }
  const format = (value, currency) => {
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
    const unit = currency === 'JPY' ? '円' : currency === 'COUNT' ? '人' : currency ? ` ${currency}` : '';
    return `${rounded.toLocaleString('ja-JP')}${unit}`;
  };
  const lines = [];
  const additive = new Set(['revenue','expense','profit','customers']);
  for (const [metricType, items] of grouped.entries()) {
    const name = metricNames[metricType] || metricType;
    const currency = items[0]?.currency || '';
    const values = items.map(item => Number(item.amount));
    if (additive.has(metricType)) {
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = total / values.length;
      lines.push(`${name}: 登録済み${values.length}日分の合計${format(total, currency)}、登録済み${values.length}日平均${format(average, currency)}`);
      continue;
    }
    if (metricType === 'average_spend') {
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      lines.push(`${name}: 登録済み${values.length}日平均${format(average, currency)}`);
      continue;
    }
    if (metricType === 'cash_balance') {
      const latest = [...items].sort((a, b) => String(a.data_date).localeCompare(String(b.data_date))).at(-1);
      lines.push(`${name}: 最新の登録値${format(Number(latest.amount), latest.currency || currency)}`);
    }
  }
  return lines;
}

function managementDataPeriodTrendMetrics(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry =>
    Number.isFinite(Number(entry?.amount)) && entry?.metric_type
  );
  if (!rows.length) return [];
  const names = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const grouped = new Map();
  for (const entry of rows) {
    if (!grouped.has(entry.metric_type)) grouped.set(entry.metric_type, []);
    grouped.get(entry.metric_type).push(entry);
  }
  const format = (value, currency, signed = false) => {
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
    const sign = signed && rounded > 0 ? '+' : '';
    const unit = currency === 'JPY' ? '円' : currency === 'COUNT' ? '人' : currency ? ` ${currency}` : '';
    return `${sign}${rounded.toLocaleString('ja-JP')}${unit}`;
  };
  const lines = [];
  for (const [metricType, items] of grouped.entries()) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((a, b) => String(a.data_date).localeCompare(String(b.data_date)));
    const first = sorted[0];
    const last = sorted.at(-1);
    if (first.currency !== last.currency) continue;
    const firstValue = Number(first.amount);
    const lastValue = Number(last.amount);
    const diff = lastValue - firstValue;
    const rate = firstValue === 0 ? null : diff / firstValue * 100;
    const name = names[metricType] || metricType;
    const rateText = rate === null ? '増減率は基準値0のため算出不可' : `増減率${rate > 0 ? '+' : ''}${Number(rate.toFixed(2)).toLocaleString('ja-JP')}%`;
    lines.push(`${name}: ${String(first.data_date).slice(0,10)}の${format(firstValue, first.currency)} → ${String(last.data_date).slice(0,10)}の${format(lastValue, last.currency)}、差${format(diff, last.currency, true)}、${rateText}`);
  }
  return lines;
}

function managementDataPeriodCompleteness(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry => entry?.metric_type);
  const metricNames = {
    revenue:'売上',
    customers:'来客数',
    average_spend:'客単価',
    expense:'経費',
    profit:'利益',
    cash_balance:'現金残高'
  };
  const order = ['revenue','customers','average_spend','expense','profit','cash_balance'];
  const datesByMetric = new Map(order.map(metric => [metric, new Set()]));
  for (const entry of rows) {
    if (!datesByMetric.has(entry.metric_type)) datesByMetric.set(entry.metric_type, new Set());
    const rawDate = entry?.data_date instanceof Date
      ? entry.data_date.toISOString().slice(0, 10)
      : String(entry?.data_date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) datesByMetric.get(entry.metric_type).add(rawDate);
  }
  return order.map(metricType => {
    const dates = [...(datesByMetric.get(metricType) || [])].sort();
    const name = metricNames[metricType] || metricType;
    if (!dates.length) return `${name}: 登録0日`;
    if (dates.length === 1) return `${name}: 登録1日（${dates[0]}）`;
    return `${name}: 登録${dates.length}日（${dates[0]}〜${dates.at(-1)}）`;
  });
}

function managementDataConsistencyChecks(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry =>
    entry?.metric_type && Number.isFinite(Number(entry?.amount))
  );
  if (!rows.length) return [];
  const byDate = new Map();
  for (const entry of rows) {
    const rawDate = entry?.data_date instanceof Date
      ? entry.data_date.toISOString().slice(0, 10)
      : String(entry?.data_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    if (!byDate.has(rawDate)) byDate.set(rawDate, new Map());
    byDate.get(rawDate).set(entry.metric_type, entry);
  }
  const yen = value => `${Number(value).toLocaleString('ja-JP')}円`;
  const lines = [];
  for (const [date, metrics] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const revenue = metrics.get('revenue');
    const customers = metrics.get('customers');
    const averageSpend = metrics.get('average_spend');
    if (revenue && customers && averageSpend) {
      const expected = Number(customers.amount) * Number(averageSpend.amount);
      const actual = Number(revenue.amount);
      const diff = actual - expected;
      const status = diff === 0 ? '一致' : `差${diff > 0 ? '+' : ''}${yen(diff)}`;
      lines.push(`${date} 売上整合性: ${Number(customers.amount).toLocaleString('ja-JP')}人 × ${yen(Number(averageSpend.amount))} = ${yen(expected)}、登録売上${yen(actual)}（${status}）`);
    }
    const expense = metrics.get('expense');
    const profit = metrics.get('profit');
    if (revenue && expense && profit) {
      const expected = Number(revenue.amount) - Number(expense.amount);
      const actual = Number(profit.amount);
      const diff = actual - expected;
      const status = diff === 0 ? '一致' : `差${diff > 0 ? '+' : ''}${yen(diff)}`;
      lines.push(`${date} 利益整合性: 売上${yen(Number(revenue.amount))} - 経費${yen(Number(expense.amount))} = ${yen(expected)}、登録利益${yen(actual)}（${status}）`);
    }
  }
  return lines;
}

function managementDataAnalysisReadiness(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry => entry?.metric_type);
  const dateSets = new Map();
  for (const entry of rows) {
    if (!dateSets.has(entry.metric_type)) dateSets.set(entry.metric_type, new Set());
    const rawDate = entry?.data_date instanceof Date
      ? entry.data_date.toISOString().slice(0, 10)
      : String(entry?.data_date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) dateSets.get(entry.metric_type).add(rawDate);
  }
  const count = metric => (dateSets.get(metric) || new Set()).size;
  const overlapCount = metrics => {
    if (!metrics.length) return 0;
    const sets = metrics.map(metric => dateSets.get(metric) || new Set());
    if (sets.some(set => !set.size)) return 0;
    return [...sets[0]].filter(date => sets.every(set => set.has(date))).length;
  };
  const lines = [];
  lines.push(count('revenue') >= 1
    ? `売上集計: 実行可能（売上登録${count('revenue')}日）`
    : '売上集計: 不可（売上未登録）');
  lines.push(count('revenue') >= 2
    ? `売上推移: 実行可能（売上登録${count('revenue')}日）`
    : `売上推移: データ不足（売上登録${count('revenue')}日、2日以上必要）`);
  const trafficOverlap = overlapCount(['revenue','customers','average_spend']);
  lines.push(trafficOverlap >= 1
    ? `来客数・客単価・売上の関係: 実行可能（同日登録${trafficOverlap}日）`
    : '来客数・客単価・売上の関係: データ不足（3指標の同日登録が必要）');
  const profitOverlap = overlapCount(['revenue','expense','profit']);
  lines.push(profitOverlap >= 1
    ? `収益性確認: 実行可能（売上・経費・利益の同日登録${profitOverlap}日）`
    : '収益性確認: データ不足（売上・経費・利益の同日登録が必要）');
  lines.push(count('cash_balance') >= 1
    ? `現金残高確認: 実行可能（現金残高登録${count('cash_balance')}日）`
    : '現金残高確認: データ不足（現金残高未登録）');
  return lines;
}

function managementDataNextRequiredInputs(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter(entry => entry?.metric_type);
  const byDate = new Map();
  const dateSets = new Map();
  for (const entry of rows) {
    const rawDate = entry?.data_date instanceof Date
      ? entry.data_date.toISOString().slice(0, 10)
      : String(entry?.data_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    if (!byDate.has(rawDate)) byDate.set(rawDate, new Set());
    byDate.get(rawDate).add(entry.metric_type);
    if (!dateSets.has(entry.metric_type)) dateSets.set(entry.metric_type, new Set());
    dateSets.get(entry.metric_type).add(rawDate);
  }
  const count = metric => (dateSets.get(metric) || new Set()).size;
  const latestRevenueDate = [...(dateSets.get('revenue') || [])].sort().at(-1) || null;
  const lines = [];
  if (count('revenue') === 0) {
    lines.push('優先1: 売上を1日分登録すると、売上集計が可能になります。');
  } else if (count('revenue') === 1) {
    lines.push('優先1: 別日の売上をもう1日以上登録すると、売上推移・増減率の分析が可能になります。');
  }

  if (latestRevenueDate) {
    const metrics = byDate.get(latestRevenueDate) || new Set();
    const trafficMissing = ['customers','average_spend'].filter(metric => !metrics.has(metric));
    if (trafficMissing.length) {
      const names = trafficMissing.map(metric => metric === 'customers' ? '来客数' : '客単価').join('・');
      lines.push(`優先2: ${latestRevenueDate}の${names}を登録すると、来客数・客単価・売上の関係を確認できます。`);
    }
    const profitMissing = ['expense','profit'].filter(metric => !metrics.has(metric));
    if (profitMissing.length) {
      const names = profitMissing.map(metric => metric === 'expense' ? '経費' : '利益').join('・');
      lines.push(`優先3: ${latestRevenueDate}の${names}を登録すると、収益性の確認が可能になります。`);
    }
  }

  if (count('cash_balance') === 0) {
    lines.push('優先4: 現金残高を1日分登録すると、資金残高の確認が可能になります。');
  }
  return lines.length ? lines : ['追加登録の優先項目はありません。現在の主要分析項目は利用可能です。'];
}

function managementDataFocusedPeriodContext(entries, startDate, endDate, focus) {
  const rows = Array.isArray(entries) ? entries : [];
  const focusConfig = {
    sales: {
      label:'売上',
      metrics:['revenue'],
      readiness:/^売上(?:集計|推移):/,
      next:/売上/,
      consistency:null
    },
    traffic: {
      label:'来客数・客単価・売上',
      metrics:['revenue','customers','average_spend'],
      readiness:/^来客数・客単価・売上の関係:/,
      next:/来客数|客単価|売上の関係/,
      consistency:/売上整合性/
    },
    profit: {
      label:'収益性',
      metrics:['revenue','expense','profit'],
      readiness:/^収益性確認:/,
      next:/経費|利益|収益性/,
      consistency:/利益整合性/
    },
    cash: {
      label:'現金残高',
      metrics:['cash_balance'],
      readiness:/^現金残高確認:/,
      next:/現金残高|資金残高/,
      consistency:null
    }
  }[focus];
  if (!focusConfig) return managementDataPeriodContext(rows, startDate, endDate);

  const focusedRows = rows.filter(entry => focusConfig.metrics.includes(entry?.metric_type));
  const aggregates = managementDataPeriodAggregates(focusedRows);
  const trends = managementDataPeriodTrendMetrics(focusedRows);
  const readiness = managementDataAnalysisReadiness(rows).filter(line => focusConfig.readiness.test(line));
  const nextInputs = managementDataNextRequiredInputs(rows).filter(line => focusConfig.next.test(line));
  const consistency = focusConfig.consistency
    ? managementDataConsistencyChecks(rows).filter(line => focusConfig.consistency.test(line))
    : [];
  const summaries = [];
  const groups = new Map();
  for (const entry of focusedRows) {
    const rawDate = entry?.data_date instanceof Date ? entry.data_date.toISOString().slice(0, 10) : String(entry?.data_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    if (!groups.has(rawDate)) groups.set(rawDate, []);
    groups.get(rawDate).push(entry);
  }
  for (const [, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const context = managementDataSummaryContext(items);
    if (context) summaries.push(context);
  }
  const body = summaries.length
    ? [
        `ユーザーは${focusConfig.label}に絞った分析を求めています。頼まれていない別分野へ話を広げず、以下の本人確認済み経営数値だけで回答してください。`,
        `対象期間: ${startDate}〜${endDate}`,
        '分析可能範囲（サーバー判定）:',
        ...(readiness.length ? readiness : ['該当分析の判定情報はありません。']),
        '次に登録すると分析が広がる項目（サーバー判定）:',
        ...(nextInputs.length ? nextInputs : ['追加登録の優先項目はありません。']),
        'サーバー計算済み集計（再計算せずこの値を使用）:',
        ...(aggregates.length ? aggregates : ['集計対象の指標はありません。']),
        'サーバー計算済み期間内差分（再計算せずこの値を使用）:',
        ...(trends.length ? trends : ['2日以上登録されている同一指標はありません。']),
        ...(consistency.length ? ['サーバー計算済み整合性確認（再計算せずこの値を使用）:', ...consistency] : []),
        '日別の確認済みデータ:',
        ...summaries.map(item => item.body)
      ].join('\n')
    : `${startDate}から${endDate}までの期間に、${focusConfig.label}の本人確認済み経営数値はありません。`;
  return { category:'経営数値', title:`${focusConfig.label}分析 ${startDate}〜${endDate}`, body, source:'本人確認済み経営数値' };
}

function managementDataPeriodContext(entries, startDate, endDate) {
  const rows = Array.isArray(entries) ? entries : [];
  const groups = new Map();
  for (const entry of rows) {
    const rawDate = entry?.data_date instanceof Date ? entry.data_date.toISOString().slice(0, 10) : String(entry?.data_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) continue;
    if (!groups.has(rawDate)) groups.set(rawDate, []);
    groups.get(rawDate).push(entry);
  }
  const summaries = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => managementDataSummaryContext(items)).filter(Boolean);
  const aggregates = managementDataPeriodAggregates(rows);
  const trends = managementDataPeriodTrendMetrics(rows);
  const completeness = managementDataPeriodCompleteness(rows);
  const consistency = managementDataConsistencyChecks(rows);
  const readiness = managementDataAnalysisReadiness(rows);
  const nextInputs = managementDataNextRequiredInputs(rows);
  const body = summaries.length
    ? `${startDate}から${endDate}までの期間で、本人確認済み経営数値が保存されている日だけを列挙します（未登録日は0として扱いません）。登録済み日は${summaries.length}日です。合計・平均・期間内の最初と最後の登録値の差分はサーバー側で計算済みの値を優先して使用し、指定期間の全日数を分母にした平均として表現しないでください。ユーザーが明示的に仮定計算を求めていない限り、不足している指標を別日の値や推測値で補完して試算しないでください。\n分析可能範囲（サーバー判定）:\n${readiness.join('\n')}\n次に登録すると分析が広がる項目（サーバー判定）:\n${nextInputs.join('\n')}\nデータ登録状況（指標ごとの登録日数。未登録日は0値ではありません）:\n${completeness.join('\n')}\nサーバー計算済み集計（再計算せずこの値を使用）:\n${aggregates.length ? aggregates.join('\n') : '集計対象の指標はありません。'}\nサーバー計算済み期間内差分（再計算せずこの値を使用）:\n${trends.length ? trends.join('\n') : '2日以上登録されている同一指標はありません。'}\nサーバー計算済み整合性確認（再計算せずこの値を使用）:\n${consistency.length ? consistency.join('\n') : '整合性確認に必要な指標の組み合わせはありません。'}\n日別の確認済みデータ:\n${summaries.map(item => item.body).join('\n')}`
    : `${startDate}から${endDate}までの期間に、本人確認済み経営数値はありません。`;
  return { category:'経営数値', title:`期間経営状況 ${startDate}〜${endDate}`, body, source:'本人確認済み経営数値' };
}

function managementDataFocusLabel(focus) {
  return { sales:'売上', traffic:'来客数・客単価・売上', profit:'収益性', cash:'現金残高' }[focus] || '経営数値';
}

function managementDataMissingPeriodNextInputs(missingLabels, focus, periodLabel, comparison = false) {
  const labels = Array.isArray(missingLabels) ? missingLabels.filter(Boolean) : [];
  if (!labels.length) return [];
  const required = {
    sales:'売上を1日分以上',
    traffic:'売上・来客数・客単価を同じ日に1日分以上',
    profit:'売上・経費・利益を同じ日に1日分以上',
    cash:'現金残高を1日分以上'
  }[focus] || '必要な経営数値を1日分以上';
  const scope = periodLabel === 'year' ? '年次' : '月次';
  const goal = comparison ? `${scope}比較` : `${scope}推移分析`;
  return labels.map((label, index) =>
    `優先${index + 1}: ${label}の${required}登録すると、${label}を${goal}の対象にできます。`
  );
}

function managementDataFocusedGroupComparisonMetrics(groups, focus) {
  const source = Array.isArray(groups) ? groups.slice(0, 2) : [];
  if (source.length < 2) return [];
  const metricMap = {
    sales:['revenue'],
    traffic:['revenue','customers','average_spend'],
    profit:['revenue','expense','profit'],
    cash:['cash_balance']
  };
  const names = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const additive = new Set(['revenue','expense','profit','customers']);
  const metrics = metricMap[focus] || [];
  const format = (value, currency, signed = false) => {
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
    const sign = signed && rounded > 0 ? '+' : '';
    const unit = currency === 'JPY' ? '円' : currency === 'COUNT' ? '人' : currency ? ` ${currency}` : '';
    return `${sign}${rounded.toLocaleString('ja-JP')}${unit}`;
  };
  const rateText = (before, after) => {
    if (before === 0) return '増減率は基準値0のため算出不可';
    const rate = (after - before) / before * 100;
    return `増減率${rate > 0 ? '+' : ''}${Number(rate.toFixed(2)).toLocaleString('ja-JP')}%`;
  };
  const rowsFor = (group, metricType) =>
    (group?.entries || []).filter(entry => entry?.metric_type === metricType && Number.isFinite(Number(entry?.amount)));

  const [left, right] = source;
  const leftLabel = left?.label || `${left?.startDate}〜${left?.endDate}`;
  const rightLabel = right?.label || `${right?.startDate}〜${right?.endDate}`;
  const lines = [];
  for (const metricType of metrics) {
    const leftRows = rowsFor(left, metricType);
    const rightRows = rowsFor(right, metricType);
    if (!leftRows.length || !rightRows.length) continue;
    const leftCurrency = leftRows[0]?.currency || '';
    const rightCurrency = rightRows[0]?.currency || '';
    if (leftCurrency !== rightCurrency) continue;
    const name = names[metricType] || metricType;

    if (metricType === 'cash_balance') {
      const leftLatest = [...leftRows].sort((a,b) => String(a.data_date).localeCompare(String(b.data_date))).at(-1);
      const rightLatest = [...rightRows].sort((a,b) => String(a.data_date).localeCompare(String(b.data_date))).at(-1);
      const before = Number(leftLatest.amount);
      const after = Number(rightLatest.amount);
      lines.push(`${name}: ${leftLabel}の最新登録値${format(before, leftCurrency)} → ${rightLabel}の最新登録値${format(after, rightCurrency)}、差${format(after - before, rightCurrency, true)}、${rateText(before, after)}`);
      continue;
    }

    const leftValues = leftRows.map(entry => Number(entry.amount));
    const rightValues = rightRows.map(entry => Number(entry.amount));
    const leftAverage = leftValues.reduce((sum, value) => sum + value, 0) / leftValues.length;
    const rightAverage = rightValues.reduce((sum, value) => sum + value, 0) / rightValues.length;

    if (additive.has(metricType) && leftValues.length === rightValues.length) {
      const leftTotal = leftValues.reduce((sum, value) => sum + value, 0);
      const rightTotal = rightValues.reduce((sum, value) => sum + value, 0);
      lines.push(`${name}: 登録日数が同じ${leftValues.length}日のため登録済み日合計を比較。 ${leftLabel} ${format(leftTotal, leftCurrency)} → ${rightLabel} ${format(rightTotal, rightCurrency)}、差${format(rightTotal - leftTotal, rightCurrency, true)}、${rateText(leftTotal, rightTotal)}`);
      continue;
    }

    const reason = additive.has(metricType) && leftValues.length !== rightValues.length
      ? `登録日数が異なる（${leftLabel} ${leftValues.length}日、${rightLabel} ${rightValues.length}日）ため合計は直接比較せず、`
      : '';
    lines.push(`${name}: ${reason}登録日平均を比較。 ${leftLabel} ${format(leftAverage, leftCurrency)} → ${rightLabel} ${format(rightAverage, rightCurrency)}、差${format(rightAverage - leftAverage, rightCurrency, true)}、${rateText(leftAverage, rightAverage)}`);
  }
  return lines;
}

function managementDataFocusedGroupedContext(groups, focus, periodLabel, comparison = false) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  if (!safeGroups.length) return null;
  const label = managementDataFocusLabel(focus);
  const items = safeGroups.map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataFocusedPeriodContext(group?.entries || [], group?.startDate, group?.endDate, focus)
  }));
  const available = items.filter(item => item.context && !/本人確認済み経営数値はありません/.test(item.context.body));
  const missing = items.filter(item => !item.context || /本人確認済み経営数値はありません/.test(item.context.body)).map(item => item.label);
  const missingInputs = managementDataMissingPeriodNextInputs(missing, focus, periodLabel, comparison);
  const comparisonMetrics = comparison ? managementDataFocusedGroupComparisonMetrics(safeGroups, focus) : [];
  const unit = periodLabel === 'year' ? '年' : '月';
  const body = [
    `ユーザーは${label}に絞った${unit}ごとの${comparison ? '比較' : '推移分析'}を求めています。頼まれていない別分野へ話を広げないでください。`,
    `未登録日・未登録${unit}は0として扱わないでください。`,
    missing.length ? `データ未登録の${unit}: ${missing.join('、')}` : '',
    ...(comparisonMetrics.length ? [
      'サーバー計算済み期間比較（再計算せずこの値を使用）:',
      ...comparisonMetrics
    ] : []),
    ...(missingInputs.length ? [
      '次に登録すると分析が広がる項目（サーバー判定）:',
      ...missingInputs,
      `${unit}別の確認済みデータ:`
    ] : []),
    ...available.map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:`${label}の${unit}次${comparison ? '比較' : '推移'}`, body, source:'本人確認済み経営数値' };
}

function managementDataFocusedMultiMonthContext(groups, focus, comparison = false) {
  return managementDataFocusedGroupedContext(groups, focus, 'month', comparison);
}

function managementDataFocusedMultiYearContext(groups, focus, comparison = false) {
  return managementDataFocusedGroupedContext(groups, focus, 'year', comparison);
}

function managementDataMultiMonthContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate)
  }));
  if (!items.length) return null;
  const available = items.filter(item => item.context && !/経営数値はありません/.test(item.context.body));
  const missing = items.filter(item => !item.context || /経営数値はありません/.test(item.context.body)).map(item => item.label);
  const body = [
    '本人確認済み経営数値だけで月ごとの推移を分析してください。未登録日・未登録月は0として扱わないでください。',
    '月ごとの登録済み日数が違う場合は、単純な月間合計だけで増減や良し悪しを断定しないでください。',
    missing.length ? `データ未登録の月: ${missing.join('、')}` : '',
    ...available.map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'複数月の経営推移', body, source:'本人確認済み経営数値' };
}

function managementDataMultiYearContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate)
  }));
  if (!items.length) return null;
  const available = items.filter(item => item.context && !/経営数値はありません/.test(item.context.body));
  const missing = items.filter(item => !item.context || /経営数値はありません/.test(item.context.body)).map(item => item.label);
  const body = [
    '本人確認済み経営数値だけで年ごとの推移を分析してください。未登録日・未登録年は0として扱わないでください。',
    '年ごとの登録済み日数が違う場合は、単純な年間合計だけで増減や良し悪しを断定しないでください。',
    missing.length ? `データ未登録の年: ${missing.join('、')}` : '',
    ...available.map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'複数年の経営推移', body, source:'本人確認済み経営数値' };
}

function managementDataAnnualComparisonContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => ({
    label:group?.label || `${group?.startDate}〜${group?.endDate}`,
    context:managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate)
  }));
  if (!items.length) return null;
  const missing = items.filter(item => !item.context || /経営数値はありません/.test(item.context.body)).map(item => item.label);
  const body = [
    '本人確認済み経営数値だけで年ごとに比較してください。未登録日・未登録年は0として扱わないでください。',
    '年ごとの登録済み日数が違う場合は、単純な年間合計だけで増減や良し悪しを断定しないでください。',
    missing.length ? `データ未登録の年: ${missing.join('、')}` : '',
    ...items.filter(item => item.context && !/経営数値はありません/.test(item.context.body))
      .map(item => `${item.label}:\n${item.context.body}`)
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'年次経営状況の比較', body, source:'本人確認済み経営数値' };
}

function managementDataMonthlyComparisonContext(groups) {
  const items = (Array.isArray(groups) ? groups : []).map(group => {
    const context = managementDataPeriodContext(group?.entries || [], group?.startDate, group?.endDate);
    return { label:group?.label || `${group?.startDate}〜${group?.endDate}`, context };
  }).filter(item => item.context);
  if (!items.length) return null;
  return {
    category:'経営数値',
    title:'月次経営状況の比較',
    body:`本人確認済み経営数値だけで月ごとに比較してください。未登録日は0として扱わず、各月の登録済み日数が違う場合は単純な月間合計の優劣を断定しないでください。\n${items.map(item => `${item.label}:\n${item.context.body}`).join('\n')}`,
    source:'本人確認済み経営数値'
  };
}

function managementDataComparisonMetrics(groups) {
  const source = Array.isArray(groups) ? groups.slice(0, 2) : [];
  if (source.length < 2) return [];
  const [left, right] = source;
  const leftByMetric = new Map((left?.entries || []).filter(Boolean).map(entry => [entry.metric_type, entry]));
  const rightByMetric = new Map((right?.entries || []).filter(Boolean).map(entry => [entry.metric_type, entry]));
  const names = { revenue:'売上', expense:'経費', profit:'利益', customers:'来客数', average_spend:'客単価', cash_balance:'現金残高' };
  const formatValue = (value, currency, signed = false) => {
    const rounded = Number.isInteger(value) ? value : Number(value.toFixed(2));
    const sign = signed && rounded > 0 ? '+' : '';
    const unit = currency === 'JPY' ? '円' : currency === 'COUNT' ? '人' : currency ? ` ${currency}` : '';
    return `${sign}${rounded.toLocaleString('ja-JP')}${unit}`;
  };
  const lines = [];
  for (const [metricType, before] of leftByMetric.entries()) {
    const after = rightByMetric.get(metricType);
    if (!after) continue;
    if (before.currency !== after.currency) continue;
    const beforeValue = Number(before.amount);
    const afterValue = Number(after.amount);
    if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) continue;
    const diff = afterValue - beforeValue;
    const rate = beforeValue === 0 ? null : diff / beforeValue * 100;
    const name = names[metricType] || metricType;
    const rateText = rate === null ? '増減率は基準値0のため算出不可' : `増減率${rate > 0 ? '+' : ''}${Number(rate.toFixed(2)).toLocaleString('ja-JP')}%`;
    lines.push(`${name}: ${left.dataDate}の${formatValue(beforeValue, before.currency)} → ${right.dataDate}の${formatValue(afterValue, after.currency)}、差${formatValue(diff, after.currency, true)}、${rateText}`);
  }
  return lines;
}

function managementDataComparisonContext(groups) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const items = safeGroups.map(group => ({
    dataDate:group?.dataDate,
    context:managementDataSummaryContext(group?.entries || [])
  })).filter(item => item.dataDate);
  if (!items.length) return null;
  const comparisons = managementDataComparisonMetrics(safeGroups);
  const body = [
    comparisons.length ? `サーバー計算済み差分（再計算せずこの値を使用）:\n${comparisons.join('\n')}` : '',
    '日別の本人確認済みデータ:',
    items.map(item => item.context ? item.context.body : `${item.dataDate}の本人確認済み経営数値はありません。`).join('\n')
  ].filter(Boolean).join('\n');
  return { category:'経営数値', title:'日次経営状況の比較', body, source:'本人確認済み経営数値' };
}

function scopeManagementAnalysisInputs({ query, history = [], knowledge = [], context = null }) {
  const safeHistory = Array.isArray(history) ? history : [];
  const safeKnowledge = Array.isArray(knowledge) ? knowledge : [];
  if (query?.metricType === 'daily_analysis' || query?.metricType === 'daily_comparison' || query?.metricType === 'period_analysis' || query?.metricType === 'monthly_comparison' || query?.metricType === 'monthly_period_analysis' || query?.metricType === 'annual_comparison' || query?.metricType === 'annual_period_analysis') {
    return { history:[], knowledge:context ? [context] : [] };
  }
  return { history:safeHistory, knowledge:context ? [...safeKnowledge, context] : safeKnowledge };
}

module.exports = { detectManagementDataHistoryQuery, detectManagementDataHistoryFollowUp, isInitialManagementDataRestorePhrase, detectManagementDataRestoreRequest, detectManagementDataCurrentStateQuery, managementDataCurrentStateAnswer, detectManagementDataHistoryConsistencyQuery, managementDataHistoryConsistencyAnswer, managementDataHistoryAnswer, formatManagementHistoryValue, formatManagementHistoryChangedAt, detectManagementDataQuery, detectManagementAnalysisFocus, managementDataContext, managementDataSummaryContext, managementDataComparisonContext, managementDataComparisonMetrics, managementDataMonthlyComparisonContext, managementDataAnnualComparisonContext, managementDataMultiMonthContext, managementDataMultiYearContext, managementDataFocusedMultiMonthContext, managementDataFocusedMultiYearContext, managementDataFocusedGroupComparisonMetrics, managementDataMissingPeriodNextInputs, managementDataPeriodContext, managementDataFocusedPeriodContext, managementDataPeriodAggregates, managementDataPeriodTrendMetrics, managementDataPeriodCompleteness, managementDataConsistencyChecks, managementDataAnalysisReadiness, managementDataNextRequiredInputs, scopeManagementAnalysisInputs, parseBusinessAndDates, parseBusinessAndMonths, parseBusinessAndMonthRange, parseBusinessAndYearMonths, parseBusinessAndYears, enumerateMonthRanges, enumerateYearRanges };
