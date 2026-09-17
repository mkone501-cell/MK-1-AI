CREATE TABLE IF NOT EXISTS management_knowledge (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS management_knowledge_owner_active_updated_idx
  ON management_knowledge (owner_id, active, updated_at DESC);
