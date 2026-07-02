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

## Force-immediate releases

A release (or revert) can be marked **force immediate** in the dashboard or
with `otakit release --force-immediate`. The flag is baked into the signed
manifest; when a device's automatic flow sees it, `shadow` and `apply-staged`
events escalate to the `immediate` behavior for that release: download, apply,
and reload on that event.

Bounds to keep in mind:

- It is "immediate on the next event/check", not push — delivery is bounded by
  lifecycle events and `checkInterval` (static CDN, no server→device channel).
- `off` policies never fetch a manifest, so they never see the flag. `off`
  stays the device-owned kill switch, and the manual APIs are unchanged.
- Trial and rollback still apply: a forced bundle that never calls
  `notifyAppReady()` rolls back like any other.
- It reloads the app under the user, possibly mid-task. Use it for broken
  releases, not routine rollouts.

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

## Events

The plugin emits lifecycle events alongside the pull APIs:

```ts
OtaKit.addListener('updateAvailable', (latest) => {}); // newer bundle found, before download
OtaKit.addListener('updateStaged', ({ bundle }) => {}); // downloaded + verified + staged
OtaKit.addListener('updateApplied', ({ bundle }) => {}); // new bundle confirmed healthy
OtaKit.addListener('downloadFailed', (failure) => {}); // non-terminal download/verify error
OtaKit.addListener('rollback', (failure) => {}); // applied bundle reverted (notify timeout)
OtaKit.removeAllListeners();
```

Events fire only while the app process is alive — there is no buffering or
replay. Reconcile on startup:

- a bundle staged in a previous session: `getState().staged`
- a startup rollback (app restarted before `notifyAppReady()`): it happens
  before any JS runs, so it never reaches a listener — check
  `getLastFailure()`

`apply()` reloads the WebView and destroys the JS context, so `updateApplied`
fires in the _reloaded_ bundle. Attach `updateApplied`/`rollback` listeners
early in app startup, not in the restart click handler.

Download and stage are atomic in this plugin — there is a single
`updateStaged` event, not separate "downloaded" and "staged" events.

The headline pattern — background download via `shadow` policies, prompt to
restart:

```ts
const state = await OtaKit.getState();
if (state.staged) showRestartPrompt(state.staged);
OtaKit.addListener('updateStaged', ({ bundle }) => showRestartPrompt(bundle));
```

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

## Runtime channel switching

`setChannel()` overrides the configured channel at runtime — for example a
"Join beta" toggle in settings — without rebuilding the app:

```ts
// Opt into the beta channel; takes effect on the next check/download cycle.
await OtaKit.setChannel({ channel: 'beta' });

// Back to the channel from capacitor.config.ts (or the base channel).
await OtaKit.setChannel({ channel: null });

const { channel, source } = await OtaKit.getChannel();
// source is 'override' after setChannel(), 'config' otherwise
```

The override is persisted across launches and slots into channel resolution
as: explicit call argument → persisted override → config `channel` → base.
`setChannel()` itself never checks, downloads, or reloads anything — call
`OtaKit.download()` / `OtaKit.update()` afterwards if you want the switch to
take effect immediately.

Channel names must match `^[A-Za-z0-9._-]{1,64}$`, must not contain `..`, and
must not be the reserved names `base` or `default` (matching server-side
validation). Invalid names reject without persisting.

Limitations to be aware of:

- **Channels are public CDN paths.** A channel name is not a secret and this
  cannot enforce private distribution — anyone who guesses the name can fetch
  that channel's manifest.
- **The backend is not aware of the switch.** There is no server-side record
  of which device is on which channel; the switch is purely client-side.
- **The channel must exist and have a release.** Switching to a channel with
  no published manifest yields `no_update` until something is released there.

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
5. it verifies the downloaded object against the manifest `sha256`
6. if the bundle is encrypted, it decrypts it (AES-256-GCM; the tag authenticates the plaintext)
7. it stages and later applies the bundle

## Bundle encryption (optional)

Bundles can be end-to-end encrypted so that object storage and the CDN only
ever hold ciphertext. Generate a key with `otakit generate-encryption-key`,
put it in CI as `OTAKIT_ENCRYPTION_KEY` (the CLI then encrypts uploads), and
ship the same key in the app:

```ts
plugins: {
  OtaKit: {
    // Inject from an env var at build time — never commit the key.
    bundleKeys: [{ kid: process.env.OTAKIT_ENCRYPTION_KID!, key: process.env.OTAKIT_ENCRYPTION_KEY! }],
  },
},
```

Per upload the CLI generates a random data key (DEK), encrypts the zip with
AES-256-GCM, and wraps the DEK under your app key; the wrapped DEK and nonces
travel in the signed manifest. The server never sees the key and cannot
decrypt your bundles.

**Threat model — confidentiality, not DRM.** The decryption key ships inside
the app binary, so a determined attacker who reverse-engineers the app can
extract it — true of every client-side encryption scheme. What it protects
against: leaked or guessed CDN URLs, bucket misconfiguration, and casual
inspection of stored objects. Update _forgery_ is independently blocked by
the ES256 manifest signature — which is also why encryption should only be
used with manifest signing enabled (hosted default): the encryption
parameters are covered by the signature.

Operational rules:

- **Rollout order:** ship a store build containing `bundleKeys` **before**
  releasing encrypted bundles. Installed apps without the key cannot decrypt
  and will stay on their current version (they keep running; the failure is
  recorded as `download_error` telemetry and, if you listen for it, the
  `downloadFailed` event — it does not appear in `getLastFailure()`, which
  reports rollbacks only).
- **Rotation:** `bundleKeys` is an array — ship old + new keys together
  during a transition, then drop the old key in a later store build.
- **Key custody:** back the key up. Losing it means installed apps cannot
  receive updates until a store build ships a new key.
- Decryption failures are never fatal: they behave like download failures —
  the running bundle is untouched and nothing unverified is ever applied.
- **Memory:** decryption buffers the bundle in memory (roughly 2–3× the
  bundle size at peak). Keep encrypted bundles comfortably under ~100 MB,
  especially for low-end Android devices.

## Source areas

- `src/definitions.ts`: public types and config
- `src/index.ts`: Capacitor registration and JS wrapper
- `src/web.ts`: web fallback implementation
- `ios/Sources/UpdaterPlugin/*`: iOS implementation
- `android/src/main/java/com/otakit/updater/*`: Android implementation
