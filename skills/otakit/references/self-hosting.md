# Self-hosted OtaKit

Use the deployment's configured console origin for CLI and MCP. Confirm it before
every write and never fall back to `console.otakit.app` without explicit user
direction.

Local MCP reuses the normal CLI configuration and credentials:

```sh
OTAKIT_SERVER_URL=https://console.example.com otakit mcp
```

Remote MCP is available at `<console-origin>/mcp` only after the operator enables
it. Interactive OAuth additionally requires the OAuth feature, provider schema,
trusted public URL, and consent configuration.

The agent features are deliberately staged:

1. Back up the database and test the supplied migrations against a disposable or
   restored copy.
2. Apply the reviewed additive migrations through the operator's normal
   maintenance process while the current application is still running. OtaKit
   does not automatically migrate a live production database.
3. Deploy compatible application code while all new feature flags remain off.
4. Enable durable release reliability with
   `OTAKIT_RELEASE_RELIABILITY_ENABLED=true` and exercise upload, publish,
   manifest repair, and revert in staging.
5. Enable the endpoint with `OTAKIT_REMOTE_MCP_ENABLED=true` for organization-key
   clients and validate origin/rate-limit configuration.
6. Enable interactive OAuth separately with
   `OTAKIT_REMOTE_MCP_OAUTH_ENABLED=true` only after its redirect, consent,
   revocation, and multi-organization tests pass.

Without the release-reliability flag, established REST, dashboard, and CLI
release behavior remains unchanged and agent release writes are not advertised.
Without the remote MCP flag, `/mcp` returns a `503` response that directs clients
to local MCP or the deployment operator. Missing optional Tinybird analytics must
be reported as unavailable, while upload/release functionality continues normally.

Use a custom MCP origin in client configuration:

```json
{
  "mcpServers": {
    "otakit-remote": {
      "type": "http",
      "url": "https://console.example.com/mcp",
      "oauth": {
        "scopes": "otakit:read otakit:app:write otakit:bundle:write otakit:release:write"
      }
    }
  }
}
```
