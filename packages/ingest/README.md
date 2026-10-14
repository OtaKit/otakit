# @otakit/ingest

Cloudflare Worker for OtaKit event ingestion.

## What it does

- accepts plugin event writes at `POST /v1/events`
- accepts app telemetry batches (error tracking, plugin 3.4+) at `POST /v1/app-telemetry`
- validates and normalizes events at the edge
- rate-limits by `appId`
- enqueues accepted events into Cloudflare Queues
- batches NDJSON writes into Tinybird from the queue consumers

## Public endpoint

Hosted OtaKit should point the plugin at:

```text
https://ingest.otakit.app/v1
```

The write endpoint is:

```text
POST /v1/events
```

## Event contract

Headers:

- `X-App-Id`

JSON body:

- `eventId` (required UUID)
- `platform` (`ios` or `android`)
- `action` (`downloaded`, `applied`, `download_error`, `rollback`, `check_error`)
- `sentAt` (required ISO timestamp)
- `bundleVersion` (required except for `check_error`)
- `channel` (optional)
- `runtimeVersion` (optional)
- `releaseId` (required except for `check_error`)
- `nativeBuild` (required)
- `detail` (optional)
- `attemptId` (optional opaque installation ID, at most 64 safe characters)
- `nativeSdkVersion` (optional installed native SDK version)
- `phase` (optional operation phase)
- `lifecycle` (optional `foreground`, `background`, `inactive`, or `unknown`)

Optional context is stored in nullable Tinybird columns. Older clients remain valid.
Follow the additive schema-first [deployment order](../capacitor-plugin/DEVICE_EVENT_CONTEXT.md)
before publishing rebuilt native clients.

## App telemetry contract

`POST /v1/app-telemetry`, header `X-App-Id`, body at most 128 KB:

```json
{
  "batchId": "…",
  "sentAt": "2026-10-14T12:00:00.000Z",
  "context": {
    "platform": "ios",
    "sessionId": "<random UUID per app process>",
    "bundleVersion": "1.4.0",
    "releaseId": "…",
    "channel": "production",
    "runtimeVersion": "1.0",
    "nativeBuild": "42",
    "osVersion": "18.2",
    "sdkVersion": "3.4.0"
  },
  "items": [
    { "kind": "error", "eventId": "<UUID>", "name": "TypeError", "message": "…", "stack": "…" }
  ]
}
```

- At most 50 items. Invalid items, and kinds this Worker does not know, are dropped one by
  one; the rest are accepted. Errors are grouped here (`src/fingerprint.ts`), so grouping
  can improve without an app update.
- `404` for an app missing from the Upstash set `otakit:apps` (the console maintains it). Without
  Upstash, or before the set exists, every app is accepted.
- `202` with `accepted: false` when the workspace reached its monthly cap: the console sets
  `otakit:telemetry:blocked:<kind>:<appId>` until the end of the month.
- `429` over 2,000 requests per minute per app, `413` over 128 KB, `503` when the queue fails.

Rows go to the queue `otakit-app-telemetry`, whose consumer writes them to the Tinybird
datasource `app_errors_raw`.

## Wrangler bindings

The Worker expects:

- queue producer bindings: `EVENTS_QUEUE`, `APP_TELEMETRY_QUEUE` (optional: without it,
  `/v1/app-telemetry` answers `404` and devices drop their telemetry)
- rate limit bindings: `EVENTS_RATE_LIMITER`, `APP_TELEMETRY_RATE_LIMITER`
- vars:
  - `TINYBIRD_API_HOST`
  - `TINYBIRD_EVENTS_DATASOURCE`
  - `TINYBIRD_APP_ERRORS_DATASOURCE` (default `app_errors_raw`)
- secrets:
  - `TINYBIRD_EVENTS_TOKEN` (append access to both datasources)
  - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (optional; the same database as the
    console, for the app allowlist and caps)

Create the app telemetry queues once before deploying:

```bash
npx wrangler queues create otakit-app-telemetry
npx wrangler queues create otakit-app-telemetry-dlq
```

`packages/ingest/.env.example` documents the expected values. Configure
non-secret deploy vars in `wrangler.jsonc` and upload `TINYBIRD_EVENTS_TOKEN`
as a Worker secret.

Set the secret with:

```bash
cd packages/ingest
npx wrangler secret put TINYBIRD_EVENTS_TOKEN
```

`TINYBIRD_API_HOST` must match your Tinybird workspace region. Examples:

```text
https://api.tinybird.co
https://api.us-east.aws.tinybird.co
```

## Tinybird raw datasource

Recommended raw schema:

- `event_id` `String`
- `sent_at` `DateTime64(3)`
- `received_at` `DateTime64(3)`
- `app_id` `String`
- `platform` `LowCardinality(String)`
- `action` `LowCardinality(String)`
- `bundle_version` `String`
- `channel` `Nullable(String)`
- `runtime_version` `Nullable(String)`
- `release_id` `Nullable(String)`
- `native_build` `String`
- `detail` `Nullable(String)`

## Local commands

```bash
pnpm --filter @otakit/ingest typecheck
pnpm --filter @otakit/ingest build
pnpm --filter @otakit/ingest dev
```
