# Implementation Plan: `forceImmediateUpdate` — per-release emergency flag

Status: ready to implement (small–medium).
Owner: —
Related: [05-immediate-update-splash.md](./05-immediate-update-splash.md) (§7),
[CAPGO_IMPROVEMENT_PLAN.md](../../CAPGO_IMPROVEMENT_PLAN.md)

> **This replaces the earlier "server-controlled update strategy" research plan.**
> That plan moved all three policies into the dashboard + manifest (DB strategy
> model, seeding, native fetch-first refactor). The actual use case it served was
> *"we shipped a bad release and need devices on the fix ASAP."* This plan carves
> out exactly that: **one signed boolean on a release.** Compiled policies stay;
> no dashboard strategy model; ~15% of the work. The full rework stays deferred
> until a real customer asks for post-ship strategy tuning beyond "urgent."

> **Source confidence.** All claims below verified against the current source:
> plugin (`UpdaterPlugin.swift` / `.java`, `UpdaterCoordinator.swift`,
> `ManifestClient.swift`, `ManifestVerifier.swift`), manifest pipeline
> (`console/lib/manifest-files.ts`, `manifest-signing.ts`), release + revert
> routes, and `prisma/schema.prisma`.

## 1. Goal

A releaser marks a release (or a revert) as **force-immediate**. Devices that see
that manifest on any automatic lifecycle event (launch / resume / runtime) treat
it as an `immediate` update — download, apply, reload now — regardless of their
compiled `shadow` / `apply-staged` policies. Everything else about the update
pipeline (trial, `notifyAppReady`, rollback) is unchanged, so a bad "fix" still
rolls back.

**What exists today (verified):** the emergency path is revert/re-release →
`resumePolicy: shadow` (default) stages the fix on next foreground →
`launchPolicy: apply-staged` (default) applies it on next cold start. The only
thing missing is "don't wait for the next cold start." That's all this adds.

## 2. Verified integration points

- **Policies are compiled** into the app: `definitions.ts:105-110`;
  iOS defaults resolved in `load()` (`UpdaterPlugin.swift:80-82` —
  `apply-staged` / `shadow` / `immediate`); Android mirror
  (`UpdaterPlugin.java` `handleLaunch` at ~317).
- **Manifest is baked per lane** by `manifest-files.ts::writeManifestFile`
  (fields: `version, url, sha256, size, channel, runtimeVersion, releaseId,
  signature`). `syncManifestFileForLane` re-bakes from the newest non-reverted
  release.
- **Signed canonical payload** (`manifest-signing.ts:59-77`):
  `MANIFEST, appId, channel, version, sha256, size, runtimeVersion, kid, iat,
  exp`, newline-joined. Both native verifiers rebuild the identical string
  (`ManifestVerifier.swift:81-104`, Android mirror).
- **Revert** (`revert/route.ts`) marks `revertedAt` and re-syncs the lane
  manifest to the previous non-reverted release.
- **No reload loop risk:** after apply, `current == latest` classifies as
  `noUpdate` (`UpdaterCoordinator.doesBundleMatchLatest` matches on
  `releaseId`/`sha256`).
- **Bundle URLs are public CDN URLs** (`buildPublicObjectUrl`), not presigned —
  nothing about URL freshness changes here. (The plugin's 403/410 refetch path
  is untouched.)

## 3. Design

### 3.1 Data model

- `Release.forceImmediate Boolean @default(false)` — persisted on the release
  (audit trail + survives manifest re-bakes). Small migration; existing rows
  default `false`.

### 3.2 APIs

- **Release** (`releases/route.ts` POST): accept optional boolean
  `forceImmediate` (reject non-boolean). Stored on the created release; baked at
  sync.
- **Revert** (`revert/route.ts` POST): accept optional boolean
  `forceImmediate`. When provided, set it on the release that **becomes
  current** (`nextCurrentRelease`) before re-syncing the lane manifest — so a
  revert can itself be forced. Default: the reverted-to release keeps whatever
  flag it already has (no implicit force on revert — mid-rollout, many devices
  never got the bad version).
- **Releases GET / console:** include `forceImmediate` in the release payload.

### 3.3 Manifest + signature

- Bake `"forceImmediate": true | false` into the manifest JSON
  (`writeManifestFile`; add the field to the `ManifestRelease` select in
  `syncManifestFileForLane` / `restoreManifestFilesForApp`).
- **Sign it.** Append one line to the canonical payload —
  `forceImmediate:true|false` — in all three places **in lockstep**:
  `manifest-signing.ts::buildCanonicalPayload`, `ManifestVerifier.swift`,
  `ManifestVerifier.java`. Unsigned, a CDN/manifest tamperer could force
  reloads on every resume (or strip an emergency fix's urgency).
- **Compatibility break (deliberate, do it now):** a plugin build with the old
  canonical string will fail verification against newly signed manifests. With
  no real users yet this is a clean break; after launch the same change would
  need key rotation / dual-signing. This is the strongest reason to ship this
  flag **before** the first customers, even if the console UI comes later.

### 3.4 Native behavior (both platforms)

Rule: **on an automatic lifecycle event, after a successful verified manifest
fetch, if `forceImmediate` and the classification is `updateAvailable` or
`alreadyStaged`, escalate that event to the immediate flow** (download if
needed → `requireApplyStaged(reloadAfterApply: true)`).

- Applies to the `shadow` and `apply-staged` branches of
  `handleLaunch` / `handleResume` / `handleRuntime` (the `immediate` branches
  already do this).
- **`off` stays off.** With policy `off` the event never fetches a manifest, so
  the flag is never seen — `off` remains the device-owned kill switch, and the
  manual JS API is unaffected (`update()` is already immediate).
- **Resume throttle stands.** `checkInterval` throttles the manifest fetch
  itself, so a forced release can't be seen faster than the throttle +
  lifecycle events. Document: "immediate ≠ push" — urgency is bounded by the
  next event (static CDN, no server→device channel).
- Implementation sketch: `ManifestClient` parses `forceImmediate` into
  `LatestManifest` (default `false` when absent) and passes it to the verifier;
  thread it to the caller by carrying it on the staged
  `DownloadResolution` (or returning the manifest alongside). In the
  shadow/apply-staged handlers, after `downloadLatest` returns `.staged` with
  `forceImmediate`, call `requireApplyStaged(reloadAfterApply: true)`. No
  changes to locking (`tryBeginOperation` already wraps the whole event), trial
  timer, or rollback.

### 3.5 CLI + console

- CLI: `--force-immediate` on `otakit release` (and on `upload` when it
  releases). Show the flag in `releases` output.
- Console: checkbox ("Force immediate update — devices apply and reload on
  their next check") in the promote dialog and the revert dialog; a badge on
  flagged releases.

## 4. Interaction with plan 05 (splash)

Plan 05 holds the splash when the **compiled** cold-start policy is `immediate`
(known synchronously in `load()`). A *forced* update under a non-immediate
compiled policy is only known **after** the async fetch, so the splash is not
held: on a forced cold-start the user may briefly see the old app, then the
reload. Accepted for an emergency lever. (Optional follow-up: when
`holdReadyForImmediateUpdate` is on, also hold while the cold-start check is in
flight — that is exactly the reconciliation the old plan §7 described; do it
only if the flash proves annoying in practice.)

## 5. Files touched

Console:
- `prisma/schema.prisma` — `Release.forceImmediate` + migration.
- `app/api/v1/apps/[appId]/releases/route.ts` — accept/validate/store/return.
- `app/api/v1/apps/[appId]/releases/[releaseId]/revert/route.ts` — optional
  flag applied to `nextCurrentRelease`.
- `lib/releases.ts::createRelease` — pass through.
- `lib/manifest-files.ts` — select + bake the field.
- `lib/manifest-signing.ts` — canonical payload line.
- Console release UI — checkbox + badge.

CLI:
- `commands/release.ts`, `commands/upload.ts`, `lib/api.ts` —
  `--force-immediate` flag.

Plugin:
- `src/definitions.ts` — `forceImmediate?: boolean` on `LatestVersion`.
- iOS `ManifestClient.swift` (parse), `ManifestVerifier.swift` (payload line),
  `UpdaterPlugin.swift` (escalation in the three handlers).
- Android mirrors.
- Plugin README + `/docs/update-strategies` — document the lever and its
  bounds (next-event, not push; `off` unaffected; trial/rollback still apply).

## 6. Edge cases

- **Three canonical-payload builders in lockstep** — unit-test that console and
  both natives produce byte-identical strings for `true`, `false`; a
  tampered flag must fail verification.
- **`alreadyStaged` at launch under `apply-staged`:** the staged bundle is
  applied at startup *before* any fetch — the forced flag then classifies as
  `noUpdate`. Correct, no double-reload.
- **Forced immediate on resume is disruptive by design** (reload while the user
  may be mid-task). Document: for broken releases, not routine rollouts.
- **Bad forced fix:** trial + `appReadyTimeout` rollback unchanged — a forced
  bundle that never calls `notifyAppReady` rolls back like any other.

## 7. Testing

- Signing: cross-impl canonical string with the new line (console signer ↔ both
  verifiers); tamper fails.
- Native unit: escalation matrix — each of {launch, resume, runtime} ×
  {shadow, apply-staged} with `forceImmediate:true` applies + reloads;
  `off` does nothing; `false` behaves exactly as today; no reload loop after
  apply.
- Revert: revert with `forceImmediate:true` re-bakes the previous release's
  manifest with the flag; devices on the reverted-away version reload to it.
- E2E (`examples/demo-app`): device on default policies + forced release →
  next resume downloads, applies, reloads; `notifyAppReady` confirms; a forced
  broken bundle rolls back.

## 8. Open questions

- Auto-clear the flag after N days / next release, or leave it (next release
  simply doesn't carry it — manifest is per-release, so it clears naturally)?
  → clears naturally; no work needed. Confirm in tests.
- Should `check()`'s JS result expose `forceImmediate` so manual-mode apps can
  build their own "mandatory update" UI? Cheap (`LatestVersion` already flows
  through) — include it.
