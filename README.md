# OtaKit

Fully open-source, self-hostable over-the-air update framework for Capacitor apps. Release updates directly to your Capacitor app without app store reviews.

Try it for free: [OtaKit.app](https://www.otakit.app/)

## Self-hosting

OtaKit is hosted-first — the managed service at [otakit.app](https://www.otakit.app/) runs everything for you — but the entire platform is in this repo and can run on your own infrastructure. The minimal stack is the console (a standard Next.js app), Postgres, and an S3-compatible bucket behind a CDN.

Full step-by-step guide: [otakit.app/docs/self-host](https://www.otakit.app/docs/self-host)

## How it works

1. Create an app in the dashboard.
2. Copy its `appId` into `capacitor.config.*`.
3. Build the app's web assets.
4. Run `otakit upload --release` to upload the bundle and publish a release.
5. The server writes the bundle and manifest to object storage behind the CDN.
6. On the next app launch or resume, the plugin fetches the manifest from the CDN, compares it to the current bundle, and downloads the new version if available.
7. If `notifyAppReady()` is called within the timeout, the new bundle is confirmed. Otherwise the plugin rolls back to the previous bundle automatically.

## MCP & Agent Skills

OtaKit connects Codex, Claude Code, VS Code, and other coding agents through local and remote MCP, guided by an open Agent Skill and the same release workflow used by the CLI and dashboard.

Claude Code users can install the official plugin, which includes the OtaKit Agent Skill and the full-scope remote MCP connection:

```bash
claude plugin marketplace add OtaKit/otakit
claude plugin install otakit@otakit
```

For repository-aware inspection and uploads, connect the local server from the Capacitor project:

```bash
npx -y @otakit/cli@latest login
claude mcp add --transport stdio --scope project otakit-local -- \
  npx -y @otakit/cli@latest mcp --project-root '${CLAUDE_PROJECT_DIR:-.}'
```

See the [MCP and Agent Skills guide](https://otakit.app/docs/agents) for Codex, Claude Code, remote OAuth, permissions, workflows, and self-hosting.

## Core concepts

- **App** — the Capacitor app identified by its `appId`
- **Bundle** — one uploaded web build zip with a version, hash, and size
- **Release** — a promotion of a bundle to a channel, which publishes a manifest to the CDN
- **Channel** — an optional release track such as `staging`
- **Runtime version** — an optional native compatibility lane configured in the plugin

## Packages

- `packages/capacitor-plugin` — the runtime that lives inside the mobile app
- `packages/cli` — CLI for uploading bundles and creating releases
- `packages/mcp-core` — shared MCP contracts, tool catalog, and server registration
- `packages/site` — public site, docs, contact, legal pages
- `packages/console` — dashboard, API, auth, billing, and Prisma schema
- `packages/ingest` — Cloudflare Worker for device event ingestion
- `tinybird/` — Tinybird datasources and pipes for event analytics

```text
packages/
  capacitor-plugin/   Capacitor OTA plugin
  cli/                Upload + release CLI
  mcp-core/           Shared MCP contracts and tool catalog
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
