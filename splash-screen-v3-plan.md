# Splash Screen Plan v3 - Full Immediate Resume Coverage

## Summary

This plan keeps the OtaKit-owned native overlay from v2, but extends it to
cover both immediate-mode resume paths:

1. A valid staged bundle already exists before foreground.
2. No staged bundle exists, so OtaKit must check/download on that same resume.

The goal is simple:

- if `updateMode: "immediate"` and `autoSplashscreen: true`, resume should not
  fall back to a delayed visible switch
- the update either completes behind the overlay, or it is deferred

This is the missing case v2 explicitly left out.

## What Changes From v2

v2 covered:

- cold start
- immediate resume with an already staged bundle

v2 explicitly did **not** cover:

- immediate resume where no staged bundle exists and OtaKit must perform a
  fresh check/download before deciding whether to reload

v3 adds exactly that missing resume path.

## Goals

- Keep OtaKit fully independent from `@capacitor/splash-screen`
- Preserve the current cold-start behavior
- Extend managed resume so `immediate + autoSplashscreen` does not produce a
  delayed visible reload
- Keep the overlay implementation simple: solid color, native view, short fade
- Keep existing updater semantics for staging, activation, rollback, and
  `notifyAppReady()`

## Non-Goals

- No fallback to Capacitor SplashScreen
- No richer loader UI, spinner, or branded art in v3
- No change to `manual`, `next-launch`, or `next-resume`
- No attempt to make `immediate + autoSplashscreen: false` behave differently
- No change to the cold-start no-update / no-reload hide contract
- No change to the manifest / bundle format

## Public Config

No new config is required for v3.

```ts
export interface OtaKitConfig {
  autoSplashscreen?: boolean;
  autoSplashscreenTimeout?: number;
  autoSplashscreenBackgroundColor?: string;
  appReadyTimeout?: number;
}
```

Semantics:

- `autoSplashscreen`
  - enables OtaKit-owned overlay management
- `autoSplashscreenTimeout`
  - default: `10000`
  - minimum: `1000`
  - in v3, this applies to the **decision phase** for both:
    - cold start
    - immediate resume
- `appReadyTimeout`
  - unchanged
  - still governs the post-reload health confirmation window

This means the docs must change from:

- "used only on cold start"

to:

- "used whenever OtaKit is holding the overlay while deciding whether to reload
  inline"

## Behavioral Contract

### Cold start

Cold start behavior stays as in v2:

- show overlay when:
  - `autoSplashscreen == true`
  - and `updateMode == "immediate"` or forced immediate launch on runtime change
- hold overlay while OtaKit checks/downloads
- reload behind the overlay if an inline apply is chosen
- hide overlay on:
  - no update
  - suppressed update
  - fetch/check/download error
  - timeout
  - successful reload followed by `notifyAppReady()`

This plan does **not** change the no-reload cold-start path to wait for
`notifyAppReady()`.

`waitingForAppReady` stays reserved for flows where OtaKit already committed to
an actual reload. If we later want to mask the first rendered frame even when no
reload occurred, that needs a separate render-ready contract and separate
timeout semantics. That is deliberately outside v3.

### Immediate resume with `autoSplashscreen: false`

Behavior stays unchanged:

- OtaKit may still check/download on resume
- if it later finds an update, it may still reload visibly
- v3 does not change this path

### Immediate resume with `autoSplashscreen: true`

This is the new v3 contract.

When the app returns to foreground in `updateMode: "immediate"` and
`autoSplashscreen == true`, OtaKit must choose one of two managed resume paths.

#### Path A: staged bundle already exists

- show overlay before the old WebView becomes visible
- move directly to `waitingForAppReady`
- activate the staged bundle
- reload
- hide overlay only when the reloaded bundle calls `notifyAppReady()`

This is the existing v2 staged-resume behavior.

#### Path B: no staged bundle exists yet

- show overlay before the old WebView becomes visible
- enter a dedicated resume decision state
- start the immediate check/download right away
- if no update is found:
  - hide overlay
  - continue with the current bundle
- if an update is downloaded before timeout:
  - activate it
  - reload
  - keep overlay visible until `notifyAppReady()`
- if fetch/check/download fails:
  - hide overlay
  - continue with the current bundle
- if the resume decision times out before OtaKit knows whether it will reload:
  - hide overlay
  - continue with the current bundle
  - do **not** perform a late visible reload from that resume attempt

That last rule is the core v3 requirement.

## Resume Timeout Contract

The new resume-download path needs an explicit timeout contract.

If the managed resume decision times out:

- the overlay is hidden
- the current bundle stays active for the rest of that foreground session
- the in-flight check/download may finish in the background
- if that late result produced a valid downloaded bundle, it may remain staged
- but that late result must **not** call `reloadWebView()` for that timed-out
  resume attempt

Practical result:

- no delayed visible switch
- no wasted download
- the next resume can use the staged-bundle path and apply cleanly behind the
  overlay

## Check-In-Progress Contract

This is important.

The managed resume check/download path must claim the existing
`checkInProgress` guard **before** showing the overlay.

Otherwise OtaKit can show the overlay even though another automatic check is
already running and no new managed resume work will actually happen.

Required behavior:

- if a valid staged bundle exists, the overlay may still be shown without
  claiming the check guard first because activation does not depend on a fresh
  check
- if no staged bundle exists and v3 wants to run a managed resume
  check/download:
  - first claim the in-flight guard
  - only then show the overlay and enter the resume decision state
- if the claim fails:
  - do not show the overlay
  - do not start another check
  - leave behavior unchanged for that foreground event

The fresh-check resume helper must treat "guard already claimed" as a hard
precondition failure, not as a reason to show the overlay anyway.

## Overlay Attachment Rule

The overlay attach helper must keep the v2 main-thread rule.

If OtaKit is already on the main/UI thread when it decides to show the overlay:

- attach the overlay synchronously
- do not bounce through an unconditional async dispatch

If OtaKit is not on the main/UI thread:

- dispatch to the main/UI thread and attach there

This applies to both:

- cold start in `load()`
- pre-visible managed resume entrypoints

Otherwise the old WebView can flash before the overlay appears, which defeats
the point of the feature.

## State Machine

The current `LaunchSplashState` name is no longer accurate once resume owns its
own decision phase.

Rename it conceptually to something like:

```text
ManagedOverlayState
```

Recommended explicit states:

```text
inactive
holdingForLaunchDecision
holdingForResumeDecision
waitingForAppReady
timedOutLaunch
timedOutResume
```

### Meaning of each state

- `inactive`
  - no managed overlay is currently owned by OtaKit
- `holdingForLaunchDecision`
  - cold start only
  - overlay is visible while OtaKit decides whether to inline-reload on launch
- `holdingForResumeDecision`
  - resume only
  - overlay is visible while OtaKit decides whether to inline-reload on resume
- `waitingForAppReady`
  - a reload has already been committed
  - overlay remains visible until the active bundle confirms healthy
- `timedOutLaunch`
  - the cold-start decision phase timed out
  - late results from that launch decision must not inline-reload that launch
- `timedOutResume`
  - the managed resume decision phase timed out
  - late results from that resume decision must not reload that foreground

### Allowed transitions

Cold start:

```text
inactive -> holdingForLaunchDecision -> waitingForAppReady -> inactive
inactive -> holdingForLaunchDecision -> timedOutLaunch -> inactive
```

Resume with staged bundle:

```text
inactive -> waitingForAppReady -> inactive
```

Resume with fresh check/download:

```text
inactive -> holdingForResumeDecision -> waitingForAppReady -> inactive
inactive -> holdingForResumeDecision -> timedOutResume -> inactive
inactive -> holdingForResumeDecision -> inactive
```

That last transition is the "no update" or "error" path.

### Invariants

- Only cold start may enter `holdingForLaunchDecision`
- Only managed immediate resume may enter `holdingForResumeDecision`
- Only a committed reload may enter `waitingForAppReady`
- No managed resume entrypoint may start from any state other than `inactive`
- `notifyAppReady()` may hide the overlay only from `waitingForAppReady`
- A result arriving after `timedOutResume` must never trigger `reloadWebView()`
- A result arriving after `timedOutLaunch` must never trigger inline reload for
  that launch

## Helper Contract

Keep the existing shared staged-bundle validity helper:

```text
resolveValidStagedBundleForActivation()
```

That helper remains the source of truth for:

- staged bundle ID exists
- bundle record exists
- bundle is runtime-compatible

If the helper returns `nil` / `null`, OtaKit must treat the staged bundle as
not activatable right now.

## Managed Overlay Helpers

v3 needs the helper layer to be explicit. The current cold-start-only names are
too narrow once resume owns a decision phase too.

Recommended conceptual helpers:

- `beginManagedLaunchSplash()`
- `beginManagedResumeAppReadyWait()`
- `beginManagedResumeSplash()`
- `markManagedLaunchTimedOut()`
- `markManagedResumeTimedOut()`
- `beginManagedLaunchReload()`
- `beginManagedResumeReload()`
- `finishManagedLaunchDecision()`
- `finishManagedResumeDecision()`
- `completeManagedOverlayOnAppReady()`
- `cancelManagedOverlayAwaitingAppReady()`

Required semantics:

### `beginManagedLaunchSplash()`

- show launch decision ownership
- arm `autoSplashscreenTimeout`
- enter `holdingForLaunchDecision`

### `beginManagedResumeAppReadyWait()`

- used only for the already-staged resume path
- valid only from `inactive`
- does **not** require `checkInProgress`
- show overlay
- transition directly to `waitingForAppReady`

### `beginManagedResumeSplash()`

- used only for the fresh-check resume path
- valid only from `inactive`
- caller must have already claimed `checkInProgress`
- show resume decision ownership
- arm `autoSplashscreenTimeout`
- enter `holdingForResumeDecision`

### `beginManagedLaunchReload()`

- valid only from `holdingForLaunchDecision`
- cancel the decision timeout
- transition to `waitingForAppReady`

### `beginManagedResumeReload()`

- valid only from `holdingForResumeDecision`
- cancel the decision timeout
- transition to `waitingForAppReady`

### `finishManagedLaunchDecision()`

- valid for cold-start no-update / suppressed / error cleanup
- if state is `holdingForLaunchDecision`:
  - cancel timeout
  - transition to `inactive`
  - return `true` so caller hides overlay
- if state is `timedOutLaunch`:
  - transition to `inactive`
  - return `false`
- otherwise return `false`

### `finishManagedResumeDecision()`

- valid for resume no-update / error cleanup
- if state is `holdingForResumeDecision`:
  - cancel timeout
  - transition to `inactive`
  - return `true` so caller hides overlay
- if state is `timedOutResume`:
  - transition to `inactive`
  - return `false`
- otherwise return `false`

### `completeManagedOverlayOnAppReady()`

- if state is `waitingForAppReady`:
  - transition to `inactive`
  - return `true`
- if state is any decision or timed-out state:
  - do not hide here
  - transition timed-out states back to `inactive`
  - return `false`

This preserves the ownership rule:

- decision exit hides through launch/resume decision helpers
- successful reload hides through `notifyAppReady()`

## Lifecycle Integration

The cleanest implementation is to fully own the managed immediate-resume path
from the earliest pre-visible lifecycle callback on each platform.

Do not split the managed resume path across one callback that only shows the
overlay and another callback that later decides whether work actually starts.

That split is what makes the new timeout and `checkInProgress` rules fragile.

### iOS

Use `handleAppWillEnterForeground()` as the managed immediate-resume entrypoint.

Recommended flow:

1. If managed overlay state is not `inactive`, return immediately.
2. If `autoSplashscreen != true` or `updateMode != .immediate`, do nothing
   special here and let the existing resume path run normally.
3. Ask `resolveValidStagedBundleForActivation()` whether an immediate staged
   reload is available.
4. If staged is valid:
   - call `beginManagedResumeAppReadyWait()`
   - if activation succeeds, reload
   - if activation fails:
     - `cancelManagedOverlayAwaitingAppReady()`
     - hide overlay
   - return
5. If no staged bundle exists:
   - attempt to claim the in-flight check guard
   - if claim fails, do not show overlay and return
   - call `beginManagedResumeSplash()`
   - start `performCheckAndDownload(...)` from this same foreground path
6. Async completion rules:
   - `result == nil`
     - `finishManagedResumeDecision()`
     - hide overlay if that helper returns `true`
   - `result != nil`
     - if `beginManagedResumeReload()` succeeds:
       - if activation succeeds:
         - `reloadWebView()`
       - if activation fails:
         - `cancelManagedOverlayAwaitingAppReady()`
         - hide overlay
     - if state already timed out:
       - do not reload
       - leave the downloaded bundle staged
       - move `timedOutResume -> inactive`
   - `error`
     - `finishManagedResumeDecision()`
     - hide overlay if that helper returns `true`

After this lands, `runAutomaticUpdate(trigger: .resume, ...)` should handle only
the unmanaged resume cases. It should not continue to own any
`immediate + autoSplashscreen: true` resume path.

### Android

Use `handleOnStart()` as the managed immediate-resume entrypoint.

Recommended flow is the same as iOS:

1. Reset a one-shot `skipNextResumeAutoUpdate` flag to `false` at the top of
   `handleOnStart()`.
2. If managed overlay state is not `inactive`, return immediately.
3. If not `immediate + autoSplashscreen`, do nothing special.
4. If a valid staged bundle exists:
   - call `beginManagedResumeAppReadyWait()`
   - set `skipNextResumeAutoUpdate = true`
   - if activation succeeds, reload
   - if activation fails:
     - `cancelManagedOverlayAwaitingAppReady()`
     - hide overlay
   - return
5. If no staged bundle exists:
   - claim `checkInProgress` first
   - if claim fails, do not show overlay
   - call `beginManagedResumeSplash()`
   - set `skipNextResumeAutoUpdate = true`
   - start `performCheckAndDownload(...)` immediately from the managed
     foreground path
6. Async completion rules match iOS exactly.

`handleOnResume()` must then do exactly one thing before its normal logic:

- if `skipNextResumeAutoUpdate == true`:
  - set it back to `false`
  - return without calling `runAutomaticUpdate(trigger: resume, ...)`

Use the one-shot flag instead of relying only on overlay state. State alone is
not enough because a managed no-update or error path could return to `inactive`
before `handleOnResume()` fires, which would allow an unintended second resume
check in the same foreground cycle.

This is still the place that needs real-device verification to confirm the
overlay attaches before the old WebView becomes visible on warm resume.

## `runAutomaticUpdate` Ownership After v3

After v3, resume responsibility is split intentionally:

- `trigger: launch`
  - unchanged
- `trigger: resume` with `manual`
  - unchanged no-op
- `trigger: resume` with `next-launch`
  - unchanged background check/download behavior
- `trigger: resume` with `next-resume`
  - unchanged staged activation + background check/download behavior
- `trigger: resume` with `immediate` and `autoSplashscreen: false`
  - unchanged current behavior, including the possibility of a visible delayed
    reload
- `trigger: resume` with `immediate` and `autoSplashscreen: true`
  - fully removed from `runAutomaticUpdate(trigger: resume, ...)`
  - fully owned by the managed lifecycle entrypoint described above

This split must be explicit in the implementation. The managed immediate-resume
path must not be half-owned by the lifecycle callback and half-owned by
`runAutomaticUpdate(...)`.

## Timeout Semantics vs `notifyAppReady()`

There are now two distinct timing domains:

### Decision timeout

Controlled by `autoSplashscreenTimeout`.

Applies while OtaKit is still deciding whether it will inline-reload:

- cold start
- managed immediate resume

If this timeout fires, OtaKit gives up on masking that decision attempt and
hides the overlay.

### App-ready timeout

Controlled by `appReadyTimeout`.

Applies only after a reload has already happened and OtaKit is waiting for the
new bundle to prove healthy via `notifyAppReady()`.

This part stays exactly as it is today.

## Late Result Rules

v3 must define late-result behavior precisely.

### Late result after `timedOutResume`

If the managed resume decision timed out and the async check/download finishes
later:

- never call `reloadWebView()`
- keep the newly downloaded bundle staged if it is valid
- return the overlay state to `inactive`

### Late result after `timedOutLaunch`

Existing cold-start rule remains:

- do not inline-reload that launch after the timeout already released the UI

## Rollback Contract

Rollback semantics stay unchanged.

If a managed reload happened and the new bundle fails, rollback continues to use
the existing bundle/fallback flow. The overlay is still released by the bundle
that becomes healthy and calls `notifyAppReady()`.

That means v3 must keep the current rule:

- `notifyAppReady()` only owns hide from `waitingForAppReady`

## Test Matrix

### Cold start

1. `immediate` + `autoSplashscreen: true` + no update
   - overlay shows
   - no reload
   - overlay hides
   - cold-start no-reload hide semantics remain unchanged in v3
2. `immediate` + `autoSplashscreen: true` + update found quickly
   - overlay shows
   - download completes
   - reload happens
   - overlay hides only after `notifyAppReady()`
3. `immediate` + `autoSplashscreen: true` + launch decision timeout
   - overlay hides
   - no inline reload on that launch

### Resume, staged path

4. `immediate` + `autoSplashscreen: true` + valid staged bundle exists
   - overlay shows before old WebView is visible
   - staged bundle activates
   - reload happens
   - overlay hides after `notifyAppReady()`
5. `immediate` + `autoSplashscreen: true` + staged bundle missing / invalid
   - managed staged path is not taken
   - v3 may proceed to managed fresh-check path instead

### Resume, fresh-check path

6. `immediate` + `autoSplashscreen: true` + no staged bundle + no update
   - overlay shows
   - check completes
   - no reload
   - overlay hides
7. `immediate` + `autoSplashscreen: true` + no staged bundle + update found
   - overlay shows
   - download completes before timeout
   - reload happens
   - overlay hides after `notifyAppReady()`
8. `immediate` + `autoSplashscreen: true` + no staged bundle + fetch/check error
   - overlay shows
   - overlay hides
   - no reload
9. `immediate` + `autoSplashscreen: true` + no staged bundle + slow download
   - overlay shows
   - decision timeout fires
   - overlay hides
   - no reload for that resume
   - if download later completes, bundle remains staged
   - next resume uses the staged path
10. `immediate` + `autoSplashscreen: true` + no staged bundle + `checkInProgress`
    already true
    - no managed overlay shown
    - no second check starts

### Regression coverage

11. `immediate` + `autoSplashscreen: false`
    - current delayed visible reload behavior remains unchanged
12. `next-launch`
    - unchanged
13. `next-resume`
    - unchanged
14. runtime-change forced immediate cold start
    - unchanged
15. rollback after managed resume reload
    - fallback bundle eventually releases overlay through `notifyAppReady()`
16. Warm resume on a real Android device
    - verify overlay appears before the old WebView flashes

## Implementation Order

1. Rename the overlay state concept from launch-only to managed-overlay.
2. Add explicit resume decision states plus:
   - `beginManagedResumeAppReadyWait()` for already-staged resume activation
   - `beginManagedResumeSplash()` for fresh-check resume
   - explicit `inactive` preconditions on all managed resume entry helpers
3. Broaden `autoSplashscreenTimeout` docs to cover both decision phases.
4. On iOS, move the managed `immediate + autoSplashscreen: true` resume flow
   into `handleAppWillEnterForeground()`.
5. On Android, move the managed `immediate + autoSplashscreen: true` resume
   flow into `handleOnStart()` and add the one-shot
   `skipNextResumeAutoUpdate` handoff to `handleOnResume()`.
6. Claim `checkInProgress` before `beginManagedResumeSplash()` on the
   fresh-check resume path.
7. Implement the "late result after resume timeout stages but does not reload"
   rule.
8. Keep cold-start semantics unchanged and keep staged-resume activation aligned
   with the new helpers.
9. Reduce `runAutomaticUpdate(trigger: resume, ...)` to unmanaged resume paths
   only.
10. Run the test matrix, with special attention to Android warm-resume timing
    and timeout races.

## Bottom Line

v2 gave OtaKit the control surface needed to solve the hard resume case.

v3 is the actual feature completion:

- `immediate + autoSplashscreen` on resume becomes fully managed
- a resume update either happens behind the overlay or is deferred
- the delayed visible switch is no longer allowed on the managed path

## Review Disposition

The external review raised several valid plan-quality issues. v3 now resolves
them as follows:

- Accepted:
  - claim `checkInProgress` before showing the managed fresh-check resume
    overlay
  - require managed resume entrypoints to start only from `inactive`
  - state the helper precondition that `beginManagedResumeSplash()` is only
    valid after the guard is already claimed
  - make Android `handleOnResume()` interference explicit with a one-shot
    `skipNextResumeAutoUpdate` handoff
  - spell out exactly which resume cases remain in `runAutomaticUpdate(...)`
    after v3
- Explicitly deferred:
  - changing cold-start no-update behavior to wait for `notifyAppReady()`

That cold-start first-frame flash concern is real, but it is not folded into v3
because it would broaden the contract beyond resume completion. v3 keeps
`waitingForAppReady` reserved for flows where a reload actually happened.
