# @otakit/capacitor-updater

Capacitor OTA updater plugin for OtaKit.

## What it does

- checks the manifest endpoint for a newer bundle
- downloads and verifies OTA bundles
- stages updates safely
- activates them on the next launch, next resume, or immediately
- checks for updates on cold start and app resume (configurable interval)
- also supports fully manual update prompts when the app wants control
- requires `notifyAppReady()` as the success handshake
- rolls back automatically if the new bundle does not prove healthy

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

Manual inspection and support methods like state inspection and reset live under
`OtaKit.debug`.

## Hosted config

```ts
plugins: {
  OtaKit: {
    appId: "YOUR_OTAKIT_APP_ID",
    appReadyTimeout: 10000,
    // Optional:
    // channel: "staging",
    // updateMode: "next-resume",
    // updateMode: "manual",
    // updateMode: "immediate",
  }
}
```

Advanced overrides for self-hosting or custom trust only:

- `serverUrl`
- `manifestKeys`
- `allowInsecureUrls`

Hosted OtaKit already points at `https://otakit.app/api/v1` and already trusts
the managed manifest signing keys.

## Trust model

The plugin does not just download from a URL and trust the result.

1. it fetches a manifest from the server
2. it verifies the manifest signature when manifest keys are configured
3. it downloads the bundle zip
4. it verifies the zip against the manifest `sha256`
5. it stages and activates the bundle

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

### Dev/debug mode

- `immediate`
  checks, downloads, and activates in one shot as soon as possible on cold start and resume (the user may briefly see the previous version before a reload).
  primarily for development and testing — not recommended for production.


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
`updateMode`. It checks on cold start and every time the app comes back from
the background (throttled by `checkInterval`).

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

All server checks are rate-limited by `checkInterval` (default 10 min).
This applies to automatic resume checks and to manual `check()` / `download()`
calls. Within the interval, calls return the staged bundle if one exists, or
null.

## Retention and deletion

- the builtin, current, fallback, and staged bundles are protected
- superseded staged bundles are deleted automatically
- failed trial bundles are deleted during rollback
- `debug.deleteBundle()` only works for downloaded bundles outside runtime state

## Source areas

- `src/definitions.ts`: public types and methods
- `src/index.ts`: Capacitor registration and JS wrapper
- `src/web.ts`: web fallback implementation
- `ios/Sources/UpdaterPlugin/*`: iOS implementation
- `android/src/main/java/com/updatekit/updater/*`: Android implementation

## Build locally

```bash
pnpm --filter @otakit/capacitor-updater build
pnpm --filter @otakit/capacitor-updater typecheck
```

Repo-level verification:

```bash
npm run build
```
