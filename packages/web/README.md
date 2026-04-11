# @otakit/web

Next.js app for the OtaKit control plane.

This package contains:

- the hosted dashboard UI
- auth and organization management
- bundle upload and release APIs
- public update endpoints used by the plugin
- billing, docs, and operational endpoints

## What lives here

- landing page and docs
- dashboard, login, organizations, members, invites, and API keys
- bundle upload, finalize, release, revert, events, and manifest APIs
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

1. resolve the latest non-reverted release for the app + channel + runtimeVersion
2. compare against the device's current version
3. mint a fresh download URL
4. sign the manifest
5. return update metadata to the plugin

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
- `MANIFEST_SIGNING_KID`, `MANIFEST_SIGNING_KEY`
- optional `MANIFEST_SIGNING_DISABLED`
- `POLAR_*`
- optional `ADMIN_SECRET_KEY`

## Cache

- manifest lookup supports an optional Upstash Redis cache
- only stable manifest descriptor data is cached
- download URLs and manifest signatures are generated fresh on every request
- cache invalidation happens on release creation and usage-block changes

## Product shape

- hosted SaaS is the primary path
- self-hosting is the advanced path
- public docs live in `app/docs`
