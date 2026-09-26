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
        ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
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
        ORDER BY metric_type, updated_at DESC, created_at DESC`,
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
      `SELECT id, management_data_id, owner_email, business_key, data_date, metric_type,
              previous_amount, new_amount, previous_currency, new_currency,
              source, change_note, confirmed_by_owner, changed_at
         FROM management_data_history
        WHERE owner_email = $1 AND data_date = $2::date AND metric_type = $3
          AND confirmed_by_owner = TRUE${businessClause}
        ORDER BY changed_at ASC, id ASC
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
        ORDER BY data_date ASC, metric_type ASC, updated_at ASC, id ASC`,
      [ownerEmail.trim(), businessKey.trim()]
    );
    return result.rows || [];
  }
  async findBusinessHistory(ownerEmail, businessKey) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    if (typeof businessKey !== 'string' || !businessKey.trim()) return [];
    const result = await this.pool.query(
      `SELECT id, management_data_id, owner_email, business_key, data_date, metric_type,
              previous_amount, new_amount, previous_currency, new_currency,
              source, change_note, confirmed_by_owner, changed_at
         FROM management_data_history
        WHERE owner_email = $1 AND business_key = $2
          AND confirmed_by_owner = TRUE
        ORDER BY data_date ASC, metric_type ASC, changed_at ASC, id ASC`,
      [ownerEmail.trim(), businessKey.trim()]
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
        ORDER BY data_date, metric_type, updated_at DESC, created_at DESC`,
      [ownerEmail.trim(), query.businessKey, query.startDate, query.endDate]
    );
    return result.rows || [];
  }
}

module.exports = { PostgresManagementDataRepository, normalizeEntry };
