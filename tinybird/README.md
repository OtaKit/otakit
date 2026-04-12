# Tinybird resources

This folder contains the Tinybird resources used by OtaKit device-event
analytics. It is mainly relevant for advanced self-hosted setups.

## Resources

- `datasources/device_events_raw.datasource`
- `datasources/device_event_daily_counts.datasource`
- `materializations/device_event_daily_counts_mv.pipe`
- `endpoints/app_events_recent.pipe`
- `endpoints/release_event_counts.pipe`
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
  - `bundle_event_counts`
  - `organization_download_counts`

## Event schema requirements

- `sent_at` is required
- `bundle_version` is required
- `native_build` is required
- `runtime_version` is optional
- `release_id` is required at ingest time
- billing and dashboard time windows are based on `received_at`
- billing uses exact dedupe:
  - `uniqExactState(event_id)`
  - `uniqExactMerge(event_ids_uniq_exact_state)`
