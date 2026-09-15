-- PostgreSQL向けの将来用スキーマ例。Phase 3では実DBへ接続しません。
CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  display_name TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS owner_sessions_expires_at_idx ON owner_sessions (expires_at);
