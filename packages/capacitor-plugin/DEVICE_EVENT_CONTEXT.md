# Native event context

Device events add optional `attemptId`, `nativeSdkVersion`, `phase`, and `lifecycle` fields. Tinybird stores the corresponding nullable snake_case columns; the recent-events API exposes the camelCase fields. Historical clients and rows remain valid with null context.

- An attempt ID is a fresh installation UUID allocated before ZIP download or delta assembly. Transport retries within that operation keep it; a later operation gets another ID. The bundle metadata's existing installation ID persists the association through readiness and restart rollback. Legacy bundle IDs are reported without an attempt ID. There is no persistent device identifier.
- Native SDK version is compiled into Java and Swift from the plugin package version. Package build/pack regenerates both sources; CI rejects version drift. It identifies the installed native implementation, unlike the SDK version recorded when a web release was uploaded.
- ZIP failure phases distinguish admission, transfer, integrity, decrypt, extract, install, and stage. Delta validation/download/assembly use `delta`; readiness and rollback events use their corresponding phases.
- Lifecycle is the state at event creation, not at eventual delivery. Android reports foreground after resume and background after pause, with unknown during initial loading. iOS reports active/foreground, inactive, or background.

Events remain bounded client reports. Missing events, cancellation, pre-event process death, queue limits, and cohorts crossing a time window still prevent a complete attempt-failure rate from being inferred from downloaded/applied totals. Deduplicate retries by `event_id`; group known attempts by `(app_id, attempt_id)` and keep legacy null IDs out of those cohorts.

## Deployment order

1. Add the four nullable columns to the production `device_events_raw` datasource using the reviewed Tinybird deployment workflow. Preserve data and the existing engine/TTL; do not recreate the datasource.
2. Deploy the ingest Worker normalization and the `app_events_recent` endpoint. Confirm old-format events still ingest and new context survives into raw rows.
3. Deploy the compatible console/API changes, then release the SDK and rebuild native apps. Old ingest versions ignore unknown fields, so shipping native code first would lose context.

No production deployment is performed by this PR. The Insights repository mirrors some Tinybird definitions; coordinate that mirror before deploying it later so it cannot remove these columns/endpoint fields. Existing aggregate metrics need no dimension changes and retain their event-ID deduplication.

Useful investigation dimensions are `native_sdk_version`, `phase`, `lifecycle`, `release_id`, and `attempt_id`. Treat field contents as untrusted diagnostics; no URL, key, file content, or user identifier is added by this context.
