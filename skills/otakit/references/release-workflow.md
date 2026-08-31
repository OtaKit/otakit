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
   release, `forceImmediate`, auto-revert enabled/rate/minimum sample, and
   compatibility result/decision.
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
