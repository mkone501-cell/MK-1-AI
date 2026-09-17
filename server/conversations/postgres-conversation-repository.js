'use strict';

const { randomUUID } = require('node:crypto');

const CONTEXT_LIMIT = 12;
const MESSAGE_LIMIT = 100;
const CONVERSATION_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PostgresConversationRepository {
  constructor(pool) { this.pool = pool; }

  async list(ownerId) {
    const result = await this.pool.query(
      'SELECT id, created_at, updated_at FROM mirai_conversations WHERE owner_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2',
      [ownerId, CONVERSATION_LIMIT]
    );
    return result.rows.map(row => ({ id:row.id, createdAt:row.created_at, updatedAt:row.updated_at }));
  }

  async messages(ownerId, conversationId, limit = MESSAGE_LIMIT) {
    const result = await this.pool.query(
      `SELECT m.id, m.role, m.content, m.created_at FROM mirai_messages m
       JOIN mirai_conversations c ON c.id = m.conversation_id
       WHERE c.id = $1 AND c.owner_id = $2
       ORDER BY m.sequence_no DESC LIMIT $3`,
      [conversationId, ownerId, Math.min(limit, MESSAGE_LIMIT)]
    );
    return result.rows.reverse().map(row => ({ id:row.id, role:row.role, content:row.content, createdAt:row.created_at }));
  }

  async exists(ownerId, conversationId) {
    const result = await this.pool.query('SELECT id FROM mirai_conversations WHERE id = $1 AND owner_id = $2', [conversationId, ownerId]);
    return result.rows.length > 0;
  }

  async context(ownerId, conversationId) {
    if (!await this.exists(ownerId, conversationId)) return null;
    return (await this.messages(ownerId, conversationId, CONTEXT_LIMIT)).map(item => ({ role:item.role, content:item.content.slice(0, 4000) }));
  }

  async appendExchange({ ownerId, conversationId, message, answer }) {
    const client = await this.pool.connect();
    const id = conversationId || randomUUID();
    try {
      await client.query('BEGIN');
      if (conversationId) {
        const found = await client.query('SELECT id FROM mirai_conversations WHERE id = $1 AND owner_id = $2 FOR UPDATE', [id, ownerId]);
        if (!found.rows.length) { const error = new Error('conversation unavailable'); error.code = 'CONVERSATION_NOT_FOUND'; throw error; }
      } else {
        await client.query('INSERT INTO mirai_conversations (id, owner_id) VALUES ($1, $2)', [id, ownerId]);
      }
      await client.query('INSERT INTO mirai_messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)', [randomUUID(), id, 'user', message]);
      await client.query('INSERT INTO mirai_messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)', [randomUUID(), id, 'assistant', answer]);
      await client.query('UPDATE mirai_conversations SET updated_at = NOW() WHERE id = $1 AND owner_id = $2', [id, ownerId]);
      await client.query('COMMIT');
      return id;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* No sensitive DB error details in logs. */ }
      throw error;
    } finally { client.release(); }
  }
}

module.exports = { PostgresConversationRepository, UUID, CONTEXT_LIMIT };
