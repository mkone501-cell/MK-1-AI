-- Phase 4.1: 初回起動時または npm run db:migrate で安全に適用します。
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
