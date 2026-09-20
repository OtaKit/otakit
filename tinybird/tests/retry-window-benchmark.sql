-- Synthetic public-playground feasibility check only: one million distinct
-- downloaded IDs over 365 receipt days, plus 100,000 old IDs retried in August.
-- Expected August first-receipt count: 1,000,000 - 334 * 2,740 = 84,840.
-- This builds states in memory; it does not measure Tinybird storage scans,
-- production org cardinality/concurrency, endpoint limits, or billing sync.
WITH
    synthetic_receipts AS (
        SELECT
            toDate('2025-09-01') + toIntervalDay(intDiv(number, 2740)) AS bucket_date,
            toString(number) AS event_id
        FROM numbers(1000000)
        UNION ALL
        SELECT
            toDate('2026-08-31') AS bucket_date,
            toString(number) AS event_id
        FROM numbers(100000)
    ),
    synthetic_daily_states AS (
        SELECT
            bucket_date,
            uniqExactState(event_id) AS event_ids_uniq_exact_state
        FROM synthetic_receipts
        GROUP BY bucket_date
    )
SELECT
    uniqExactMerge(event_ids_uniq_exact_state)
      - uniqExactMergeIf(event_ids_uniq_exact_state, bucket_date < toDate('2026-08-01'))
        AS downloads_count
FROM synthetic_daily_states
WHERE bucket_date < toDate('2026-09-01')
FORMAT JSON
