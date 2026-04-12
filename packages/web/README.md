# @otakit/web

Next.js app for the OtaKit control plane.

This package contains:

- the hosted dashboard UI
- auth and organization management
- bundle upload and release APIs
- manifest materialization and public update delivery
- billing, docs, and operational endpoints

## What lives here

- landing page and docs
- dashboard, login, organizations, members, invites, and API keys
- bundle upload, finalize, release, revert, events, and manifest publishing
- billing and usage enforcement
- admin and webhook endpoints

## Core models

The main server-side models are:

- `Organization`
- `OrganizationMember`
- `OrganizationInvite`
- `OrganizationApiKey`
- `App`
- `Bundle`
- `Release`
- `UploadSession`
- `DeviceEvent`

## Main flows

### Upload

1. create upload session
2. return presigned object-storage upload URL
3. finalize into a `Bundle`

### Release

1. choose a bundle
2. create append-only `Release`
3. newest non-reverted release per `(appId, channel, runtimeVersion)` becomes current

### Manifest

1. resolve the current non-reverted release for each `(appId, channel, runtimeVersion)` lane
2. build a signed static manifest JSON object
3. write it to R2 at a deterministic CDN path
4. purge the exact CDN URL on publish, revert, or billing changes
5. let the plugin fetch that lane manifest directly from the CDN and compare locally

### Compatibility model

- `channel` is the rollout track
- `runtimeVersion` is the native compatibility lane
- bundles inherit `runtimeVersion` at upload time
- releases do not pick compatibility separately; they publish the bundle that was already tagged

### Usage

- usage snapshots are stored on the organization row
- a cron job still aggregates across all orgs
- opening settings also refreshes and persists the current org snapshot
- the settings refresh does not send warning emails or sync Polar usage

## Run locally

From repo root:

```bash
pnpm dev
```

Or directly:

```bash
pnpm --filter @otakit/web dev
```

Useful commands:

```bash
pnpm --filter @otakit/web build
pnpm --filter @otakit/web typecheck
pnpm --filter @otakit/web db:generate
pnpm --filter @otakit/web db:push
pnpm --filter @otakit/web db:migrate
pnpm --filter @otakit/web db:studio
```

## Important env areas

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `R2_BUCKET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_ENDPOINT`
- `CDN_BASE_URL`, `CF_ZONE_ID`, `CF_API_TOKEN`
- `MANIFEST_SIGNING_KID`, `MANIFEST_SIGNING_KEY`
- optional `MANIFEST_SIGNING_DISABLED`
- `POLAR_*`
- optional `ADMIN_SECRET_KEY`

## Cache

- manifest reads are served as static CDN objects from R2
- bundle objects are served from public immutable CDN URLs
- explicit CDN purge happens on release creation, revert, bundle delete, and manifest lifecycle changes

## Product shape

- hosted SaaS is the primary path
- self-hosting is the advanced path
- public docs live in `app/docs`
