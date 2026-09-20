# Tinybird resources

This folder contains the Tinybird resources used by OtaKit device-event
analytics. It is mainly relevant for advanced self-hosted setups.

## Resources

- `datasources/device_events_raw.datasource`
- `datasources/device_event_daily_counts.datasource`
- `materializations/device_event_daily_counts_mv.pipe`
- `endpoints/app_events_recent.pipe`
- `endpoints/release_event_counts.pipe`
- `endpoints/release_health_window.pipe`
- `endpoints/bundle_event_counts.pipe`
- `endpoints/organization_download_counts.pipe`

## Required names

The web app and ingest service expect these resource names:

- datasources:
  - `device_events_raw`
  - `device_event_daily_counts`
- endpoints:
  - `app_events_recent`
  - `release_event_counts`
  - `release_health_window`
  - `bundle_event_counts`
  - `organization_download_counts`

## Event schema requirements

- `sent_at` is required
- `bundle_version` is required for delivery actions; `check_error` may use an empty value
- `native_build` is required
- `runtime_version` is optional
- `release_id` is required for delivery actions; `check_error` may use null
- billing and dashboard time windows are based on `received_at`
- billing uses exact dedupe:
  - `uniqExactState(event_id)`
  - `uniqExactMerge(event_ids_uniq_exact_state)`

## Retry identities and time windows

Native delivery retries reuse `event_id`. The organization download endpoint
attributes an ID to its earliest recorded `received_at` billing day: it merges
all downloaded IDs before the exclusive end, then subtracts the merged IDs
before the inclusive start. A retry in a later billing period therefore does
not count again. Daily aggregate states retain these identities after raw
receipts expire. Client `sent_at` does not control billing attribution.

This query scans lifetime aggregate IDs before the requested end. Benchmark
mature organizations and concurrent endpoint load in the target Tinybird
workspace before deploying it. The synthetic feasibility result in
[validation notes](RETRY_WINDOW_VALIDATION.md)
is not a production capacity measurement.

An earlier receipt ingested late can move an ID into a prior period and lower
the current-period result. Existing Polar usage synchronization does not
reconcile decreases that were already reported. These query changes do not
change billing APIs, settings, or reconciliation policy and do not guarantee
exactly-once billing.

Release health groups applied/rollback identities by their earliest retained
receipt before applying its rolling window. The recent-event timeline likewise
keeps one earliest row per ID before applying its date, optional filters, order,
and limit. Both raw queries are bounded by the raw datasource's 90-day retention:
a retry whose original receipt has expired can appear new. They do not infer
an event's original receipt from its client clock.
