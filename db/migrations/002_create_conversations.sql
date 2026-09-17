CREATE TABLE IF NOT EXISTS mirai_conversations (
  id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mirai_conversations_owner_updated_idx ON mirai_conversations (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS mirai_messages (
  id UUID PRIMARY KEY,
  sequence_no BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  conversation_id UUID NOT NULL REFERENCES mirai_conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mirai_messages_conversation_sequence_idx ON mirai_messages (conversation_id, sequence_no DESC);
