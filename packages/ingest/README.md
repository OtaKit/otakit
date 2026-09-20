# @otakit/ingest

Cloudflare Worker for OtaKit event ingestion.

## What it does

- accepts plugin event writes at `POST /v1/events`
- validates and normalizes events at the edge
- rate-limits by `appId`
- enqueues accepted events into Cloudflare Queues
- batches NDJSON writes into Tinybird from the queue consumer

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

## Wrangler bindings

The Worker expects:

- queue producer binding: `EVENTS_QUEUE`
- rate limit binding: `EVENTS_RATE_LIMITER`
- vars:
  - `TINYBIRD_API_HOST`
  - `TINYBIRD_EVENTS_DATASOURCE`
- secret:
  - `TINYBIRD_EVENTS_TOKEN`

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
