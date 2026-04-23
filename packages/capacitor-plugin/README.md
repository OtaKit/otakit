# @otakit/capacitor-updater

Capacitor OTA updater plugin for OtaKit.

## What it does

- fetches the latest manifest for its release lane from the CDN
- downloads and verifies OTA bundles
- stages updates safely
- applies staged bundles on cold start, resume, or manual command
- uses `notifyAppReady()` as the health handshake
- rolls back automatically if a newly applied bundle does not prove healthy

The plugin is intentionally small:

- three automatic lifecycle entry points: runtime, launch, resume
- one shared set of update primitives: check, download, apply
- one rollback safety loop

There is no built-in splash or overlay manager in this model.

## Hosted config

```ts
plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    appReadyTimeout: 10000,

    // Optional:
    // channel: "staging",
    // runtimeVersion: "2026.04",
    // launchPolicy: "apply-staged",
    // resumePolicy: "shadow",
    // runtimePolicy: "immediate",
    // checkInterval: 600000,
  }
}
```

Advanced overrides for self-hosting or custom trust only:

- `cdnUrl`
- `ingestUrl`
- `serverUrl`
- `manifestKeys`
- `allowInsecureUrls`

Hosted OtaKit already points at the managed ingest service and CDN and already
trusts the managed manifest signing keys.

## Policies

The plugin has three automatic events:

- `runtime`
  Cold start where the current `runtimeVersion` lane has not been resolved yet.
- `launch`
  Normal cold start after runtime is already resolved.
- `resume`
  App returning from background.

Each event uses the same policy names:

```ts
type OtaKitPolicy = 'off' | 'shadow' | 'apply-staged' | 'immediate';
```

Semantics:

- `shadow`
  check + download, never apply on that event
- `apply-staged`
  apply a staged bundle if one already exists, otherwise behave like `shadow`
- `immediate`
  check + download + apply

Recommended defaults:

```ts
launchPolicy = 'apply-staged';
resumePolicy = 'shadow';
runtimePolicy = 'immediate';
```

That means:

- fresh install or new `runtimeVersion`: catch up immediately
- later cold starts: apply already staged content if present, otherwise download
  the next update in the background
- resumes: periodically check and stage in the background

If an app wants full JS control:

```ts
launchPolicy = 'off';
resumePolicy = 'off';
runtimePolicy = 'off';
```

## Check interval

`checkInterval` defaults to 10 minutes and only applies to background resume
checks:

- `resumePolicy: "shadow"`
- `resumePolicy: "apply-staged"` when there is no staged bundle to apply

Set `checkInterval` to `0` or a negative value to disable resume throttling.

It does not throttle:

- launch handling
- runtime handling
- `immediate`
- manual JS APIs

## Runtime model

The plugin keeps three important pointers:

- `current`
  the bundle the WebView is serving now
- `fallback`
  the last known-good bundle used for rollback
- `staged`
  a downloaded bundle waiting to be activated

Bundle lifecycle:

```text
download -> pending -> trial -> success
                        |
                        +-> error -> rollback
```

If a bundle is applied and never calls `notifyAppReady()`:

- timeout triggers rollback while the app is running
- or the next cold start detects the still-trial bundle and rolls back before
  boot continues

The last failed applied bundle is persisted so the plugin does not immediately
download and apply the same broken release again.

## Automatic flow

For the normal hosted path, most apps only need:

```ts
await OtaKit.notifyAppReady();
```

The plugin handles checking, staging, applying, rollback, and runtime-lane
catch-up based on the configured policies.

## Loading screen recommendation

OtaKit does not manage a splash screen or loading overlay for you.

Recommended startup order:

1. keep a native splash screen or fullscreen loading view visible
2. finish your normal app bootstrap
3. call `notifyAppReady()`
4. hide the splash screen or loading view

For React and Next.js apps, treat this as part of the default setup, not an
optional polish step.

## Manual APIs

The manual surface maps to the same internal engine:

```ts
const state = await OtaKit.getState();
const check = await OtaKit.check();
const download = await OtaKit.download();
await OtaKit.notifyAppReady();
```

`check()` returns:

```ts
type CheckResult =
  | { kind: 'no_update' }
  | { kind: 'already_staged'; latest: LatestVersion }
  | { kind: 'update_available'; latest: LatestVersion };
```

`download()` returns:

```ts
type DownloadResult = { kind: 'no_update' } | { kind: 'staged'; bundle: BundleInfo };
```

`update()` uses the same native immediate-flow operation as automatic
`"immediate"` policies:

```ts
await OtaKit.update();
```

That keeps the manual convenience path atomic inside the native plugin instead
of splitting it into separate `download()` and `apply()` calls.

`apply()` and successful `update()` are terminal operations:

- on success they reload the WebView
- they do not resolve back into the old JS context
- call `notifyAppReady()` from normal startup after the reloaded app boots

There is no listener/event API in this refactor. If an app later needs a
smaller reactive surface, that can be added intentionally.

## Example manual flow

```ts
const check = await OtaKit.check();

if (check.kind === 'update_available') {
  const result = await OtaKit.download();
  if (result.kind === 'staged') {
    await OtaKit.apply();
  }
}
```

Or use the one-shot helper:

```ts
await OtaKit.update();
```

After the app reloads and starts again, call:

```ts
await OtaKit.notifyAppReady();
```

## Compatibility lanes

- `channel` answers "who should get this rollout?"
- `runtimeVersion` answers "which native app shell can safely run this bundle?"

Use channels for rollout tracks such as `beta`, `staging`, or `production`.

Use `runtimeVersion` when a new store build creates a new compatibility
boundary and you do not want devices on that native shell to keep receiving
older OTA bundles.

## Trust model

The plugin does not just download arbitrary zips from a URL.

1. it fetches the latest manifest for the current app + channel + runtime lane
2. it verifies the manifest signature when keys are configured
3. it compares the manifest with current, staged, and last-failed local state
4. it downloads only when a newer usable bundle exists
5. it verifies the zip against the manifest `sha256`
6. it stages and later applies the bundle

## Source areas

- `src/definitions.ts`: public types and config
- `src/index.ts`: Capacitor registration and JS wrapper
- `src/web.ts`: web fallback implementation
- `ios/Sources/UpdaterPlugin/*`: iOS implementation
- `android/src/main/java/com/otakit/updater/*`: Android implementation
