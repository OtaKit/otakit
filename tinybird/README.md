# Tinybird resources

This folder contains the Tinybird resources used by OtaKit device-event
analytics and error tracking. It is mainly relevant for advanced self-hosted setups.

## Resources

- `datasources/device_events_raw.datasource`
- `datasources/device_event_daily_counts.datasource`
- `materializations/device_event_daily_counts_mv.pipe`
- `endpoints/app_events_recent.pipe`
- `endpoints/release_event_counts.pipe`
- `endpoints/release_health_window.pipe`
- `endpoints/release_event_timeseries.pipe`
- `endpoints/bundle_event_counts.pipe`
- `endpoints/organization_download_counts.pipe`
- `datasources/app_errors_raw.datasource`
- `datasources/app_error_daily.datasource`
- `materializations/app_error_daily_mv.pipe`
- `endpoints/error_activity.pipe`
- `endpoints/error_groups.pipe`
- `endpoints/error_group_samples.pipe`
- `endpoints/error_group_breakdown.pipe`
- `endpoints/error_group_buckets.pipe`
- `endpoints/release_error_counts.pipe`
- `endpoints/error_issue_releases.pipe`
- `endpoints/release_capable_applies.pipe`
- `endpoints/app_error_usage.pipe`
- `datasources/app_events_raw.datasource`
- `datasources/app_event_hourly.datasource`
- `materializations/app_event_hourly_mv.pipe`
- `endpoints/app_event_names.pipe`
- `endpoints/app_event_timeseries.pipe`
- `endpoints/app_event_breakdown.pipe`
- `endpoints/app_event_release_comparison.pipe`
- `endpoints/app_events_live.pipe`
- `endpoints/app_event_usage.pipe`

## Required names

The web app and ingest service expect these resource names:

- datasources:
  - `device_events_raw`
  - `device_event_daily_counts`
  - `app_errors_raw`
  - `app_error_daily`
  - `app_events_raw`
  - `app_event_hourly`
- endpoints:
  - `app_events_recent`
  - `release_event_counts`
  - `release_health_window`
  - `release_event_timeseries`
  - `bundle_event_counts`
  - `organization_download_counts`
  - `error_activity`, `error_groups`, `error_group_samples`, `error_group_breakdown`,
    `error_group_buckets`, `error_issue_releases`, `release_error_counts`,
    `release_capable_applies`, `app_error_usage`
  - `app_event_names`, `app_event_timeseries`, `app_event_breakdown`,
    `app_event_release_comparison`, `app_events_live`, `app_event_usage`

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

Release health and the release timeseries group identities by their earliest
retained receipt before applying their time window and buckets. The recent-event timeline likewise
keeps one earliest row per ID before applying its date, optional filters, order,
and limit. Both raw queries are bounded by the raw datasource's 90-day retention:
a retry whose original receipt has expired can appear new. They do not infer
an event's original receipt from its client clock.

## App errors

Error tracking (plugin 3.4+) writes one row per captured error to `app_errors_raw`
(30 days). The ingest Worker computes `fingerprint`, the issue an error belongs to.
`app_error_daily` keeps per-issue daily counts for 180 days, for release error rates,
monthly caps and the issue list's lifetime totals. Device retries can repeat an
`event_id`: every count uses `uniqExact(event_id)`. Hourly and daily buckets count a
retry received in another bucket in both; totals do not.

Error rates per 1,000 applies (`release_capable_applies`) count only applies from
devices whose native plugin can report errors (3.4+, from `native_sdk_version`), so a
release is not compared against devices that could not have reported anything.

## Custom events

`OtaKit.track()` (plugin 3.4+) writes one row per event to `app_events_raw` (90 days), with
its properties as a JSON object of string values. `app_event_hourly` keeps unique events and
unique sessions (app launches) per hour, name, release, channel and platform for 13 months.
`$session_start`, sent once per app launch by `initAnalytics()`, is the denominator of
per-session rates in `app_event_release_comparison`.

