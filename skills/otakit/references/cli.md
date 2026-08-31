# OtaKit CLI reference

Use this when OtaKit MCP is unavailable. These are the commands; the other
references in this Skill cover the workflow they belong to.

Every command accepts `--server <url>` for a self-hosted console. Never put a
token on the command line: it lands in shell history and in `ps` output. Export
`OTAKIT_TOKEN` instead, and never print it.

## Context

```sh
otakit whoami --json          # credential type, user, effective organization and its source
otakit config resolve --json  # effective app ID, server, output dir, channel, and where each came from
otakit config validate        # check the OtaKit values in capacitor.config.*
otakit organization select    # choose the default organization for app-less commands
```

## Inspect before changing anything

```sh
otakit list --limit 20                  # uploaded bundles
otakit releases --base                  # release history for the base channel
otakit releases --channel production
otakit compatibility --channel production
```

`otakit compatibility` compares local native packages against the channel's
current release. It reads only `dependencies`, and it needs an installed
`node_modules`; pass `--package-json` / `--node-modules` in a workspace.

## Upload and release

Uploading does not publish. Keep the two steps apart unless the user explicitly
asks for one shot.

```sh
otakit upload                           # upload only, from webDir
otakit upload ./dist                    # upload an explicit directory
otakit upload --version 2.4.1 --strict-version
otakit upload --strategy deltas         # per-file objects; devices fetch only what changed
otakit upload --encrypt                 # requires OTAKIT_ENCRYPTION_KEY

otakit release <bundleId> --channel production
otakit release <bundleId>               # base channel
```

Flags that change device behavior, so show them before running:

- `--force-immediate` — devices apply and reload on their next check.
- `--fail-on-incompatible` — exit non-zero when native compatibility fails.
- `--ignore-compat` — skip the check entirely. Only on explicit instruction.

The bundle carries its own `runtimeVersion`, so `release` chooses the channel
only. A lane is still `app + channel + runtimeVersion`; name all three when you
describe what you are about to do.

## Clean up

```sh
otakit delete <bundleId>        # prompts; only for bundles absent from release history
```

## Getting set up

```sh
otakit login                    # email OTP, stores a token for this server
otakit register --slug com.example.app
otakit generate-signing-key
otakit generate-encryption-key
```

## Limits worth stating out loud

The CLI has no prepared-publish flow, no `expectedCurrentReleaseId`, and no
idempotency key. If another actor changes the lane between your check and your
release, the CLI will not notice. Read the current state immediately before
releasing, and say that this window exists when it matters.
