CREATE TABLE IF NOT EXISTS management_data_history (
  id BIGSERIAL PRIMARY KEY,
  management_data_id BIGINT NOT NULL REFERENCES management_data(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL,
  business_key TEXT NOT NULL,
  data_date DATE NOT NULL,
  metric_type TEXT NOT NULL,
  previous_amount NUMERIC(18,2) NOT NULL,
  new_amount NUMERIC(18,2) NOT NULL,
  previous_currency VARCHAR(8) NOT NULL,
  new_currency VARCHAR(8) NOT NULL,
  source TEXT NOT NULL,
  change_note TEXT,
  confirmed_by_owner BOOLEAN NOT NULL DEFAULT TRUE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS management_data_history_entry_changed_idx
  ON management_data_history (management_data_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS management_data_history_owner_business_date_idx
  ON management_data_history (owner_email, business_key, data_date DESC, changed_at DESC);
