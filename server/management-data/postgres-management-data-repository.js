'use strict';

const METRIC_TYPES = new Set(['revenue', 'expense', 'profit', 'cash_balance', 'customers', 'average_spend', 'other']);

function normalizeEntry(input) {
  if (!input || typeof input !== 'object' || input.confirmed !== true) return null;
  const businessKey = typeof input.businessKey === 'string' ? input.businessKey.trim() : '';
  const dataDate = typeof input.dataDate === 'string' ? input.dataDate.trim() : '';
  const metricType = typeof input.metricType === 'string' ? input.metricType.trim() : '';
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : 'JPY';
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const amount = Number(input.amount);
  if (!businessKey || businessKey.length > 120) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) return null;
  if (!METRIC_TYPES.has(metricType)) return null;
  if (!Number.isFinite(amount)) return null;
  if (!/^[A-Z]{3,8}$/.test(currency)) return null;
  if (!source || source.length > 500) return null;
  if (note.length > 2000) return null;
  return { businessKey, dataDate, metricType, amount, currency, note: note || null, source };
}

class PostgresManagementDataRepository {
  constructor(pool) { if (!pool?.query) throw new Error('database pool is required'); this.pool = pool; }
  async create(ownerEmail, input) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    const value = normalizeEntry(input); if (!value) return null;
    const result = await this.pool.query(
      `INSERT INTO management_data
        (owner_email, business_key, data_date, metric_type, amount, currency, note, source, confirmed_by_owner)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
                 confirmed_by_owner, created_at, updated_at`,
      [ownerEmail.trim(), value.businessKey, value.dataDate, value.metricType, value.amount, value.currency, value.note, value.source]
    );
    return result.rows[0] || null;
  }
  async update(ownerEmail, id, input) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (typeof id !== 'string' || !id.trim()) return null;
    const value = normalizeEntry(input); if (!value) return null;
    const result = await this.pool.query(
      `WITH previous AS (
         SELECT id, owner_email, business_key, data_date, metric_type,
                amount AS previous_amount, currency AS previous_currency
           FROM management_data
          WHERE id = $1 AND owner_email = $2 AND business_key = $3
            AND data_date = $4::date AND metric_type = $5
            AND confirmed_by_owner = TRUE
            AND superseded_by_management_data_id IS NULL
          FOR UPDATE
       ),
       updated AS (
         UPDATE management_data AS current
            SET amount = $6, currency = $7, note = $8, source = $9, updated_at = NOW()
           FROM previous
          WHERE current.id = previous.id
          RETURNING current.id, current.owner_email, current.business_key, current.data_date,
                    current.metric_type, current.amount, current.currency, current.note, current.source,
                    current.confirmed_by_owner, current.created_at, current.updated_at
       ),
       audit AS (
         INSERT INTO management_data_history
           (management_data_id, owner_email, business_key, data_date, metric_type,
            previous_amount, new_amount, previous_currency, new_currency,
            source, change_note, confirmed_by_owner, changed_at)
         SELECT previous.id, previous.owner_email, previous.business_key, previous.data_date, previous.metric_type,
                previous.previous_amount, updated.amount, previous.previous_currency, updated.currency,
                $9, $8, TRUE, updated.updated_at
           FROM previous
           JOIN updated ON updated.id = previous.id
          WHERE previous.previous_amount IS DISTINCT FROM updated.amount
             OR previous.previous_currency IS DISTINCT FROM updated.currency
         RETURNING id
       )
       SELECT id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
              confirmed_by_owner, created_at, updated_at
         FROM updated`,
      [id.trim(), ownerEmail.trim(), value.businessKey, value.dataDate, value.metricType, value.amount, value.currency, value.note, value.source]
    );
    return result.rows[0] || null;
  }
  async findExact(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.businessKey || !query?.dataDate || !query?.metricType) return null;
    const result = await this.pool.query(
      `SELECT id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
              confirmed_by_owner, created_at, updated_at
         FROM management_data
        WHERE owner_email = $1 AND business_key = $2 AND data_date = $3::date AND metric_type = $4
          AND confirmed_by_owner = TRUE
          AND superseded_by_management_data_id IS NULL
        ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`,
      [ownerEmail.trim(), query.businessKey, query.dataDate, query.metricType]
    );
    return result.rows[0] || null;
  }
  async findDaily(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.businessKey || !query?.dataDate) return [];
    const result = await this.pool.query(
      `SELECT DISTINCT ON (metric_type)
              id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
              confirmed_by_owner, created_at, updated_at
         FROM management_data
        WHERE owner_email = $1 AND business_key = $2 AND data_date = $3::date
          AND confirmed_by_owner = TRUE
          AND superseded_by_management_data_id IS NULL
        ORDER BY metric_type, updated_at DESC, created_at DESC, id DESC`,
      [ownerEmail.trim(), query.businessKey, query.dataDate]
    );
    return result.rows || [];
  }
  async findHistory(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.dataDate || !query?.metricType) return [];
    const businessKey = typeof query.businessKey === 'string' && query.businessKey.trim() ? query.businessKey.trim() : null;
    const params = [ownerEmail.trim(), query.dataDate, query.metricType];
    const businessClause = businessKey ? ' AND business_key = $4' : '';
    if (businessKey) params.push(businessKey);
    const result = await this.pool.query(
      `SELECT history.id, history.management_data_id, history.owner_email, history.business_key,
              history.data_date, history.metric_type, history.previous_amount, history.new_amount,
              history.previous_currency, history.new_currency, history.source, history.change_note,
              history.confirmed_by_owner, history.changed_at
         FROM management_data_history AS history
         JOIN management_data AS current ON current.id = history.management_data_id
        WHERE history.owner_email = $1 AND history.data_date = $2::date AND history.metric_type = $3
          AND history.confirmed_by_owner = TRUE${businessClause.replace(/business_key/g, 'history.business_key')}
          AND current.owner_email = $1
          AND current.confirmed_by_owner = TRUE
          AND current.superseded_by_management_data_id IS NULL
        ORDER BY history.changed_at ASC, history.id ASC
        LIMIT 100`,
      params
    );
    return result.rows || [];
  }
  async findBusinessCurrent(ownerEmail, businessKey) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (typeof businessKey !== 'string' || !businessKey.trim()) return [];
    const result = await this.pool.query(
      `SELECT id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
              confirmed_by_owner, created_at, updated_at
         FROM management_data
        WHERE owner_email = $1 AND business_key = $2
          AND confirmed_by_owner = TRUE
          AND superseded_by_management_data_id IS NULL
        ORDER BY data_date ASC, metric_type ASC, updated_at ASC, id ASC`,
      [ownerEmail.trim(), businessKey.trim()]
    );
    return result.rows || [];
  }
  async findBusinessHistory(ownerEmail, businessKey) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (typeof businessKey !== 'string' || !businessKey.trim()) return [];
    const result = await this.pool.query(
      `SELECT history.id, history.management_data_id, history.owner_email, history.business_key,
              history.data_date, history.metric_type, history.previous_amount, history.new_amount,
              history.previous_currency, history.new_currency, history.source, history.change_note,
              history.confirmed_by_owner, history.changed_at
         FROM management_data_history AS history
         JOIN management_data AS current ON current.id = history.management_data_id
        WHERE history.owner_email = $1 AND history.business_key = $2
          AND history.confirmed_by_owner = TRUE
          AND current.owner_email = $1 AND current.business_key = $2
          AND current.confirmed_by_owner = TRUE
          AND current.superseded_by_management_data_id IS NULL
        ORDER BY history.data_date ASC, history.metric_type ASC, history.changed_at ASC, history.id ASC`,
      [ownerEmail.trim(), businessKey.trim()]
    );
    return result.rows || [];
  }
  async findDuplicateGroup(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.businessKey || !query?.dataDate || !query?.metricType) return [];
    const result = await this.pool.query(
      `SELECT id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
              confirmed_by_owner, created_at, updated_at
         FROM management_data
        WHERE owner_email = $1 AND business_key = $2 AND data_date = $3::date AND metric_type = $4
          AND confirmed_by_owner = TRUE
          AND superseded_by_management_data_id IS NULL
        ORDER BY updated_at DESC, created_at DESC, id DESC`,
      [ownerEmail.trim(), query.businessKey, query.dataDate, query.metricType]
    );
    return result.rows || [];
  }
  async resolveDuplicateGroup(ownerEmail, input) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!input?.businessKey || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.dataDate || '')) ||
        !METRIC_TYPES.has(String(input.metricType || ''))) return null;
    const keepEntryId = String(input.keepEntryId ?? '').trim();
    const expectedRows = Array.isArray(input.expectedRows) ? input.expectedRows : [];
    if (!/^\d+$/.test(keepEntryId) || expectedRows.length < 2) return null;
    const normalized = [];
    const seen = new Set();
    for (const row of expectedRows) {
      const id = String(row?.id ?? '').trim();
      const amount = Number(row?.amount);
      const currency = typeof row?.currency === 'string' ? row.currency.trim().toUpperCase() : '';
      const date = new Date(row?.updatedAt);
      if (!/^\d+$/.test(id) || seen.has(id) || !Number.isFinite(amount) ||
          !/^[A-Z]{3,8}$/.test(currency) || Number.isNaN(date.getTime())) return null;
      seen.add(id);
      normalized.push({ id, amount, currency, updated_at:date.toISOString() });
    }
    if (!seen.has(keepEntryId)) return null;
    const result = await this.pool.query(
      `WITH expected AS (
         SELECT id, amount, currency, updated_at
           FROM jsonb_to_recordset($6::jsonb)
             AS item(id BIGINT, amount NUMERIC(18,2), currency TEXT, updated_at TIMESTAMPTZ)
       ),
       locked AS (
         SELECT id, amount, currency, updated_at
           FROM management_data
          WHERE owner_email = $1 AND business_key = $2
            AND data_date = $3::date AND metric_type = $4
            AND confirmed_by_owner = TRUE
            AND superseded_by_management_data_id IS NULL
          FOR UPDATE
       ),
       valid AS (
         SELECT $5::BIGINT AS keep_id
          WHERE (SELECT COUNT(*) FROM locked) >= 2
            AND (SELECT COUNT(*) FROM locked) = (SELECT COUNT(*) FROM expected)
            AND EXISTS (SELECT 1 FROM locked WHERE id = $5::BIGINT)
            AND NOT EXISTS (
              SELECT 1
                FROM locked
                FULL JOIN expected USING (id)
               WHERE locked.id IS NULL OR expected.id IS NULL
                  OR locked.amount IS DISTINCT FROM expected.amount
                  OR BTRIM(UPPER(locked.currency)) IS DISTINCT FROM BTRIM(UPPER(expected.currency))
                  OR date_trunc('milliseconds', locked.updated_at) IS DISTINCT FROM expected.updated_at
            )
       ),
       resolved AS (
         UPDATE management_data AS current
            SET superseded_by_management_data_id = valid.keep_id,
                superseded_at = NOW(),
                superseded_reason = 'owner confirmed duplicate resolution'
           FROM valid
          WHERE current.owner_email = $1
            AND current.business_key = $2
            AND current.data_date = $3::date
            AND current.metric_type = $4
            AND current.confirmed_by_owner = TRUE
            AND current.superseded_by_management_data_id IS NULL
            AND current.id <> valid.keep_id
          RETURNING current.id
       ),
       audit AS (
         INSERT INTO management_data_duplicate_resolution_history
           (owner_email, business_key, data_date, metric_type,
            kept_management_data_id, superseded_management_data_ids, original_rows,
            confirmed_by_owner, resolution_note, resolved_at)
         SELECT $1, $2, $3::date, $4, valid.keep_id,
                jsonb_agg(resolved.id ORDER BY resolved.id),
                $6::jsonb,
                TRUE,
                'owner confirmed duplicate resolution',
                NOW()
           FROM valid
           JOIN resolved ON TRUE
          GROUP BY valid.keep_id
         HAVING COUNT(resolved.id) = (SELECT COUNT(*) - 1 FROM expected)
         RETURNING id, kept_management_data_id, superseded_management_data_ids, resolved_at
       )
       SELECT valid.keep_id,
              COUNT(resolved.id)::INT AS superseded_count,
              audit.id AS history_id,
              audit.resolved_at
         FROM valid
         JOIN resolved ON TRUE
         JOIN audit ON audit.kept_management_data_id = valid.keep_id
        GROUP BY valid.keep_id, audit.id, audit.resolved_at`,
      [
        ownerEmail.trim(), input.businessKey, input.dataDate, input.metricType,
        keepEntryId, JSON.stringify(normalized)
      ]
    );
    const row = result.rows?.[0] || null;
    if (!row || Number(row.superseded_count) !== normalized.length - 1 || !row.history_id) return null;
    return {
      keepEntryId:String(row.keep_id),
      supersededCount:Number(row.superseded_count),
      cleanupHistoryId:String(row.history_id),
      resolvedAt:row.resolved_at
    };
  }

  async findDuplicateResolutionHistory(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.businessKey || typeof query.businessKey !== 'string' || !query.businessKey.trim()) return [];
    const dataDate = typeof query.dataDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dataDate)
      ? query.dataDate
      : null;
    const metricType = typeof query.metricType === 'string' && METRIC_TYPES.has(query.metricType)
      ? query.metricType
      : null;
    const result = await this.pool.query(
      `SELECT id, owner_email, business_key, data_date, metric_type,
              kept_management_data_id, superseded_management_data_ids, original_rows,
              confirmed_by_owner, resolution_note, resolved_at
         FROM management_data_duplicate_resolution_history
        WHERE owner_email = $1 AND business_key = $2
          AND ($3::date IS NULL OR data_date = $3::date)
          AND ($4::text IS NULL OR metric_type = $4)
          AND confirmed_by_owner = TRUE
        ORDER BY resolved_at DESC, id DESC
        LIMIT 100`,
      [ownerEmail.trim(), query.businessKey.trim(), dataDate, metricType]
    );
    return result.rows || [];
  }

  async findBusinessAuditLog(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.businessKey || typeof query.businessKey !== 'string' || !query.businessKey.trim()) return [];
    const dataDate = typeof query.dataDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dataDate)
      ? query.dataDate
      : null;
    const metricType = typeof query.metricType === 'string' && METRIC_TYPES.has(query.metricType)
      ? query.metricType
      : null;
    const allowedEventTypes = new Set(['registration', 'change', 'duplicate_resolution']);
    const eventTypes = Array.isArray(query.eventTypes)
      ? [...new Set(query.eventTypes.filter(type => allowedEventTypes.has(type)))]
      : [];
    const eventTypeFilter = eventTypes.length && eventTypes.length < allowedEventTypes.size ? eventTypes : null;
    const requestedLimit = Number(query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 50 ? requestedLimit : 200;
    const auditStartDate = typeof query.auditStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.auditStartDate)
      ? query.auditStartDate
      : null;
    const auditEndDate = typeof query.auditEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.auditEndDate)
      ? query.auditEndDate
      : null;
    const safeAuditStartDate = auditStartDate && auditEndDate && auditStartDate <= auditEndDate ? auditStartDate : null;
    const safeAuditEndDate = safeAuditStartDate ? auditEndDate : null;
    const result = await this.pool.query(
      `WITH registrations AS (
         SELECT 'registration'::TEXT AS event_type,
                current.id::BIGINT AS event_id,
                current.id::BIGINT AS management_data_id,
                current.owner_email,
                current.business_key,
                current.data_date,
                current.metric_type,
                COALESCE(initial.previous_amount, current.amount) AS amount,
                COALESCE(initial.previous_currency, current.currency) AS currency,
                NULL::NUMERIC AS previous_amount,
                NULL::NUMERIC AS new_amount,
                NULL::TEXT AS previous_currency,
                NULL::TEXT AS new_currency,
                current.source,
                current.note AS action_note,
                current.confirmed_by_owner,
                current.created_at AS event_at,
                current.superseded_by_management_data_id,
                current.superseded_at,
                NULL::BIGINT AS kept_management_data_id,
                NULL::JSONB AS superseded_management_data_ids,
                NULL::JSONB AS original_rows
           FROM management_data AS current
           LEFT JOIN LATERAL (
             SELECT history.previous_amount, history.previous_currency
               FROM management_data_history AS history
              WHERE history.owner_email = current.owner_email
                AND history.management_data_id = current.id
                AND history.confirmed_by_owner = TRUE
              ORDER BY history.changed_at ASC, history.id ASC
              LIMIT 1
           ) AS initial ON TRUE
          WHERE current.owner_email = $1
            AND current.business_key = $2
            AND current.confirmed_by_owner = TRUE
            AND ($3::date IS NULL OR current.data_date = $3::date)
            AND ($4::text IS NULL OR current.metric_type = $4)
       ),
       changes AS (
         SELECT 'change'::TEXT AS event_type,
                history.id::BIGINT AS event_id,
                history.management_data_id::BIGINT AS management_data_id,
                history.owner_email,
                history.business_key,
                history.data_date,
                history.metric_type,
                history.new_amount AS amount,
                history.new_currency AS currency,
                history.previous_amount,
                history.new_amount,
                history.previous_currency,
                history.new_currency,
                history.source,
                history.change_note AS action_note,
                history.confirmed_by_owner,
                history.changed_at AS event_at,
                current.superseded_by_management_data_id,
                current.superseded_at,
                NULL::BIGINT AS kept_management_data_id,
                NULL::JSONB AS superseded_management_data_ids,
                NULL::JSONB AS original_rows
           FROM management_data_history AS history
           JOIN management_data AS current
             ON current.id = history.management_data_id
            AND current.owner_email = history.owner_email
          WHERE history.owner_email = $1
            AND history.business_key = $2
            AND history.confirmed_by_owner = TRUE
            AND current.confirmed_by_owner = TRUE
            AND ($3::date IS NULL OR history.data_date = $3::date)
            AND ($4::text IS NULL OR history.metric_type = $4)
       ),
       duplicate_resolutions AS (
         SELECT 'duplicate_resolution'::TEXT AS event_type,
                cleanup.id::BIGINT AS event_id,
                cleanup.kept_management_data_id::BIGINT AS management_data_id,
                cleanup.owner_email,
                cleanup.business_key,
                cleanup.data_date,
                cleanup.metric_type,
                NULL::NUMERIC AS amount,
                NULL::TEXT AS currency,
                NULL::NUMERIC AS previous_amount,
                NULL::NUMERIC AS new_amount,
                NULL::TEXT AS previous_currency,
                NULL::TEXT AS new_currency,
                NULL::TEXT AS source,
                cleanup.resolution_note AS action_note,
                cleanup.confirmed_by_owner,
                cleanup.resolved_at AS event_at,
                NULL::BIGINT AS superseded_by_management_data_id,
                NULL::TIMESTAMPTZ AS superseded_at,
                cleanup.kept_management_data_id,
                cleanup.superseded_management_data_ids,
                cleanup.original_rows
           FROM management_data_duplicate_resolution_history AS cleanup
          WHERE cleanup.owner_email = $1
            AND cleanup.business_key = $2
            AND cleanup.confirmed_by_owner = TRUE
            AND ($3::date IS NULL OR cleanup.data_date = $3::date)
            AND ($4::text IS NULL OR cleanup.metric_type = $4)
       )
       SELECT *
         FROM (
           SELECT * FROM registrations
           UNION ALL
           SELECT * FROM changes
           UNION ALL
           SELECT * FROM duplicate_resolutions
         ) AS audit_events
        WHERE ($5::text[] IS NULL OR event_type = ANY($5::text[]))
          AND ($7::date IS NULL OR event_at >= ($7::date::timestamp AT TIME ZONE 'Asia/Tokyo'))
          AND ($8::date IS NULL OR event_at < (($8::date + 1)::timestamp AT TIME ZONE 'Asia/Tokyo'))
        ORDER BY event_at DESC, event_type ASC, event_id DESC
        LIMIT $6`,
      [ownerEmail.trim(), query.businessKey.trim(), dataDate, metricType, eventTypeFilter, limit, safeAuditStartDate, safeAuditEndDate]
    );
    return result.rows || [];
  }

  async findRange(ownerEmail, query) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (!query?.businessKey || !query?.startDate || !query?.endDate) return [];
    const result = await this.pool.query(
      `SELECT DISTINCT ON (data_date, metric_type)
              id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
              confirmed_by_owner, created_at, updated_at
         FROM management_data
        WHERE owner_email = $1 AND business_key = $2
          AND data_date BETWEEN $3::date AND $4::date
          AND confirmed_by_owner = TRUE
          AND superseded_by_management_data_id IS NULL
        ORDER BY data_date, metric_type, updated_at DESC, created_at DESC, id DESC`,
      [ownerEmail.trim(), query.businessKey, query.startDate, query.endDate]
    );
    return result.rows || [];
  }
}

module.exports = { PostgresManagementDataRepository, normalizeEntry };
