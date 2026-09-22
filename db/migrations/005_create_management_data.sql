CREATE TABLE IF NOT EXISTS management_data (
  id BIGSERIAL PRIMARY KEY,
  owner_email TEXT NOT NULL,
  business_key TEXT NOT NULL,
  data_date DATE NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('revenue','expense','profit','cash_balance','customers','average_spend','other')),
  amount NUMERIC(18,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'JPY',
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


-- Existing installations created before customer metrics were introduced need their CHECK constraint widened.
DO $$
DECLARE constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'management_data'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%metric_type%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE management_data DROP CONSTRAINT %I', constraint_name);
  END IF;
  ALTER TABLE management_data
    ADD CONSTRAINT management_data_metric_type_check
    CHECK (metric_type IN ('revenue','expense','profit','cash_balance','customers','average_spend','other'));
END $$;

-- Customer counts use COUNT instead of a three-letter currency code.
-- Widen existing installations safely; JPY and other existing values are preserved.
ALTER TABLE management_data
  ALTER COLUMN currency TYPE VARCHAR(8) USING BTRIM(currency);
