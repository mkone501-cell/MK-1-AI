'use strict';

const { randomUUID } = require('node:crypto');
const { searchPatterns, rankKnowledge, MAX_CANDIDATES } = require('./retrieval');

const fields = 'id, category, title, body, source, active, created_at, updated_at';
function item(row) {
  return row && { id:row.id, category:row.category, title:row.title, body:row.body, source:row.source,
    active:row.active, createdAt:row.created_at, updatedAt:row.updated_at };
}

class PostgresKnowledgeRepository {
  constructor(pool) { this.pool = pool; }

  async create(ownerId, value) {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO management_knowledge (id, owner_id, category, title, body, source)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${fields}`,
      [id, ownerId, value.category, value.title, value.body, value.source]
    );
    return item(result.rows[0]);
  }

  async list(ownerId) {
    const result = await this.pool.query(
      `SELECT ${fields} FROM management_knowledge WHERE owner_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2`,
      [ownerId, 100]
    );
    return result.rows.map(item);
  }

  async get(ownerId, id) {
    const result = await this.pool.query(`SELECT ${fields} FROM management_knowledge WHERE owner_id = $1 AND id = $2`, [ownerId, id]);
    return item(result.rows[0]) || null;
  }

  async update(ownerId, id, value) {
    const result = await this.pool.query(
      `UPDATE management_knowledge SET category = $3, title = $4, body = $5, source = $6, updated_at = NOW()
       WHERE owner_id = $1 AND id = $2 AND active = TRUE RETURNING ${fields}`,
      [ownerId, id, value.category, value.title, value.body, value.source]
    );
    return item(result.rows[0]) || null;
  }

  async disable(ownerId, id) {
    const result = await this.pool.query(
      `UPDATE management_knowledge SET active = FALSE, updated_at = NOW()
       WHERE owner_id = $1 AND id = $2 AND active = TRUE RETURNING ${fields}`,
      [ownerId, id]
    );
    return item(result.rows[0]) || null;
  }

  async relevant(ownerId, question) {
    const patterns = searchPatterns(question);
    if (!patterns.length) return [];
    const result = await this.pool.query(
      `SELECT ${fields} FROM management_knowledge
       WHERE owner_id = $1 AND active = TRUE
       AND (title ILIKE ANY($2::text[]) OR category ILIKE ANY($2::text[]) OR body ILIKE ANY($2::text[]))
       ORDER BY CASE WHEN title ILIKE ANY($2::text[]) THEN 0 ELSE 1 END,
         updated_at DESC, id DESC LIMIT $3`,
      [ownerId, patterns, MAX_CANDIDATES]
    );
    return rankKnowledge(result.rows.map(item), question);
  }
}

module.exports = { PostgresKnowledgeRepository };
