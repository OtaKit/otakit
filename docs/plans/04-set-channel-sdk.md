# Implementation Plan: `setChannel()` SDK Method

Status: ready to implement (small; good quick win)
Owner: —
Related: [CAPGO_IMPROVEMENT_PLAN.md](../../CAPGO_IMPROVEMENT_PLAN.md)

## 1. Goal

Let an app switch its release channel **at runtime** — e.g. a "Join beta" toggle
in settings — without rebuilding/reinstalling. Today the channel is fixed in
`plugins.OtaKit.channel` (static config), so moving a device between channels
means a new store build.

**Key property: zero backend work.** In OtaKit, channels are already just
different static manifest paths on the CDN
(`manifests/<appId>/<channel>/<runtime>/manifest.json`). Switching channel only
changes *which already-published manifest the device fetches*. It stays entirely
on the static-CDN fast path — no dynamic endpoint, no per-device cost. This is the
cheap 80% of Capgo's `channel_self` (the beta opt-in) without their dynamic
infrastructure.

## 2. How Capgo does it (for reference)

Capgo's `setChannel` calls the backend `channel_self` endpoint
(`plugins/channel_self.ts`) which records a device→channel override in
`channel_devices`, gated by the channel's `allow_device_self_set` flag; the update
endpoint then resolves that override per request. That requires the dynamic
endpoint and server state. **We deliberately do not copy that** — our static model
makes the same UX a pure client concern. (Server-enforced private channels /
per-device QA pinning remain the deferred "per-device targeting" work.)

## 3. OtaKit today (verified from source)

- **JS API** (`packages/capacitor-plugin/src`): `OtaKitPlugin` /
  `OtaKitBridgePlugin` in `definitions.ts`, wrapped in `index.ts`, web stub in
  `web.ts`. Current methods: `getState, check, download, apply, update,
  notifyAppReady, getLastFailure`.
- **iOS** (`UpdaterPlugin.swift`): `channel` read once in `load()` from config
  (`getConfig().getString("channel")`, line 76). `resolveTargetChannel(_ channel)`
  = `explicit arg ?? self.channel` (line 1020; Android mirror at
  `UpdaterPlugin.java:1093`). The manifest URL is built with
  `URL.appendingPathComponent` (`ManifestClient.swift:65-70`), which confirms
  the traversal concern in §4.1. `fetchLatest(channel:)` →
  `ManifestClient.fetchLatest` builds the CDN path from the channel. The
  coordinator's classification already compares `bundle.channel == targetChannel`,
  so a channel switch naturally yields `update_available` for the new channel.
  `pluginMethods` is an explicit `[CAPPluginMethod]` list.
- **Android** (`UpdaterPlugin.java`): mirror; `@PluginMethod` annotations.
- **Persistence**: `BundleStore` already stores small keys in
  `UserDefaults`/`SharedPreferences` (current/fallback/staged ids,
  `lastResolvedRuntimeKey`). The override channel belongs right here.

## 4. Design

### 4.1 Behavior

- `setChannel(channel: string | null)`:
  - Persist an **override channel** locally (null clears it → fall back to config
    channel).
  - **Validate the name natively before persisting or using it (security).** The
    channel is interpolated into the manifest CDN path
    (`manifests/<appId>/<channel>/<runtime>/manifest.json`), and
    `URL.appendingPathComponent` does **not** reliably neutralize `..`. An
    unvalidated `setChannel("../../otherapp")` could traverse to another app's /
    lane's manifest. Reject anything containing `/`, `\`, `..`, control chars,
    leading/trailing whitespace, or characters outside the allowed channel charset
    (mirror the server's `isValidChannelName` — verified in
    `console/lib/validation.ts`: `^[A-Za-z0-9._-]{1,64}$` **plus reserved names
    `base` and `default`**, case-insensitive; mirror the reserved list too so a
    client can't target the `__base__`/`__default__` path keys by name).
    Reject synchronously with a clear error; do not persist on rejection.
  - Does **not** force anything by itself — takes effect on the next check/
    download/automatic cycle. (Optional convenience: a `{ apply?: boolean }` or a
    follow-up `await OtaKit.download()` call; keep the method itself minimal and
    let the caller decide.)
- `getChannel(): { channel: string | null; source: 'override' | 'config' }` —
  returns the effective channel and where it came from.

### 4.2 Resolution order

`resolveTargetChannel(explicitArg)`:
```
explicit arg (if any)  →  persisted override  →  config channel  →  base
```
Only one line changes vs today: insert the persisted override between the explicit
arg and `self.channel`.

### 4.3 Why existing logic "just works" after a switch

- `fetchLatest` builds the CDN path from `targetChannel` → fetches the new
  channel's static manifest.
- `UpdaterCoordinator.classifyLatestManifest` compares the new manifest against the
  current bundle; since `bundle.channel != targetChannel`, it returns
  `update_available` → normal download/stage/apply/rollback loop, unchanged.
- Clearing the override (`setChannel(null)`) returns to the config channel and the
  next check pulls that channel's current bundle the same way.

Signature verification also just works: the signed canonical payload includes
`channel`, and `ManifestClient` passes the *requested* channel into
`ManifestVerifier.verify` (`ManifestClient.swift:129-138`) — with an override
that's the override name, which is exactly what the server signed for that
channel's manifest.

No changes to the download/apply/rollback/runtime-lane machinery.

## 5. File-by-file change list

Plugin TS (`packages/capacitor-plugin/src`):
- `definitions.ts` — add to `OtaKitPlugin` + `OtaKitBridgePlugin`:
  ```ts
  setChannel(options: { channel: string | null }): Promise<void>;
  getChannel(): Promise<{ channel: string | null; source: 'override' | 'config' }>;
  ```
- `index.ts` — pass-throughs.
- `web.ts` — stub implementations (no-op persistence or `localStorage`).

iOS (`packages/capacitor-plugin/ios/Sources/UpdaterPlugin`):
- `BundleStore.swift` — add `getOverrideChannel()/setOverrideChannel(_:)` (new
  `UserDefaults` key `otakit_override_channel`).
- `UpdaterPlugin.swift` — add `setChannel`/`getChannel` to `pluginMethods` + impl;
  update `resolveTargetChannel` to consult the override; validate channel name.
- (No `ManifestClient`/coordinator changes.)

Android (`packages/capacitor-plugin/android/.../updater`):
- `BundleStore.java` — override channel in `SharedPreferences`.
- `UpdaterPlugin.java` — `@PluginMethod setChannel/getChannel`; resolution +
  validation mirror.

Docs:
- `packages/capacitor-plugin/README.md` — document the methods and the limitation
  (below). Mention the beta-opt-in pattern.

## 6. Limitations to document (important, honest)

- **Public/guessable channels.** Channel names are public CDN paths, so this can't
  enforce *private* channels or hide a beta from someone who guesses the URL.
  Truly private/targeted distribution needs the deferred dynamic per-device
  endpoint ("per-device targeting" in the improvement plan).
- **No server awareness.** The backend doesn't know which device is on which
  channel (so no server-side QA pin / audit of device→channel). That's by design
  to stay on the static path.
- **Channel must exist / be released.** Switching to a channel with no published
  manifest yields `no_update` (404 → nil), which is correct; surface a clear state
  via `getState`/logs.

## 7. Testing

- TS: types compile; web stub works.
- iOS/Android unit: override persists across launches; `resolveTargetChannel`
  precedence (arg > override > config); clearing returns to config.
- **Security unit test**: `setChannel("../../x")`, `"a/b"`, `"a\\b"`, control
  chars, and over-length names are all rejected and never persisted.
- E2E (`examples/demo-app`): publish base + `beta` channels with different
  bundles; `setChannel("beta")` → next check downloads the beta bundle; apply +
  `notifyAppReady` confirm; `setChannel(null)` → returns to base on next check.

## 8. Rollout

Additive and backward compatible (apps that never call `setChannel` behave exactly
as today). Safe to ship any time; good to interleave with the heavier delta/
encryption native work since it touches the same native files lightly.

## 9. Open questions

- Should `setChannel` optionally trigger an immediate check (`{ check?: true }`)?
  Lean no for v1 — keep it a pure setter; callers can `await OtaKit.download()`.
- Should a channel switch eagerly drop staged bundles from the old channel?
  Existing classification already ignores mismatched-channel staged bundles; no
  action needed, but verify cleanup happens on the next cycle.
