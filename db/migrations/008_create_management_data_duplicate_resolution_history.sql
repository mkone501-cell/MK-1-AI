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

CREATE UNIQUE INDEX IF NOT EXISTS management_data_duplicate_resolution_history_event_uidx
  ON management_data_duplicate_resolution_history
     (owner_email, business_key, data_date, metric_type, kept_management_data_id, resolved_at);

WITH legacy_groups AS (
  SELECT owner_email,
         business_key,
         data_date,
         metric_type,
         superseded_by_management_data_id AS kept_management_data_id,
         superseded_at AS resolved_at,
         jsonb_agg(id ORDER BY id) AS superseded_management_data_ids
    FROM management_data
   WHERE superseded_by_management_data_id IS NOT NULL
     AND superseded_at IS NOT NULL
     AND superseded_reason = 'owner confirmed duplicate resolution'
   GROUP BY owner_email, business_key, data_date, metric_type,
            superseded_by_management_data_id, superseded_at
),
legacy_snapshots AS (
  SELECT groups.*,
         (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', snapshot.id::text,
                      'amount', snapshot.amount,
                      'currency', snapshot.currency,
                      'updated_at', snapshot.updated_at
                    )
                    ORDER BY snapshot.id
                  )
             FROM management_data AS snapshot
            WHERE snapshot.owner_email = groups.owner_email
              AND snapshot.business_key = groups.business_key
              AND snapshot.data_date = groups.data_date
              AND snapshot.metric_type = groups.metric_type
              AND (
                snapshot.id = groups.kept_management_data_id
                OR (
                  snapshot.superseded_by_management_data_id = groups.kept_management_data_id
                  AND snapshot.superseded_at = groups.resolved_at
                )
              )
         ) AS original_rows
    FROM legacy_groups AS groups
)
INSERT INTO management_data_duplicate_resolution_history
  (owner_email, business_key, data_date, metric_type,
   kept_management_data_id, superseded_management_data_ids, original_rows,
   confirmed_by_owner, resolution_note, resolved_at)
SELECT owner_email,
       business_key,
       data_date,
       metric_type,
       kept_management_data_id,
       superseded_management_data_ids,
       COALESCE(original_rows, '[]'::jsonb),
       TRUE,
       'backfilled from owner confirmed duplicate resolution',
       resolved_at
  FROM legacy_snapshots
ON CONFLICT DO NOTHING;
