# Splash Screen Plan

## Goal

Eliminate the old-bundle flash on cold-start inline updates without adding a
messy second splash system for resume.

The feature should stay small and predictable:

- OtaKit either owns the launch splash for this cold start, or it gets out of
  the way quickly
- timeout must actually stop inline apply for this launch
- splash should not be hidden before `reloadWebView()`
- resume stays out of scope for v1

## Research Conclusions

These are the constraints the plan must respect:

- Capacitor SplashScreen docs: `launchAutoHide: false` keeps the launch splash
  visible until something manually calls `hide()`
- Capacitor SplashScreen docs: programmatic `show()` is not the Android 12
  launch splash, so "show again on resume" is a different UX path
- Current OtaKit immediate launch paths apply inline after async check/download,
  so hiding the splash before `reloadWebView()` does not guarantee the user sees
  the new bundle first
- Capgo's timeout works because timeout disables direct apply for the rest of
  that cycle; hiding the splash alone is not enough
- Android reflection into SplashScreen needs release keep rules; Capgo ships
  them explicitly

## V1 Scope

Included:

- cold start with `updateMode: "immediate"`
- cold start with `immediateUpdateOnRuntimeChange`
- holding the existing launch splash while OtaKit decides whether to apply
  inline on this launch
- keeping the splash visible across the inline reload
- releasing the splash from `notifyAppReady()`

Explicitly deferred:

- all resume cases
- programmatic `SplashScreen.show()`
- `next-resume` staged activation masking
- loaders and spinner overlays
- persisting splash state across process death

## Why Resume Is Out of Scope

Resume is where the plan got muddy.

For v1, we should not mix:

- native launch splash ownership
- programmatic splash overlays
- Android foreground timing tricks
- extra lifecycle observers just to re-show a splash

That is a different feature.

Cold start already covers the most important bad UX cases:

- `updateMode: "immediate"` on launch
- `immediateUpdateOnRuntimeChange` on launch

If we want resume masking later, that should be a separate design, likely as a
programmatic overlay path, not as "the same launch splash but again."

## Public API

```ts
export interface OtaKitConfig {
  autoSplashscreen?: boolean;
  autoSplashscreenTimeout?: number;
}
```

- `autoSplashscreen`
  - default `false`
  - when `true`, OtaKit manages the Capacitor launch splash on supported cold
    starts
- `autoSplashscreenTimeout`
  - default `10000`
  - minimum `1000`
  - applies only while OtaKit is waiting to decide whether to apply inline on
    this launch

## Maximum Visible Splash Time

This feature can intentionally hold the launch splash longer than today.

Worst-case visible splash duration is not just `autoSplashscreenTimeout`.

The upper bound can approach:

- `autoSplashscreenTimeout`
- plus `appReadyTimeout`
- plus the final rollback / reload handoff time

That worst case happens when:

1. OtaKit commits to an inline reload before splash timeout fires
2. the new bundle never calls `notifyAppReady()`
3. rollback happens after `appReadyTimeout`
4. the fallback app then finishes startup and calls `notifyAppReady()`

So docs should recommend:

- keep `autoSplashscreenTimeout` lower than `appReadyTimeout`
- treat `autoSplashscreenTimeout` as the "launch decision budget", not as the
  total possible splash duration

## Hard Prerequisites

This feature is not a soft enhancement. It depends on real app setup.

Required:

1. install `@capacitor/splash-screen`
2. set `SplashScreen.launchAutoHide: false`
3. call `notifyAppReady()` reliably on app startup, as already required by
   OtaKit

If `autoSplashscreen` is enabled but the SplashScreen plugin is missing, OtaKit
should log a clear error and stop its internal splash state machine for that
launch.

Important:

- if the app also has `launchAutoHide: false`, missing SplashScreen support can
  leave the app stuck on the launch splash
- that is a configuration error, not a graceful fallback

So docs must describe SplashScreen installation as a hard prerequisite, not an
"optional if present" integration.

## Core UX Model

When `autoSplashscreen` is enabled, every cold start must end in exactly one of
these three outcomes:

1. This launch is not an inline-update launch.
   OtaKit hides the launch splash immediately after native startup settles.

2. This launch is an inline-update launch, but OtaKit stays on the current
   bundle.
   OtaKit hides the splash after the check resolves, or after timeout, or after
   an error.

3. This launch is an inline-update launch, and OtaKit commits to reloading into
   a different bundle.
   OtaKit keeps the splash visible across the reload and releases it from
   `notifyAppReady()`.

That is the entire mental model.

No "hide before reload and hope the new frame is ready."

## State Model

Use one small in-memory launch state per process:

```text
inactive
holdingForLaunchDecision
timedOut
waitingForAppReady
```

Meaning:

- `inactive`
  - OtaKit is not managing the launch splash right now
- `holdingForLaunchDecision`
  - launch splash is visible
  - inline apply is still allowed on this launch
- `timedOut`
  - launch splash has already been hidden
  - inline apply is no longer allowed on this launch
- `waitingForAppReady`
  - OtaKit committed to an inline reload
  - launch splash stays up until the app calls `notifyAppReady()`

This state is intentionally in-memory only.

We do not persist it across app restarts in v1.

## Launch Eligibility

OtaKit should manage the launch splash only when both are true:

- `autoSplashscreen === true`
- this launch is an inline-update launch

Inline-update launch means:

- `updateMode == "immediate"` on cold start
- or `forceImmediateRuntimeChangeLaunch == true`

Everything else is a non-managed launch for splash purposes.

## Cold Start Flow

### Step 1: Decide whether this launch is managed

At cold start:

```text
shouldManageLaunchSplash =
  autoSplashscreen &&
  (updateMode == "immediate" || forceImmediateRuntimeChangeLaunch)
```

If `shouldManageLaunchSplash` is `false`:

- do not start a splash timeout
- do not keep splash waiting for app-ready
- hide the launch splash synchronously at the end of `load()`, after:
  - staged-on-launch activation decision
  - base-path application
  - pending-to-trial setup
  - but before starting any asynchronous automatic launch check
  - and before returning from `load()`
- run the normal OtaKit update flow unchanged

This rule avoids the stuck-splash bug when the user configured
`launchAutoHide: false` but this launch is not a managed inline-update launch.

### Step 2: Managed launch enters holding state

If `shouldManageLaunchSplash` is `true`:

- set splash state to `holdingForLaunchDecision`
- schedule the timeout
- enter the existing immediate-style launch path

This applies to:

- `updateMode: "immediate"` on cold start
- `immediateUpdateOnRuntimeChange` cold-start override

### Step 3: Resolve outcomes

#### Outcome A: No update / latest already current / latest suppressed

Behavior:

- finish existing no-update logic
- if runtime-change launch is being resolved, write the runtime key as today
- record check timestamp
- cancel timeout
- hide splash
- set state to `inactive`

#### Outcome B: Fetch or download error

Behavior:

- keep existing updater semantics
- do not write runtime key on failure
- cancel timeout
- hide splash
- set state to `inactive`

#### Outcome C: Update found and inline apply is still allowed

If splash state is still `holdingForLaunchDecision`:

- cancel timeout
- if runtime-change launch is being resolved, write runtime key just before
  activation, same as today
- transition state to `waitingForAppReady`
- activate staged bundle and reload
- do not hide splash here

This is the key v1 change.

We do not hide before `reloadWebView()`. We hand splash release to
`notifyAppReady()`.

#### Outcome D: Update found after timeout

If splash state is already `timedOut`:

- do not apply inline on this launch
- do not reload on this launch
- if the bundle finished downloading, leave it staged
- record check timestamp once the check/download flow completes successfully
- if this was a runtime-change launch, do not write the runtime key, because the
  app is still running the old bundle

This is the other key v1 change.

Timeout downgrades inline apply for the rest of the current launch.

It does not merely hide the splash and then still reload later.

Important next-launch behavior:

- if timeout fired but the latest bundle finished staging successfully, the next
  cold start can reuse that staged bundle immediately
- for `immediateUpdateOnRuntimeChange`, runtime remains unresolved because the
  current launch stayed on the old bundle
- so the next cold start re-enters the runtime-change override, finds the
  already-staged matching bundle, and applies it without re-downloading

## Timeout Semantics

The timeout only applies while splash state is `holdingForLaunchDecision`.

When timeout fires:

- transition state from `holdingForLaunchDecision` to `timedOut`
- hide the splash
- disable inline apply for the rest of this launch

The async update work may continue:

- if it later concludes "no update," OtaKit still records the check timestamp
  and resolves runtime key when appropriate
- if it later stages a bundle, the bundle stays staged for a later activation
- if it later fails, no runtime key write happens

This matches the real requirement:

- user gets unstuck
- current launch no longer surprises with a later reload

## Interaction With `notifyAppReady()`

`notifyAppReady()` becomes the release point for a managed inline reload.

New rule:

- if splash state is `waitingForAppReady`, `notifyAppReady()` must hide the
  splash and move state to `inactive`

Also explicit non-release rule:

- if splash state is `holdingForLaunchDecision`, `notifyAppReady()` must keep
  current bundle-success behavior unchanged, but must not release the splash

This release must happen independently of the existing bundle-status success
logic.

In other words:

- keep current `trial -> success` logic
- but splash release cannot sit behind `current.status == .trial/.pending` or
  `!current.isBuiltin()`

Why:

- after rollback, the app may now be on a builtin or already-success bundle
- we still need `notifyAppReady()` from that running app to release the splash

So splash release should happen outside, or before, the current status guard.

## Interaction With Rollback

Rollback should stay mostly unchanged in v1.

Rule:

- if splash state is `waitingForAppReady`, do not force-hide the splash inside
  rollback
- let the next running app instance in the same process release the splash via
  `notifyAppReady()`

This keeps the visual handoff simple:

- inline reload to new bundle
- if healthy, new bundle calls `notifyAppReady()` and splash goes away
- if unhealthy, rollback reloads fallback/builtin
- fallback/builtin calls `notifyAppReady()` and splash goes away

Known limitation:

- if the process dies during this sequence, the in-memory splash state is lost
- v1 does not attempt to persist splash handoff across process death

That is acceptable for v1. We should not add persisted splash state unless real
testing proves we need it.

## Interaction With Runtime Change Resolution

No broad rewrite is needed. Keep the runtime-key rules already planned and
implemented, with one important timeout clarification:

- no update / latest suppressed:
  - resolve runtime key
- inline apply committed before timeout:
  - resolve runtime key before activation
- timeout fired and bundle only staged:
  - do not resolve runtime key
- error:
  - do not resolve runtime key

That keeps runtime-change semantics honest:

- runtime is resolved only when current lane is truly settled on this launch

## Platform Plan

### iOS

Files:

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`

Needed changes:

- parse `autoSplashscreen` and `autoSplashscreenTimeout`
- add the in-memory splash state + timeout work item
- add `hideLaunchSplashIfNeeded()`
- add a `SplashScreen.hide()` bridge call helper
- wire managed launch handling into the immediate launch path
- wire `notifyAppReady()` to release the splash when state is
  `waitingForAppReady`

Not needed in v1:

- `showSplashscreen()`
- foreground notification splash re-show logic
- extra lifecycle observers

### Android

Files:

- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`
- add Android keep rules for release builds

Needed changes:

- parse `autoSplashscreen` and `autoSplashscreenTimeout`
- add the in-memory splash state + timeout runnable
- add `hideLaunchSplashIfNeeded()`
- add a reflective `SplashScreen.hide` helper
- wire managed launch handling into the immediate launch path
- wire `notifyAppReady()` to release the splash when state is
  `waitingForAppReady`
- add release keep rules for the reflective Capacitor bridge path

Not needed in v1:

- `ProcessLifecycleOwner`
- `SplashScreen.show()`
- resume splash logic

## Android Release Hardening

If Android uses reflection to construct a `PluginCall` and invoke the
SplashScreen plugin, release builds need matching keep rules.

This is mandatory, not optional.

At minimum preserve:

- `com.getcapacitor.Bridge.msgHandler`
- `com.getcapacitor.MessageHandler`
- the `PluginCall` constructor used by reflection
- the plugin invoke path used to call SplashScreen

Capgo had to ship explicit keep rules for this exact reason.

## Missing Plugin / Bridge Failure Policy

If `autoSplashscreen` is enabled and OtaKit cannot obtain a working SplashScreen
hide path:

- log a clear error
- stop internal splash orchestration for that launch

But documentation must be honest:

- if the app also configured `launchAutoHide: false`, the app may remain stuck
  on the splash

So this is not something we should describe as a harmless graceful degrade.

## Warnings

Warnings should be narrow and high-signal.

Warn when `autoSplashscreen: true` is configured in a way that can never produce
a managed launch.

Examples:

- `autoSplashscreen: true` with `updateMode: "manual"`
- `autoSplashscreen: true` with `updateMode: "next-launch"` or
  `updateMode: "next-resume"` and `immediateUpdateOnRuntimeChange !== true`

Do not warn on every non-managed launch.

That would be noisy and incorrect, because many non-managed launches are normal,
for example after a runtime-change launch has already been resolved.

## Manual Mode

Do nothing in v1.

`autoSplashscreen` should not try to cover:

- manual `check()`
- manual `download()`
- manual `apply()`
- manual `update()`

Manual mode can solve its own UX separately if ever needed.

## Test Matrix

### Core launch cases

1. `immediate` + `autoSplashscreen: true` + update available on cold start
   - splash stays visible
   - app reloads inline
   - splash hides only after `notifyAppReady()`
   - no old-bundle frame visible

2. `immediate` + `autoSplashscreen: true` + no update on cold start
   - splash hides after check completes
   - no reload

3. `immediate` + `autoSplashscreen: true` + fetch error
   - splash hides
   - no runtime key write
   - no reload

4. `immediate` + `autoSplashscreen: true` + slow download past timeout
   - splash hides at timeout
   - no inline reload happens later on this launch
   - if bundle eventually downloads, it stays staged

5. `immediateUpdateOnRuntimeChange` + `autoSplashscreen: true` + update
   available
   - same as case 1

6. `immediateUpdateOnRuntimeChange` + `autoSplashscreen: true` + timeout then
   staged latest
   - splash hides at timeout
   - no runtime key write
   - next cold start still treats runtime as unresolved

### Non-managed launch cases

7. `next-launch` + `autoSplashscreen: true` + no runtime-change override active
   - splash hides immediately after startup setup
   - app does not get stuck on splash

8. `next-resume` + `autoSplashscreen: true` + no runtime-change override active
   - same as case 7

9. `manual` + `autoSplashscreen: true`
   - splash hides immediately after startup setup
   - no special manual behavior

### App-ready handoff cases

10. inline update reloads into a healthy new bundle
    - splash stays visible across reload
    - `notifyAppReady()` hides it

11. inline update reloads into a broken bundle and rollback happens in the same
    process
    - fallback/builtin app can still release splash from `notifyAppReady()`

12. inline update launch followed by process death before app-ready
    - next launch follows normal cold-start logic
    - no persisted splash handoff expected in v1

### Android release checks

13. Android release/minified build
    - SplashScreen reflective hide path still works
    - app is not stuck on splash

## Docs Plan

Update:

- `packages/capacitor-plugin/src/definitions.ts`
- `packages/capacitor-plugin/README.md`
- `packages/site/app/docs/plugin/page.tsx`
- `packages/site/app/docs/setup/page.tsx`

Docs must be explicit about:

- cold-start only scope
- required `@capacitor/splash-screen` install
- required `launchAutoHide: false`
- timeout downgrading inline apply for the current launch
- `notifyAppReady()` being the release point after inline reload
- no resume support in v1

## Recommended Implementation Order

1. Add config parsing and the in-memory splash state model on both platforms
2. Add the hide-only SplashScreen bridge helper on both platforms
3. Add Android release keep rules for the reflective path
4. Wire cold-start gating:
   - managed launch vs immediate hide
5. Wire timeout behavior:
   - timeout hides splash and disables inline apply for this launch
6. Wire managed inline reload handoff:
   - keep splash visible across reload
   - do not hide before `reloadWebView()`
7. Wire `notifyAppReady()` splash release outside the existing status guard
8. Test cold-start matrix on Android and iOS
9. Document the feature and the hard prerequisites

## What Is Not In V1

- resume splash masking
- `SplashScreen.show()`
- Android `ProcessLifecycleOwner`
- spinner / loader overlays
- persisted splash handoff across process death
- manual-mode splash orchestration
