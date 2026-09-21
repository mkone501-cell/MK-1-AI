CREATE TABLE IF NOT EXISTS management_data (
  id BIGSERIAL PRIMARY KEY,
  owner_email TEXT NOT NULL,
  business_key TEXT NOT NULL,
  data_date DATE NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('revenue','expense','profit','cash_balance','other')),
  amount NUMERIC(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'JPY',
  note TEXT,
  source TEXT NOT NULL,
  confirmed_by_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS management_data_owner_business_date_idx
  ON management_data (owner_email, business_key, data_date DESC);

CREATE INDEX IF NOT EXISTS management_data_metric_idx
  ON management_data (owner_email, metric_type, data_date DESC);
