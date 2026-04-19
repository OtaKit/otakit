# @otakit/capacitor-updater

Capacitor OTA updater plugin for OtaKit.

## What it does

- fetches the latest manifest for its release lane from the CDN
- downloads and verifies OTA bundles
- stages updates safely
- activates them on the next launch, next resume, or immediately
- checks for updates on cold start and app resume (configurable interval)
- also supports fully manual update prompts when the app wants control
- supports optional `runtimeVersion` lanes for native compatibility boundaries
- requires `notifyAppReady()` as the success handshake
- rolls back automatically if the new bundle does not prove healthy

OtaKit publishes signed static manifests into object storage behind a CDN. The
plugin fetches the manifest for its `appId + channel + runtimeVersion` lane,
verifies it, compares it against the current and staged bundle locally, and
only downloads when the manifest actually points at something newer.

For normal app code, the main public methods are:

```ts
const state = await OtaKit.getState();
const latest = await OtaKit.check();

// Low-level manual flow:
const bundle = await OtaKit.download();
if (bundle) {
  await OtaKit.apply();
}

// Or the one-shot manual helper:
await OtaKit.update();
await OtaKit.notifyAppReady();
```

For manual mode, `getState()` tells you if something is already staged,
`check()` tells you whether a newer update exists, `download()` stages it, and
`update()` is the one-shot helper that downloads and applies the newest update.

## Hosted config

```ts
plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    appReadyTimeout: 10000,
    // Optional:
    // channel: "staging",
    // runtimeVersion: "2026.04",
    // updateMode: "next-resume",
    // immediateUpdateOnRuntimeChange: true,
    // autoSplashscreen: true,
    // autoSplashscreenTimeout: 8000,
    // autoSplashscreenBackgroundColor: "#000000",
    // updateMode: "manual",
    // updateMode: "immediate",
  }
}
```

Advanced overrides for self-hosting or custom trust only:

- `cdnUrl` for manifest and bundle delivery
- `ingestUrl` for event ingest requests
- `serverUrl` for self-hosted control-plane tooling such as the CLI. The native runtime uses `cdnUrl` and `ingestUrl` instead.
- `manifestKeys`
- `allowInsecureUrls`

Hosted OtaKit already points at the managed ingest service and CDN and already
trusts the managed manifest signing keys.

## Channels vs runtimeVersion

- `channel` answers "who should get this rollout?"
- `runtimeVersion` answers "which native app shell can safely run this bundle?"

Use channels for rollout tracks such as `beta`, `staging`, or `production`.

Use `runtimeVersion` when a new store build creates a new compatibility boundary and you do not
want devices on that new native shell to keep receiving older OTA bundles.

When `runtimeVersion` is set:

- the plugin requests bundle updates only for that runtime lane
- bundle uploads inherit the same runtime value automatically through the CLI
- releases stay simple: publish the bundle, and it naturally stays inside its own runtime lane

If you also set `immediateUpdateOnRuntimeChange: true`, OtaKit treats a fresh
install or a new `runtimeVersion` as a one-time startup override in automatic
`next-launch` / `next-resume` mode:

- it skips normal staged-on-launch activation once
- it bypasses `checkInterval`
- it checks live on cold start and applies immediately if a newer bundle exists

That gives new installs and new native shells a faster catch-up path without
changing normal resume behavior.

## Optional managed overlay

If you use inline updates, OtaKit can show its own native overlay so users do
not see an old-bundle frame before a managed reload.

```ts
plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    updateMode: "immediate",
    autoSplashscreen: true,
    autoSplashscreenTimeout: 8000,
    autoSplashscreenBackgroundColor: "#000000",
  }
}
```

Important scope and behavior:

- OtaKit owns the overlay directly. `@capacitor/splash-screen` is not required.
- it manages cold-start `updateMode: "immediate"` launches and cold-start
  `immediateUpdateOnRuntimeChange` overrides
- in `updateMode: "immediate"`, it also manages resume end to end:
  - if a valid staged bundle already exists, it reloads behind the overlay
  - if no staged bundle exists yet, it can check/download behind the overlay and
    either reload before timeout or defer the staged bundle to a later resume
- if `autoSplashscreenTimeout` fires, OtaKit hides the overlay and does not
  apply inline later during that same managed launch or resume decision attempt
- if a bundle already finished staging by then, it stays staged for the next
  activation path

`autoSplashscreenBackgroundColor` accepts exact `#rrggbb` values.

This feature is intentionally optional. If you do not need reload masking,
leave `autoSplashscreen` off.

## Trust model

The plugin does not just download from a URL and trust the result.

1. it fetches the latest manifest from the CDN for its app + channel + runtimeVersion lane
2. it verifies the manifest signature when manifest keys are configured
3. it compares that manifest against the current and staged bundle already on the device
4. if the manifest is newer, it downloads the bundle zip
5. it verifies the zip against the manifest `sha256`
6. it stages and activates the bundle

In the hosted path, managed signing keys are already built in.

## Update modes

All automatic modes check for updates on **cold start** (always) and **app
resume**.

### Production modes

- `next-launch` (default)
  check and download in the background on cold start and resume.
  activate the staged bundle only on the next cold start.
  zero disruption during a session — the user never sees a surprise reload.

- `next-resume` (more eager)
  check and download in the background on cold start and resume.
  activate the staged bundle on the next resume or cold start.

### Manual mode

- `manual`
  no automatic checks, no automatic staged activation.
  the app integration drives everything via `check()`, `download()`, `apply()`, or `update()`.

### Development mode

- `immediate`
  checks, downloads, and activates in one shot as soon as possible on cold start and resume.
  primarily for development and testing — not recommended for production.

If you also enable `autoSplashscreen`, the cold-start side of `immediate` can
hold the OtaKit overlay across the reload instead of briefly showing the old
bundle first. On resume, `immediate` can also keep update application behind
the OtaKit overlay instead of allowing a delayed visible switch.

## Runtime model

The plugin keeps three important runtime pointers:

- `current`
  the bundle the WebView is currently serving
- `fallback`
  the last known-good bundle used for rollback
- `staged`
  a downloaded bundle waiting to be activated

Bundle lifecycle is intentionally small:

```text
download -> pending -> trial -> success
                        |
                        +-> error -> rollback -> delete failed files
```

In practice:

- downloads start as `pending`
- an activated bundle becomes `trial`
- `notifyAppReady()` promotes `trial` to `success`
- timeout or restart during `trial` causes rollback

That gives the plugin a small but important safety model:

- `current` is what is serving now
- `fallback` is the last known-good bundle
- `staged` is what can be activated next
- rollback always goes back to `fallback`, not to an arbitrary older bundle

## Automatic and manual flows

### Automatic flow

For the normal hosted path, the app usually just needs to call:

```ts
await OtaKit.notifyAppReady();
```

The plugin handles checking, downloading, activation, and rollback based on
`updateMode`. In `next-launch` and `next-resume`, it checks on cold start and
every time the app comes back from the background, throttled by `checkInterval`.
`immediate` bypasses that throttle.

If `immediateUpdateOnRuntimeChange` is enabled, the first cold start for a new
runtime lane also bypasses the throttle and uses an immediate-style launch
check. After that first lane resolution, normal mode behavior resumes.

For most apps, this is the entire runtime integration.

### Manual flow

For app-driven prompts:

```ts
const state = await OtaKit.getState();
const latest = await OtaKit.check();

if (latest) {
  await OtaKit.update();
}
```

Or the split version:

```ts
await OtaKit.download();
await OtaKit.apply();
```

Use the split flow when the app wants to download in the background and switch
only after explicit user confirmation.

## Throttle

`checkInterval` (default 10 min) only applies to automatic checks in
`next-launch` and `next-resume`. Manual `check()` / `download()` calls are
always live, and `immediate` mode ignores the interval entirely.

## Retention and deletion

- the builtin, current, fallback, and staged bundles are protected
- superseded staged bundles are deleted automatically
- failed trial bundles are deleted during rollback

## Source areas

- `src/definitions.ts`: public types and methods
- `src/index.ts`: Capacitor registration and JS wrapper
- `src/web.ts`: web fallback implementation
- `ios/Sources/UpdaterPlugin/*`: iOS implementation
- `android/src/main/java/com/otakit/updater/*`: Android implementation

## Build locally

```bash
pnpm --filter @otakit/capacitor-updater build
pnpm --filter @otakit/capacitor-updater typecheck
```

Repo-level verification:

```bash
npm run build
```
