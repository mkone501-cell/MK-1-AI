ALTER TABLE management_data
  ADD COLUMN IF NOT EXISTS superseded_by_management_data_id BIGINT REFERENCES management_data(id);

ALTER TABLE management_data
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

ALTER TABLE management_data
  ADD COLUMN IF NOT EXISTS superseded_reason TEXT;

CREATE INDEX IF NOT EXISTS management_data_active_lookup_idx
  ON management_data (owner_email, business_key, data_date DESC, metric_type)
  WHERE confirmed_by_owner = TRUE AND superseded_by_management_data_id IS NULL;
