# Immediate Update On Runtime Change Plan

## Goal

Add a runtime-aware production mode so apps using `updateMode: "next-launch"` or
`"next-resume"` can still bring fresh installs and new `runtimeVersion` lanes to
the latest OTA bundle immediately, without turning the whole app into
`updateMode: "immediate"`.

This should solve the current gap in OtaKit:

- a brand-new user can open the app on the builtin bundle even when a newer OTA
  already exists for the same `channel + runtimeVersion`
- a user who moves into a new `runtimeVersion` lane can also start on an older
  builtin or previously downloaded bundle until a later launch/resume

The feature should preserve OtaKit's existing model:

- `runtimeVersion` still defines compatibility boundaries
- `channel` still defines rollout audience
- `next-launch` and `next-resume` remain the normal production modes
- `notifyAppReady()` remains the success handshake
- rollback safety must stay intact

## Design Decision

Use `runtimeVersion`, not native build numbers.

For OtaKit, the correct trigger is the configured compatibility lane, not every
new binary build. That means:

- if `runtimeVersion` changes, the app should get one aggressive catch-up path
- if `runtimeVersion` stays the same, no special behavior is needed
- first install is naturally covered because no runtime has been resolved yet

This keeps the behavior aligned with how OtaKit already thinks about
compatibility.

## Public API

Add one new config field:

```ts
export interface OtaKitConfig {
  immediateUpdateOnRuntimeChange?: boolean;
}
```

Semantics:

- `false | undefined`
  - current behavior
- `true`
  - on cold start only, if the current `runtimeVersion` does not match the last
    resolved `runtimeVersion`, OtaKit temporarily behaves like the current
    `immediate` launch path

Recommended scope:

- fully supported with `updateMode: "next-launch"` and `"next-resume"`
- ignored with `updateMode: "manual"`
- redundant with `updateMode: "immediate"` and should log a warning instead of
  changing behavior

## Core Model

Use one persisted field only:

- `lastResolvedRuntimeKey: string`

Meaning:

- this is the last runtime lane key for which startup has already been
  resolved
- "resolved" means either:
  - there was no newer update to apply in that lane
  - or OtaKit committed to applying an update in that lane

This is intentionally simple.

We do **not** need:

- `hasSeenRuntimeLane`
- `pendingRuntimeChange`
- retry counters
- reason enums
- nullable runtime storage

Storage semantics are simple:

- key absent -> unresolved startup
- key present -> resolved for that runtime key

## RuntimeVersion Normalization

Normalize current config as:

- `currentRuntimeKey = trim(runtimeVersion) || "__default__"`

That means:

- first install: key absent means startup has not resolved any runtime yet
- app with no configured `runtimeVersion`: current key is `__default__`
- changing from `__default__ -> "2026.04"` or `"2026.04" -> __default__"` is a
  real lane change

## Cold Start Rule

On cold start:

1. Compute `currentRuntimeKey`.
2. If `immediateUpdateOnRuntimeChange` is disabled, keep current behavior.
3. If `updateMode` is `manual`, ignore this feature and warn only if
   `immediateUpdateOnRuntimeChange` is `true`.
4. If `updateMode` is `immediate`, ignore this feature and warn only if
   `immediateUpdateOnRuntimeChange` is `true`.
5. If the persisted key is present and `lastResolvedRuntimeKey ===
   currentRuntimeKey`, keep current behavior.
6. Otherwise:
   - skip staged-on-launch once for this startup
   - bypass `checkInterval`
   - run the immediate-style launch path: check, download if needed, then apply
     immediately

This override is launch-only.

Resume keeps the normal configured behavior of `next-launch` or `next-resume`.

That is the cleanest v1 behavior and avoids surprise resume reloads in
production.

## When To Write `lastResolvedRuntimeKey`

All write sites should call a single helper:

- `resolveCurrentRuntimeKey()`

That helper should:

- write `lastResolvedRuntimeKey = currentRuntimeKey`

This avoids fragile duplicated writes across:

- runtime-aware launch apply
- manual `apply()`
- manual `update()`
- no-update outcome
- known-bad-latest suppression outcome

Write `lastResolvedRuntimeKey = currentRuntimeKey` only when the
runtime-change situation is resolved.

### Case 1: No update exists

If manifest resolution says the current bundle is already latest, or no newer
update exists for this `channel + runtimeVersion`, then:

- record the normal check timestamp
- call `resolveCurrentRuntimeKey()`

### Case 2: We are about to apply a bundle

If the runtime-aware path decides to activate a bundle and reload, then:

- call `resolveCurrentRuntimeKey()`
- then activate and reload

This applies regardless of why the apply happened:

- runtime-change immediate path
- manual `apply()`
- manual `update()`

The important idea is: once we commit to applying inside this runtime lane, we
consider the lane resolved and stop doing the aggressive startup override.

### Case 3: Fetch or download fails

Do not write anything.

That way, the next cold start still sees:

- unresolved startup for the current runtime key

and retries the runtime-change launch behavior.

## Failed Latest Bundle Rule

Keep this one extra safety rule:

- if `failedBundle` matches the current latest manifest by `releaseId`, or if
  needed by `sha256`, treat that latest bundle as unavailable

Then:

- emit `noUpdateAvailable` or equivalent normal outcome
- call `resolveCurrentRuntimeKey()`

This prevents the simple bad loop:

1. latest bundle downloads
2. app reloads into it
3. it fails before `notifyAppReady()`
4. rollback happens
5. next cold start aggressively tries the same broken latest again forever

We do not need retry counters for v1. Just skip the known-bad latest until a
different release appears.

## Write Matrix

This is the full v1 write behavior.

- Cold start, override active, no update:
  - write `lastResolvedRuntimeKey = currentRuntimeKey`
- Cold start, override active, latest matches `failedBundle`:
  - write `lastResolvedRuntimeKey = currentRuntimeKey`
- Cold start, override active, update found and we are about to reload:
  - write `lastResolvedRuntimeKey = currentRuntimeKey`
- Cold start, override active, manifest fetch fails:
  - do not write
- Cold start, override active, download fails:
  - do not write
- Manual `apply()`:
  - write `lastResolvedRuntimeKey = currentRuntimeKey` before reload
- Manual `update()`:
  - if it reaches apply, write `lastResolvedRuntimeKey = currentRuntimeKey`
    before reload
- Background checks in normal `next-launch` / `next-resume`:
  - do not write just because something downloaded

This is the intended rule:

- write only when runtime resolution is complete
- do not write on temporary failure
- do not write just because a bundle is staged

## Trigger Matrix

### `updateMode: "next-launch"`

Normal behavior:

- launch: check/download in background
- resume: check/download in background
- activation: next cold start only

With `immediateUpdateOnRuntimeChange: true` and unresolved startup for the
current runtime key:

- launch: immediate check/download/apply attempt
- resume: normal `next-launch` behavior
- later launches: normal `next-launch` behavior once the runtime is resolved

### `updateMode: "next-resume"`

Normal behavior:

- launch: check/download in background
- resume: activate staged if present, otherwise check/download in background
- activation: next resume or cold start

With `immediateUpdateOnRuntimeChange: true` and unresolved startup for the
current runtime key:

- launch: immediate check/download/apply attempt
- resume: normal `next-resume` behavior
- later launches: normal `next-resume` behavior once the runtime is resolved

### `updateMode: "manual"`

- ignore `immediateUpdateOnRuntimeChange`
- log a warning only when `immediateUpdateOnRuntimeChange` is `true`

### `updateMode: "immediate"`

- ignore `immediateUpdateOnRuntimeChange`
- log a warning only when `immediateUpdateOnRuntimeChange` is `true`, because
  the app is already in a broader immediate lifecycle

## Launch UX

Reuse the current `immediate` launch UX:

- cold start can briefly show the old bundle before reload
- no special splash-screen handling
- no blocking startup mode in v1

This keeps the feature small and avoids extra platform complexity.

## Important Startup Ordering

To avoid double reloads and weird interactions, change cold-start ordering when
the runtime-change override is active.

Current startup roughly does:

1. prune incompatible bundles
2. rollback unfinished trial if needed
3. activate staged-on-launch
4. run automatic update

With runtime-change override active, do this instead:

1. prune incompatible bundles
2. rollback unfinished trial if needed
3. detect whether runtime-change override applies
4. if override applies:
   - skip staged-on-launch for this startup
   - run runtime-aware immediate launch path
5. otherwise:
   - do normal staged-on-launch behavior
   - do normal automatic update behavior

This is the simplest way to avoid:

- activating an older staged bundle
- then immediately finding a newer latest bundle
- then reloading again

## Android Plan

Files to change:

- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/BundleStore.java`

### BundleStore changes

Add one persisted field and helpers:

- `last_resolved_runtime_key`
- `hasLastResolvedRuntimeKey()`
- `getLastResolvedRuntimeKey()`
- `setLastResolvedRuntimeKey(String value)`

### UpdaterPlugin changes

Add config state:

- `immediateUpdateOnRuntimeChange`

Add helpers:

- `currentRuntimeKey()`
- `isRuntimeStartupResolved()`
- `resolveCurrentRuntimeKey()`
- `shouldUseRuntimeChangeImmediateOnLaunch()`
- `resolveRuntimeChangeAgainstLatest(...)`
- `latestMatchesFailedBundle(...)`

Android behavior:

- only special-case cold start
- skip staged-on-launch once when runtime-change override applies
- bypass `checkInterval` when runtime-change override applies
- if latest matches failed bundle, treat runtime as resolved and do not retry it
- use `resolveCurrentRuntimeKey()` before any apply/reload path
- use `resolveCurrentRuntimeKey()` on no-update outcome
- do not set it on fetch/download failure

## iOS Plan

Files to change:

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`
- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/BundleStore.swift`

### BundleStore changes

Add one persisted field and helpers:

- `otakit_last_resolved_runtime_key`
- `hasLastResolvedRuntimeKey()`
- `getLastResolvedRuntimeKey()`
- `setLastResolvedRuntimeKey(_:)`

### UpdaterPlugin changes

Add:

- config parsing for `immediateUpdateOnRuntimeChange`
- cold-start runtime-change detection
- resolved-startup detection
- shared resolve helper
- failed-latest suppression helper
- runtime-aware immediate launch helper

iOS behavior mirrors Android:

- launch-only special behavior
- skip staged-on-launch once when runtime-change override applies
- bypass `checkInterval` when runtime-change override applies
- use `resolveCurrentRuntimeKey()` before any apply/reload path
- use `resolveCurrentRuntimeKey()` on no-update outcome
- do not set it on fetch/download failure

## Manual API Integration

Keep this rule simple:

- any real apply path should call `resolveCurrentRuntimeKey()`

That means:

- `apply()`
- `update()`
- runtime-aware immediate launch apply

all resolve the runtime change in the same way.

This is cleaner than keeping separate special-case state just for startup.

## Edge Cases

### 1. Fresh install, offline first launch

- no resolved runtime stored yet
- runtime-aware launch path tries and fails
- nothing is written
- next cold start retries

### 2. Native build updated, same `runtimeVersion`

- no special runtime-change path
- use normal configured behavior

### 3. `runtimeVersion` changed

- runtime-aware launch path runs once on cold start
- once no-update or apply happens, the runtime is resolved

### 4. `runtimeVersion` unset

- treat as `__default__`
- still works with the same comparison logic

### 5. Latest bundle already failed and rolled back

- if latest matches `failedBundle`, skip it
- mark runtime as resolved
- wait for a different release in that lane

### 6. Manual apply in a new runtime lane

- manual apply also resolves the runtime lane
- later launches do not rerun the special startup override

## Testing Plan

There are currently no native plugin tests in this package. That needs to
change for this feature.

### Android

Add JVM tests under `packages/capacitor-plugin/android/src/test/...` for pure
decision logic extracted from the plugin.

Test cases:

- key absent + `runtimeVersion = null` -> override still applies on first launch
- key present with `__default__` + `runtimeVersion = null` -> override does not apply
- same `lastResolvedRuntimeKey` -> override does not apply
- changed `runtimeVersion` -> override applies
- `runtimeVersion = null` -> normalizes to `__default__`
- no update -> calls `resolveCurrentRuntimeKey()`
- apply path -> calls `resolveCurrentRuntimeKey()` before reload
- fetch/download failure -> does not write `lastResolvedRuntimeKey`
- failed bundle matches latest -> latest is skipped and runtime is resolved

### iOS

Add an XCTest target to `Package.swift` and create pure-policy tests under
`packages/capacitor-plugin/ios/Tests/...`.

Test cases should mirror Android:

- launch override detection
- write timing for resolved runtime
- no-write behavior on fetch/download failure
- failed-latest suppression

### Manual smoke matrix

Use the demo app and verify on both Android and iOS:

1. fresh install, update available, `next-launch`, `true`
2. fresh install, update available, `next-resume`, `true`
3. fresh install, no update, `true`
4. fresh install, offline first launch, later online relaunch
5. app relaunch with unchanged `runtimeVersion`
6. update to a native build with the same `runtimeVersion`
7. update to a native build with bumped `runtimeVersion`
8. `runtimeVersion` unset on first install
9. latest bundle previously failed and is still latest
10. manual apply in a new runtime lane

## Docs Plan

Files to update:

- `packages/capacitor-plugin/src/definitions.ts`
- `packages/capacitor-plugin/README.md`
- `packages/site/app/docs/plugin/page.tsx`
- `packages/site/app/docs/setup/page.tsx`
- `packages/site/app/docs/page.tsx`
- `packages/site/app/docs/channels/page.tsx`
- regenerate:
  - `llms.txt`
  - `packages/site/public/llms.txt`

Docs content to add:

- what `immediateUpdateOnRuntimeChange` solves
- that it is designed for `next-launch` / `next-resume`
- that the trigger is unresolved cold start for the current runtime key
- that resume behavior stays normal in v1
- that `runtimeVersion` still controls native compatibility boundaries

Important migration phrasing:

- Capgo `directUpdate: "atInstall"` maps most closely to:
  - `updateMode: "next-launch"` or `"next-resume"`
  - plus `immediateUpdateOnRuntimeChange: true`
- difference:
  - OtaKit keys the special path off unresolved `runtimeVersion` startup, not
    every native build number

## Recommended Implementation Order

1. Refactor automatic cold-start flow enough to skip staged-on-launch once when
   runtime-change override applies.
2. Add persisted `lastResolvedRuntimeKey`.
3. Add the runtime-aware immediate launch path.
4. Add failed-latest suppression.
5. Add Android and iOS tests for the decision layer.
6. Add docs and regenerate `llms.txt`.
7. Run manual smoke tests on both platforms before release.

## Recommendation

Ship this as a focused updater feature, not as a new lifecycle system.

The right product story is:

- `next-launch` and `next-resume` stay the production defaults
- `immediateUpdateOnRuntimeChange` fixes the fresh-install / fresh-runtime-lane
  gap
- unchanged `runtimeVersion` means no special behavior
- launch UX stays simple and reuses current immediate-mode behavior

That keeps OtaKit opinionated and small while still solving the real startup
freshness problem.
