# Splash Screen Plan

## Goal

Avoid cold-start immediate update flicker with the smallest native behavior.

Use the standard Capacitor Splash Screen plugin. OtaKit should not implement its
own UI, loader, or splash manager.

## Public API

No config option. OtaKit always fires `SplashScreen.hide()` at safe startup
points. If the plugin is not installed the call is a no-op.

Recommended app startup:

```ts
await OtaKit.notifyAppReady();
```

When using the Capacitor Splash Screen plugin, app code should not call
`SplashScreen.hide()` during normal startup. OtaKit owns that hide call.

## Native Rule

Do not call `SplashScreen.show()`.

Only call `SplashScreen.hide()`.

No pending JS calls.
No delayed `notifyAppReady()`.
No operation counters.
No `coldStartImmediateRunning` flag.

Use only:

```text
startupImmediate
current bundle status
```

## notifyAppReady()

Keep existing health behavior:

- cancel trial timeout
- mark current trial bundle success
- update fallback pointer
- cleanup old fallback
- emit existing events/ingest
- resolve the plugin call

Then hide splash if safe.

Set one immutable startup decision during `dispatchColdStart()`:

```text
startupImmediate = selected cold-start policy is immediate
```

This is not a running operation flag. It is just the cold-start mode selected
once during startup.

Then in `notifyAppReady()`:

```text
currentIsTrial = current bundle status is trial

if currentIsTrial OR not startupImmediate:
  hideSplash()
```

Meaning:

- old builtin/success JS during cold-start immediate does not hide splash
- new trial JS after an immediate reload does hide splash
- normal startup modes hide splash from `notifyAppReady()`

## Cold-Start Immediate Flow

In `handleRuntime()` / `handleLaunch()` when the selected policy is
`immediate`, hide splash on no-reload terminal results only when the current
bundle is not trial:

- no update
- blocked by latest failed bundle (surfaces as no_update in downloadLatest)
- check/network/download error
- apply failure before reload

If the current bundle is trial, wait for `notifyAppReady()` to hide the splash.

Do not hide when an update is about to apply and reload.

The reloaded bundle will call `notifyAppReady()`, and that call hides splash.

Because `executeAutomaticUpdate` is shared across policies, handle errors
inside the immediate closure rather than in the shared catch block:

```text
executeColdStartImmediate:
  try:
    result = downloadLatest()
    if noUpdate and current is not trial: hideSplash()
    if staged: requireApplyStaged(reload=true)  // no hide, reload coming
  catch:
    if current is not trial: hideSplash()
```

## Native Implementation

Add `hideSplash()` on both platforms.

It should:

- find `SplashScreen` plugin at runtime
- call `hide` fire-and-forget
- run on the main thread where needed (dispatch async, do not block)
- log and continue if the plugin or method is missing

Do not add a hard native dependency on `@capacitor/splash-screen`.

## Docs And Demo

Update loading-screen docs and demo app:

```ts
plugins: {
  SplashScreen: {
    launchAutoHide: false,
  },
  OtaKit: {
    // no splashScreen option needed
  },
}
```

Startup:

```ts
await OtaKit.notifyAppReady();
```

Remove any direct `SplashScreen.hide()` call from app startup code. OtaKit
handles it.

Explain:

- OtaKit hides the splash automatically when safe.
- This fixes cold-start immediate flicker.
- Resume/manual reloads are separate. If an app wants those covered, it can
  call `SplashScreen.show({ autoHide: false })` before manual `apply()` or
  `update()`.

## Verification

- no update: cold-start immediate hides splash after check completes
- immediate update: old builtin/success JS does not hide splash before reload
- new trial bundle hides splash from `notifyAppReady()`
- network/download error: native immediate hides splash and old app continues
- `launchPolicy: "apply-staged"` hides from new bundle `notifyAppReady()`
- app builds without Splash Screen plugin installed
