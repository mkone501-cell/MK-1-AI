'use strict';

const { Pool } = require('pg');
const { SessionRepositoryContract } = require('./session-repository-contract');

function poolOptions(databaseUrl, { sslCa } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URLが未設定です。RailwayのMK-1-AI Variablesへ参照変数を設定してください。');
  let url;
  try { url = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URLの形式が正しくありません。'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password || !url.pathname || url.pathname === '/' || url.search) {
    throw new Error('DATABASE_URLの形式が正しくありません。');
  }
  const internal = url.hostname.endsWith('.railway.internal');
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    // Railway内部ネットワークはプライベート接続。外部接続はCA検証付きTLSを必須にします。
    ssl: internal ? false : { rejectUnauthorized: true, ...(sslCa ? { ca: sslCa } : {}) },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 5
  };
}

class PostgresSessionRepository extends SessionRepositoryContract {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async insert({ tokenHash, session }) {
    await this.pool.query(
      'INSERT INTO owner_sessions (token_hash, user_id, user_role, display_name, csrf_token, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [tokenHash, session.user.id, session.user.role, session.user.displayName, session.csrfToken, new Date(session.expiresAt)]
    );
  }

  async findByTokenHash(tokenHash) {
    const result = await this.pool.query('SELECT user_id, user_role, display_name, csrf_token, expires_at FROM owner_sessions WHERE token_hash = $1', [tokenHash]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      user: { id: row.user_id, role: row.user_role, displayName: row.display_name },
      csrfToken: row.csrf_token,
      expiresAt: new Date(row.expires_at).getTime()
    };
  }

  async deleteByTokenHash(tokenHash) {
    await this.pool.query('DELETE FROM owner_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async check() { await this.pool.query('SELECT 1'); }
  async close() { await this.pool.end(); }
}

function createPostgresSessionRepository(databaseUrl, options = {}) {
  const pool = new Pool(poolOptions(databaseUrl, options));
  pool.on('error', () => {
    // アイドル接続障害のイベントを処理し、接続文字列をログへ出しません。
    console.error('[database.connection_failed] PostgreSQLへの接続を確認してください。');
  });
  return new PostgresSessionRepository(pool);
}

module.exports = { PostgresSessionRepository, createPostgresSessionRepository, poolOptions };
