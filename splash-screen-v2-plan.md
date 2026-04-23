# Splash Screen Plan v2 - OtaKit-Owned Overlay

## Summary

This plan replaces the current SplashScreen-plugin-coupled flow with an
OtaKit-owned native overlay view.

The overlay is used in exactly two cases:

1. Cold start, when OtaKit is doing an inline apply before the app becomes
   interactive.
2. Immediate-mode resume, but only when a valid staged bundle already exists
   before the app returns to the foreground.

This plan does not try to mask the separate resume path where no staged bundle
exists and OtaKit performs a fresh check/download in the background.

## Why Change the Current Approach

The current design depends on `@capacitor/splash-screen` and has structural
problems:

- OtaKit only works if the app also installs and configures another plugin.
- `launchAutoHide: false` must be set before OtaKit even runs.
- Hiding the splash screen currently depends on reflection into another
  plugin's internals.
- Android needs a synthetic `PluginCall` path that is brittle in release builds.
- Programmatic `SplashScreen.show()` on Android is already a custom overlay, not
  the system launch splash, so there is no real advantage in going through the
  plugin.

Owning the overlay directly removes those dependencies and makes the behavior
local to OtaKit.

## Scope

### In scope

- Cold-start masking for:
  - `updateMode: "immediate"`
  - forced immediate launch on runtime change
- Resume masking for:
  - `updateMode: "immediate"`
  - a valid staged bundle already exists before resume
- A solid-color native overlay with instant show and a short fade-out

### Out of scope

- Resume masking when no staged bundle exists and OtaKit must first check and
  download
- `next-resume` masking
- Matching the native launch-screen artwork
- Spinner, logo, or richer loading UI
- Malformed color-string handling beyond documenting the accepted format

## Resume Scope - Explicit Decision

Immediate-mode resume has two different behaviors today:

1. A staged bundle already exists. OtaKit activates it immediately and reloads.
2. No staged bundle exists. OtaKit performs a background check/download and may
   later decide to reload.

This plan covers path 1 only.

Path 2 is intentionally excluded from v1 because:

- there is no deterministic "reload will happen" signal at resume entry
- the check/download can take an arbitrary amount of time
- masking that path requires a separate timeout and separate hide rules
- the user is already inside the app, so the UX problem is less severe than
  cold start

If path 2 is ever added, it should be treated as a separate feature with its
own state and timeout rules.

## Public Config

```ts
export interface OtaKitConfig {
  autoSplashscreen?: boolean;
  autoSplashscreenTimeout?: number;
  autoSplashscreenBackgroundColor?: string;
}
```

- `autoSplashscreen`
  - default: `false`
- `autoSplashscreenTimeout`
  - default: `10000`
  - minimum: `1000`
  - used only for cold start
- `autoSplashscreenBackgroundColor`
  - default: `"#000000"`
  - accepted format for v1: exact `#rrggbb`

The app no longer needs:

- `@capacitor/splash-screen`
- `SplashScreen.launchAutoHide: false`

## Behavioral Contract

### Cold start

Cold start is managed only when:

```text
manageLaunchSplash =
  autoSplashscreen &&
  (updateMode == "immediate" || forceImmediateRuntimeChangeLaunch)
```

When `manageLaunchSplash` is true:

- OtaKit shows its own overlay in `load()`
- OtaKit enters the cold-start "waiting for decision" state
- OtaKit performs the automatic update flow
- OtaKit hides the overlay only through one of the cold-start exit paths

Cold-start exit paths:

- no update or suppressed update
- fetch/check/download error
- timeout
- successful reload followed by `notifyAppReady()`

When `manageLaunchSplash` is false, OtaKit does not show an overlay.

### Resume

Resume is managed only when all of the following are true:

- `autoSplashscreen == true`
- `updateMode == "immediate"`
- a valid staged bundle is available for immediate activation

"Valid staged bundle" must mean the same thing the reload path itself accepts.
Do not duplicate a weaker check in the lifecycle handler.

The plan should use a shared helper for this predicate, for example:

- staged bundle ID exists
- bundle record exists
- bundle is runtime-compatible

If the staged bundle is missing or invalid, the helper must return `nil` and the
overlay must not be shown.

When resume is managed:

- show the overlay before the app becomes visible again
- move directly to `waitingForAppReady`
- let the existing resume activation path reload the WebView
- hide the overlay only when the new bundle confirms healthy via
  `notifyAppReady()`
- if the new bundle rolls back in the same process, the restored bundle's
  `notifyAppReady()` also releases the overlay

When resume is not managed, behavior is unchanged. That includes the separate
background check/download path with no overlay.

## State Machine

Keep the existing state model, but define the semantics precisely:

- `inactive`
  - OtaKit is not currently holding an overlay
- `holdingForLaunchDecision`
  - cold start only
  - overlay is visible while immediate launch check/download is in progress
- `waitingForAppReady`
  - overlay is visible and a reloaded bundle must call `notifyAppReady()`
- `timedOut`
  - cold start only
  - the launch wait already timed out and inline reload for this launch is no
    longer allowed

### Allowed transitions

Cold start:

```text
inactive -> holdingForLaunchDecision -> waitingForAppReady -> inactive
inactive -> holdingForLaunchDecision -> timedOut -> inactive
```

Resume:

```text
inactive -> waitingForAppReady -> inactive
```

### Invariants

- Only cold start may enter `holdingForLaunchDecision`.
- Only cold start may enter `timedOut`.
- Resume must never call `finishManagedLaunchDecision()`.
- Resume must never depend on the cold-start timeout path.
- `notifyAppReady()` should only hide the overlay when state is
  `waitingForAppReady`.

## App-Ready Contract

The current broad "should hide on app ready" behavior is not the right long-term
contract for this design.

Replace it with a stricter helper, conceptually:

```text
completeManagedOverlayOnAppReady() -> Bool
```

Required behavior:

- if state is `waitingForAppReady`
  - cancel the cold-start timeout if one exists
  - transition to `inactive`
  - return `true`
- if state is `timedOut`
  - transition to `inactive`
  - return `false`
- if state is `inactive`
  - return `false`
- if state is `holdingForLaunchDecision`
  - return `false`

`notifyAppReady()` should call `hideOtaKitOverlay()` only when this helper
returns `true`.

That keeps the ownership rule simple:

- cold start no-update/error/timeout hides through the cold-start flow
- reload success hides through `notifyAppReady()`
- resume uses only the `waitingForAppReady -> inactive` path

## Overlay Contract

The overlay itself is intentionally simple:

- full-screen solid color
- no image
- no spinner
- instant show
- 200ms fade-out on hide

### Idempotency rules

`showOtaKitOverlay()` must be idempotent:

- if an overlay is already tracked, do nothing
- if two show calls race, only one view may be attached

Cold-start attach rule:

- when `showOtaKitOverlay()` is called from `load()` and execution is already on
  the main thread, it must attach synchronously
- do not unconditionally dispatch async from `load()`
- otherwise the attach can be deferred until after `load()` returns, which is
  too late to guarantee masking before the WebView starts executing
- only dispatch to the main thread when the caller is not already on it

`hideOtaKitOverlay()` must also be safe to call repeatedly:

- if no overlay is tracked, do nothing
- clear the tracked reference before starting the fade-out animation so a new
  show can attach a fresh view immediately if needed

During fade-out it is acceptable for the old view to finish its animation while
the new tracked view already exists. The important rule is that there is never
an untracked permanent overlay left behind.

## iOS Plan

File:
`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`

### New state

```swift
private var otaOverlayView: UIView?
private var autoSplashscreenBackgroundColor: UIColor = .black
```

### Color contract

Read `autoSplashscreenBackgroundColor` once in `load()`.

Accepted format for v1 is exact `#rrggbb`. This plan does not add malformed
color handling. The documentation should state that contract clearly.

### Overlay helpers

Use `bridge?.viewController?.view` as the parent view.

`showOtaKitOverlay()` requirements:

- return immediately if `autoSplashscreen == false`
- return immediately if an overlay is already tracked
- allocate a `UIView` sized to the parent bounds
- set autoresizing for width and height
- if already on the main thread, attach synchronously
- otherwise dispatch to the main thread
- re-check `otaOverlayView == nil` inside the actual attach path before attaching

`hideOtaKitOverlay()` requirements:

- run on the main thread
- return if no overlay is tracked
- set `otaOverlayView = nil` before the fade-out starts
- animate alpha to zero over 200ms
- remove the old view in the completion block

### Cold-start wiring

In `load()`:

- compute `manageLaunchSplash` exactly as today
- if `manageLaunchSplash` is true:
  - show the overlay
  - call the existing cold-start state/timeout helper
- if `manageLaunchSplash` is false:
  - do nothing visually

The existing cold-start state helper should remain responsible only for state
and timeout scheduling. It should no longer imply anything about Capacitor's
SplashScreen plugin.

All cold-start hide call sites that currently go through
`hideLaunchSplashIfNeeded(...)` should instead:

1. update state through the correct state helper
2. call `hideOtaKitOverlay()` only when that state helper says a visual hide is
   required

### Resume wiring

`handleAppWillEnterForeground()` should:

1. ask a shared "valid staged bundle for reload" helper whether resume masking
   is allowed
2. if the helper returns a bundle:
   - show the overlay
   - set state to `waitingForAppReady`
3. call `runAutomaticUpdate(trigger: .resume, forceImmediateLaunch: false,
   manageLaunchSplash: false)` unchanged

Do not duplicate a weaker staged-bundle check directly in the lifecycle method.
The same validity rules must be used by both the overlay decision and the
activation path.

### Remove

- `invokeSplashScreenHide()`
- `hideLaunchSplashOnMain(reason:allowDeferredRetry:)`
- `hideLaunchSplashIfNeeded(reason:allowDeferredRetry:)`
- the deferred retry path that only existed to wait for SplashScreen plugin
  readiness

## Android Plan

File:
`packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`

### New state

```java
private View otaOverlayView;
private int autoSplashscreenBackgroundColor = Color.BLACK;
```

### Color contract

Read `autoSplashscreenBackgroundColor` once in `load()`.

Accepted format for v1 is exact `#rrggbb`. This plan does not add malformed
color handling. The documentation should state that contract clearly.

### Overlay helpers

Use the Capacitor root view as the parent.

`showOtaKitOverlay()` requirements:

- return immediately if `autoSplashscreen == false`
- return immediately if an overlay is already tracked
- if already on the main thread, attach synchronously
- otherwise post to the main thread
- re-check `otaOverlayView == null` inside the actual attach path before
  attaching
- add a full-screen `View` to the chosen root view

`hideOtaKitOverlay()` requirements:

- return immediately if `autoSplashscreen == false`
- post to the main thread
- return if no overlay is tracked
- set `otaOverlayView = null` before starting the fade-out
- animate alpha to zero over 200ms
- remove the old view in the end action

### Cold-start wiring

Same as iOS:

- show overlay only when `manageLaunchSplash` is true
- keep the existing cold-start timeout/state helper for state only
- replace the visual hide path with `hideOtaKitOverlay()`

### Resume wiring

Use `handleOnStart()` for the resume-only overlay show:

1. ask the same shared "valid staged bundle for reload" helper whether resume
   masking is allowed
2. if valid:
   - show the overlay
   - set state to `WAITING_FOR_APP_READY`
3. leave `handleOnResume()` unchanged so it still runs the existing automatic
   resume logic

This must be validated on a real device. The plan assumes `handleOnStart()`
happens early enough on warm resume that the user does not see the old WebView
content first.

### Remove

- `invokeSplashScreenHide()`
- `hideLaunchSplashOnMain(reason, allowDeferredRetry)`
- the retry path
- `NoOpPluginCall`
- `PluginHandle` if it becomes unused

## Shared Helper for Resume Eligibility

To keep the overlay decision and the activation path aligned, factor the staged
bundle validation into shared logic instead of repeating pieces of it.

The shared helper should answer one question only:

```text
Is there a staged bundle that can be activated for reload right now?
```

Minimum checks:

- staged bundle ID exists
- bundle record exists
- runtime is compatible

If these checks fail, the helper returns "no valid staged bundle" and the resume
overlay must not be shown.

## Test Matrix

### Cold start

1. `immediate` + `autoSplashscreen: true` + update available
   - overlay shows
   - app reloads inline
   - `notifyAppReady()` hides overlay
2. `immediate` + `autoSplashscreen: true` + no update
   - overlay shows briefly
   - cold-start decision path hides overlay
3. `immediate` + `autoSplashscreen: true` + fetch/check/download error
   - cold-start error path hides overlay
4. `immediate` + `autoSplashscreen: true` + download exceeds timeout
   - timeout path hides overlay
   - inline reload does not happen for that launch
5. `immediateUpdateOnRuntimeChange` + unresolved runtime + update available
   - same behavior as case 1

### Resume

6. `immediate` + `autoSplashscreen: true` + valid staged bundle present
   - overlay shows before app becomes visible
   - staged bundle activates
   - app reloads
   - `notifyAppReady()` hides overlay
7. `immediate` + `autoSplashscreen: true` + staged bundle ID missing
   - no overlay
   - normal resume behavior
8. `immediate` + `autoSplashscreen: true` + staged bundle record missing
   - no overlay
   - normal resume behavior
9. `immediate` + `autoSplashscreen: true` + staged bundle present but not
   runtime-compatible
   - no overlay
   - normal resume behavior
10. `immediate` + `autoSplashscreen: true` + no staged bundle
   - no overlay
   - normal resume behavior
   - background check/download path remains unmasked in v1
11. Resume reload fails and the app rolls back in the same process
   - restored bundle calls `notifyAppReady()`
   - overlay is released

### Overlay behavior

12. `showOtaKitOverlay()` called twice in quick succession
   - only one tracked overlay remains
   - no orphaned permanent overlay
13. `hideOtaKitOverlay()` called when no overlay is present
   - no crash
   - no state corruption

### Android validation

14. Warm resume on a real Android device
   - confirm `handleOnStart()` is early enough to avoid visible old-content flash
15. Android release build
   - overlay behavior works without ProGuard or reflection issues

## Implementation Order

1. Add `showOtaKitOverlay()` and `hideOtaKitOverlay()` on both platforms.
2. Read `autoSplashscreenBackgroundColor` in `load()`.
3. Keep the existing cold-start state/timeout helpers, but remove all visual
   dependence on the Capacitor SplashScreen plugin.
4. Replace visual hide call sites with `hideOtaKitOverlay()`.
5. Replace the broad app-ready hide helper with the stricter
   `completeManagedOverlayOnAppReady()` contract.
6. Factor staged-bundle validity into shared resume-eligibility logic.
7. Wire cold-start overlay show.
8. Wire resume overlay show:
   - iOS in `handleAppWillEnterForeground()`
   - Android in `handleOnStart()`
9. Remove reflection-based SplashScreen integration and Android helper types
   that only existed for that path.
10. Run the test matrix, with special attention to Android warm-resume timing.
