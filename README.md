# OtaKit

Fully open-source, self-hostable OTA update framework for Capacitor apps.

This repo has four main pieces:

- `packages/capacitor-plugin`: the runtime that lives inside the mobile app
- `packages/cli`: the publishing CLI used locally and in CI
- `packages/web`: the managed control plane, dashboard, auth, billing, and docs app
- `packages/ingest`: the Cloudflare Worker event ingest service

Try it for free: [OtaKit.app](https://www.otakit.app/)

## Core concepts

- `App`
  the OTA identity configured in `plugins.OtaKit.appId`
- `Bundle`
  one uploaded web build zip with a version, hash, and size
- `Release`
  an append-only promotion of a bundle to the unnamed channel or a named channel
- `Channel`
  a release track such as the unnamed default path or `staging`
- `Runtime version`
  an optional native compatibility lane configured in `plugins.OtaKit.runtimeVersion`

## Managed flow

1. Create an organization and app in the dashboard.
2. Put the returned `appId` into `plugins.OtaKit` in `capacitor.config.*`.
3. Build the app web assets.
4. Run `otakit upload --release`.
5. Let the server publish the signed lane manifest to object storage behind the CDN, then let the plugin fetch it, compare it against the current or staged bundle locally, download only if it is newer, activate it, and wait for `notifyAppReady()`.

## How it works

1. The CLI uploads a build and creates a `Bundle`.
2. Releasing that bundle creates a `Release` for one channel.
3. The server materializes the current lane manifest into object storage and serves it through the CDN.
4. The plugin fetches that manifest, verifies it, compares it against the current and staged bundle locally, and only downloads when it actually points at something newer.
5. The app confirms the new bundle with `notifyAppReady()`, or the plugin rolls back automatically.

## Workspace layout

```text
packages/
  capacitor-plugin/   Capacitor OTA plugin
  cli/                Upload + release CLI
  ingest/             Cloudflare Worker event ingest service
  web/                Next.js control plane, dashboard, API, auth, billing, docs
examples/
  demo-app/           Demo Capacitor app wired to the local plugin
```

## Package docs

- [`packages/capacitor-plugin/README.md`](packages/capacitor-plugin/README.md)
- [`packages/cli/README.md`](packages/cli/README.md)
- [`packages/ingest/README.md`](packages/ingest/README.md)
- [`packages/web/README.md`](packages/web/README.md)
- [`tinybird/README.md`](tinybird/README.md)
- [`examples/demo-app/README.md`](examples/demo-app/README.md)

## Product shape

- Hosted SaaS is the default path.
- The dashboard is the normal app-creation flow.
- `capacitor.config.*` is the source of truth for plugin and CLI project config.
- There is no `otakit init`.
- The default release path is the unnamed channel.
- Channels are rollout tracks. `runtimeVersion` is the optional compatibility lane.
- Optionally set `runtimeVersion` when a new store build must stop receiving older OTA bundles.
- Self-hosting exists, but it is the advanced path.
- Uploads and releases are separate: you can upload first and promote later.

## Local development

Requirements:

- Node.js 20.9+
- pnpm 9+

Install and run:

```bash
pnpm install
pnpm dev
```

Useful commands:

```bash
pnpm --filter @otakit/web dev
pnpm --filter @otakit/cli build
pnpm --filter @otakit/capacitor-updater build
```

The public docs live in `packages/web/app/docs` and are served by the web app.

## Verification

The repo-level verification command is:

```bash
npm run build
```

For native demo app verification:

- iOS: `pnpm exec cap sync && xcodebuild ...`
- Android: `pnpm exec cap sync && ./gradlew assembleDebug`

## License

MIT
