# OtaKit

Fully open-source, self-hostable over-the-air update framework for Capacitor apps. Release updates directly to your Capacitor app without app store reviews.

Try it for free: [OtaKit.app](https://www.otakit.app/)

## How it works

1. Create an app in the dashboard.
2. Copy its `appId` into `capacitor.config.*`.
3. Build the app's web assets.
4. Run `otakit upload --release` to upload the bundle and publish a release.
5. The server writes the bundle and manifest to object storage behind the CDN.
6. On the next app launch or resume, the plugin fetches the manifest from the CDN, compares it to the current bundle, and downloads the new version if available.
7. If `notifyAppReady()` is called within the timeout, the new bundle is confirmed. Otherwise the plugin rolls back to the previous bundle automatically.

## Core concepts

- **App** — the Capacitor app identified by its `appId`
- **Bundle** — one uploaded web build zip with a version, hash, and size
- **Release** — a promotion of a bundle to a channel, which publishes a manifest to the CDN
- **Channel** — an optional release track such as `staging`
- **Runtime version** — an optional native compatibility lane configured in the plugin

## Packages

- `packages/capacitor-plugin` — the runtime that lives inside the mobile app
- `packages/cli` — CLI for uploading bundles and creating releases
- `packages/site` — public site, docs, contact, legal pages
- `packages/console` — dashboard, API, auth, billing, and Prisma schema
- `packages/ingest` — Cloudflare Worker for device event ingestion
- `tinybird/` — Tinybird datasources and pipes for event analytics

```text
packages/
  capacitor-plugin/   Capacitor OTA plugin
  cli/                Upload + release CLI
  ingest/             Cloudflare Worker event ingest service
  site/               Next.js public site + docs
  console/            Next.js dashboard + API + auth + billing
tinybird/             Tinybird event analytics project
examples/
  demo-app/           Demo Capacitor app wired to the local plugin
```

## Package docs

- [`packages/capacitor-plugin/README.md`](packages/capacitor-plugin/README.md)
- [`packages/cli/README.md`](packages/cli/README.md)
- [`packages/ingest/README.md`](packages/ingest/README.md)
- [`packages/site/README.md`](packages/site/README.md)
- [`packages/console/README.md`](packages/console/README.md)
- [`tinybird/README.md`](tinybird/README.md)

## Local development

- Node.js 20.9+, pnpm 9+
- The console app (`packages/console`) requires Postgres and R2-compatible storage. See [`packages/console/.env.example`](packages/console/.env.example).
- Device event analytics optionally require the ingest service (`packages/ingest`) and a Tinybird workspace.
- See each package README for setup details.

```bash
pnpm install
pnpm dev        # starts the console app in dev mode
```

## License

MIT
