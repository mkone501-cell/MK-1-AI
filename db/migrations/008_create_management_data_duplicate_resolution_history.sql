CREATE TABLE IF NOT EXISTS management_data_duplicate_resolution_history (
  id BIGSERIAL PRIMARY KEY,
  owner_email TEXT NOT NULL,
  business_key VARCHAR(120) NOT NULL,
  data_date DATE NOT NULL,
  metric_type VARCHAR(40) NOT NULL,
  kept_management_data_id BIGINT NOT NULL REFERENCES management_data(id),
  superseded_management_data_ids JSONB NOT NULL,
  original_rows JSONB NOT NULL,
  confirmed_by_owner BOOLEAN NOT NULL DEFAULT TRUE,
  resolution_note TEXT NOT NULL DEFAULT 'owner confirmed duplicate resolution',
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS management_data_duplicate_resolution_history_owner_business_idx
  ON management_data_duplicate_resolution_history (owner_email, business_key, resolved_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS management_data_duplicate_resolution_history_target_idx
  ON management_data_duplicate_resolution_history (owner_email, business_key, data_date, metric_type, resolved_at DESC, id DESC);
