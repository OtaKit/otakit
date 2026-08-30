# @otakit/cli

<!-- mcp-name: io.github.otakit/otakit -->

Upload and release CLI for OtaKit.

## What it does

- reads project config from `capacitor.config.*`
- authenticates with login or env tokens
- zips the build output
- computes the bundle SHA-256 checksum
- creates an upload session
- uploads the zip directly to object storage
- finalizes the bundle
- optionally releases it to the unnamed channel or a named channel

The normal hosted flow is dashboard-first. Create the app in the dashboard,
paste its `appId` into `plugins.OtaKit.appId`, then ship:

```bash
otakit login
npm run build
otakit upload --release
```

If you want to create the app from the CLI instead:

```bash
otakit register --slug com.example.app
```

There is no `otakit init`.

## Config model

The CLI reads these files when present:

- `capacitor.config.ts`
- `capacitor.config.js`
- `capacitor.config.mjs`
- `capacitor.config.cjs`
- `capacitor.config.json`

Important values:

```ts
webDir: "out",
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    // Optional:
    // channel: "staging",
    // serverUrl: "https://your-server.com/api/v1"
  }
}
```

Resolution order:

1. CLI flags
2. environment variables
3. `capacitor.config.*`
4. built-in defaults

Main rules:

1. `appId`: `--app-id` -> `OTAKIT_APP_ID` -> `plugins.OtaKit.appId`
2. `serverUrl`: `--server` -> `OTAKIT_SERVER_URL` -> `plugins.OtaKit.serverUrl` -> `https://console.otakit.app`
3. `outputDir`: upload path arg -> `OTAKIT_BUILD_DIR` / `OTAKIT_OUTPUT_DIR` -> `webDir`
4. release channel: `--release` -> unnamed channel, `--release <channel>` -> named channel

Auth precedence:

1. `OTAKIT_TOKEN`
2. stored token from `otakit login`

Version precedence:

1. `--version`
2. `OTAKIT_VERSION`
3. auto-generated `<base>+otk.<commit>.<run>`

## Release model

- `otakit upload`
  upload only
- `otakit upload --release`
  upload and release to the unnamed channel
- `otakit upload --release staging`
  upload and release to a named channel
- `otakit release <bundleId> --channel staging`
  promote an existing bundle later

Releases are append-only. The newest release for
`(appId, channel, runtimeVersion)` is what devices see on manifest checks.

## Common commands

- `otakit login`
- `otakit logout`
- `otakit whoami`
- `otakit register --slug <slug>`
- `otakit upload [path] [--release [channel]]`
- `otakit upload --release --auto-revert [--auto-revert-rate <1-95>] [--auto-revert-min-sample <10-100000>]` — server reverts the release if too many devices roll back within 24h (defaults: 20% of ≥50)
- `otakit release [bundleId] [--channel <channel>]`
- `otakit releases [--channel <channel> | --base]`
- `otakit list`
- `otakit delete <bundleId> --force`
- `otakit config validate`
- `otakit config resolve --json`
- `otakit generate-signing-key`
- `otakit mcp [--project-root <path>] [--organization-id <id>]`

## MCP server

Run the local stdio server from the Capacitor project it should access:

```bash
npx -y @otakit/cli@1.5.0 mcp
```

The project root and organization are fixed when the server starts. Configure
your MCP client to run the command above; do not put an OtaKit token in tool
arguments. The server reuses `OTAKIT_TOKEN` or the stored `otakit login` session
and honors `OTAKIT_SERVER_URL` for self-hosted installations.

The hosted remote server is `https://console.otakit.app/mcp`. It is a separate,
deployment-enabled surface for account operations and cannot read or upload files
from your local project. A deployment that has not enabled it returns a clear
`503` response; local stdio MCP continues to work independently. See the
[AgentKit setup guide](https://otakit.app/docs/agents) for Claude Code, Codex,
OAuth scopes, and remote setup.

## CI

```bash
export OTAKIT_TOKEN=otakit_sk_...
export OTAKIT_APP_ID=app_xxxxxxxx
export OTAKIT_BUILD_DIR=out

otakit upload --release
```

Set `OTAKIT_SERVER_URL` only for custom or self-hosted servers.

## Upload flow

1. resolve the build output directory
2. require `index.html`
3. zip the output
4. compute SHA-256 and size
5. call `bundles/initiate`
6. upload directly to object storage
7. call `bundles/finalize`
8. optionally call `releases`

The CLI does not own app creation or channel strategy. It packages the build,
uploads it, and optionally promotes it.

## Build locally

```bash
pnpm --filter @otakit/cli build
pnpm --filter @otakit/cli typecheck
pnpm --filter @otakit/cli dev
```
