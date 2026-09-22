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
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (!source || source.length > 500) return null;
  if (note.length > 2000) return null;

  return { businessKey, dataDate, metricType, amount, currency, note: note || null, source };
}

class PostgresManagementDataRepository {
  constructor(pool) {
    if (!pool?.query) throw new Error('database pool is required');
    this.pool = pool;
  }

  async create(ownerEmail, input) {
    if (typeof ownerEmail !== 'string' || !ownerEmail.trim()) throw new Error('owner email is required');
    const value = normalizeEntry(input);
    if (!value) return null;

    const result = await this.pool.query(
      `INSERT INTO management_data
        (owner_email, business_key, data_date, metric_type, amount, currency, note, source, confirmed_by_owner)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING id, owner_email, business_key, data_date, metric_type, amount, currency, note, source,
                 confirmed_by_owner, created_at, updated_at`,
      [ownerEmail.trim(), value.businessKey, value.dataDate, value.metricType, value.amount,
       value.currency, value.note, value.source]
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
        WHERE owner_email = $1
          AND business_key = $2
          AND data_date = $3::date
          AND metric_type = $4
          AND confirmed_by_owner = TRUE
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`,
      [ownerEmail.trim(), query.businessKey, query.dataDate, query.metricType]
    );
    return result.rows[0] || null;
  }
}

module.exports = { PostgresManagementDataRepository, normalizeEntry };
