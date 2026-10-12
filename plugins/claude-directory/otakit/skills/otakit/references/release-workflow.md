# OtaKit release workflow

## Lane identity

A release lane is the full tuple:

`app + channel + runtimeVersion`

Use `channel: null` for the base channel. Do not substitute a named channel for
the base channel or omit runtime version from a preview.

## Review-first workflow

1. Inspect the local project and confirm the origin, organization, app, channel,
   and runtime version.
2. Check compatibility. Default to `block` for a known incompatibility. Use
   `proceed` only after the user explicitly accepts the native risk; use `skip`
   only when they intentionally choose not to compare.
3. Upload the built web directory with `upload_bundle`. This must not publish it.
4. Read the current release state and call `prepare_release` for the uploaded
   bundle and exact lane.
5. Show the complete preview: current and proposed bundle, expected current
   release, rollout percentage, `forceImmediate`, auto-revert enabled/rate/minimum
   sample, and compatibility result/decision.
6. Ask for approval, then call `publish_release` with those exact values and a
   new idempotency key. If the lane changed after preview, stop and prepare again.
7. Report whether manifest synchronization completed or is pending repair.

Use `upload_and_publish_bundle` only for an explicitly requested one-step release.
It preserves the same compatibility, lane, force-immediate, auto-revert,
idempotency, audit, and manifest-sync semantics.

## Inspect a rollout

Use release health for bounded event counts and `list_events` for recent filtered
diagnostic records. Say “events” and name the event types. Do not call the values
devices, users, installations, adoption, success rate, or causal evidence. A
missing analytics capability is “unavailable,” not zero.

## Percentage rollouts

`rolloutPercent` (1-100, default 100) releases to a share of devices on plugin
3.1 or later; older plugins keep the previous release until the rollout
completes. The first release on a lane must be 100%.

- A lane has at most one rollout, and it is always the current release
  (`rolloutPercent` below 100 in `get_release_state`). Publishing on that lane
  fails with `ROLLOUT_IN_PROGRESS` unless `replaceRollout` is true, which reverts
  the rolling release. Ask before replacing; `prepare_release` warns about it.
- Change the share with `set_rollout_percent`, passing the percentage you showed
  as `expectedPercent`. 100 completes the rollout; a completed rollout is final.
- Cancel a rollout with `prepare_revert` and `revert_release`, passing the
  reviewed percentage as `expectedRolloutPercent` so a rollout that completed
  meanwhile is not reverted; every device returns to the previous release.
- When a rolling release looks healthy, propose the next step (for example
  10% → 25% → 100%) and wait for approval. At low percentages auto-revert and
  health need longer to reach their minimum sample.

## Preview links

A preview link opens one bundle in the installed app on a tester's phone
without releasing it (plugin 3.2+, `previewLinks: true`, and a custom URL
scheme in the app). No other device is affected, so no release approval is
needed; still say which bundle the link opens and how long it lasts.

- `create_preview` with the bundle ID; pass `urlScheme` the first time for an
  app, and `expiresIn` (`1h`, `24h`, `7d` default, `30d`) when asked. Give the
  user the returned `url`; it shows a QR code and the buttons that open the app.
- Anyone with the link and a build that accepts previews can open it. Do not
  post it anywhere public, and suggest `revoke_preview` when testing is done.
- An app has at most 20 active links; `PREVIEW_LIMIT_REACHED` means revoke some.

## Release notes

A release can carry plain-text notes (`notes` on `prepare_release`,
`publish_release` and `upload_and_publish_bundle`; up to 2,000 characters). Apps
on plugin 3.3+ may show them to their users in a "What's new" screen.

- Write them for app users: what changed for them, plain language, a few short
  lines, no internal details, ticket numbers or file names.
- Show the exact text with the release preview and get approval with it.
- Notes can be edited later in the dashboard; phones that already updated keep
  the text they received.

## Revert

Read the exact current state and call `prepare_revert`. Show the current release,
the target previous bundle or built-in fallback, the lane, expected state, and
force-immediate behavior. Ask for approval, then call `revert_release` using the
same values and a new idempotency key. A stale expected state requires a new
preview.

## CLI fallback

When MCP is unavailable, use the commands in [CLI](cli.md) and keep the same
human approval boundary and the same preview block. Never place `OTAKIT_TOKEN` or
another secret directly in a command line or response.

The CLI has no prepared-publish flow, no expected-state check, and no idempotency
key, so a lane can change between your read and your release. Read the current
state immediately before releasing and say that the window exists.
