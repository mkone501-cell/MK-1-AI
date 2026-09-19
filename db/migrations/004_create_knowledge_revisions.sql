-- Private owner-scoped audit data; not served by the public frontend.
CREATE TABLE IF NOT EXISTS management_knowledge_revisions (
  id UUID PRIMARY KEY,
  knowledge_id UUID NOT NULL REFERENCES management_knowledge(id),
  owner_id TEXT NOT NULL,
  previous_value JSONB NOT NULL,
  next_value JSONB NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS management_knowledge_revisions_owner_idx
  ON management_knowledge_revisions (owner_id, knowledge_id, approved_at DESC);
