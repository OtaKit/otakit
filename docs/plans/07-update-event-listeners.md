# Implementation Plan: Update Event Listeners

Status: ready to implement (medium; native + TS, additive)
Owner: —
Related: [05-immediate-update-splash.md](./05-immediate-update-splash.md), [04-set-channel-sdk.md](./04-set-channel-sdk.md), docs `/docs/update-strategies`

## 1. Goal

Let an app **subscribe to update lifecycle events** instead of polling. Today the
only way to react to an update is to call `check()` / `download()` / `getState()`
yourself on a timer or a `@capacitor/app` resume hook. With listeners the plugin
tells the app when something happens:

```ts
OtaKit.addListener('updateStaged', ({ bundle }) => {
  // show "Update ready — restart now?" and call OtaKit.apply() on accept
});
```

**The important reframing:** this is *not* just a manual-mode nicety. The plugin
already downloads + stages in the background on its own in `shadow` mode (see
`handleResume`/`handleLaunch` → `downloadLatest`, throttled by `checkInterval`,
deduped by `coordinator.tryBeginOperation()`). It just has no way to *tell JS* a
bundle got staged. So the best implementation of "auto-download in the background,
then prompt the user to apply" becomes:

```ts
// shadow does the background download/throttle/dedup for you:
OtaKit: { launchPolicy: "shadow", resumePolicy: "shadow" }
```
```ts
OtaKit.addListener('updateStaged', showRestartPrompt);
```

That is strictly less app code than the manual polling pattern, and reuses the
plugin's existing throttling and in-flight dedup. Listeners make **every** policy
mode (shadow, apply-staged, immediate, off) observable — not just manual mode.

## 2. OtaKit today (verified from source)

### 2.1 The four existing telemetry anchor points

Both `UpdaterPlugin.swift` and `UpdaterPlugin.java` already call `sendDeviceEvent`
at exactly the moments we want to surface to JS. **Every listener event except
`updateAvailable` co-locates with an existing `sendDeviceEvent` call** — so the
implementation is "wherever telemetry fires, also `notifyListeners`":

| Telemetry action | Fires in | Meaning |
|---|---|---|
| `downloaded` | `downloadAndStage`, right after `coordinator.stageDownloadedBundle(info)` (iOS `UpdaterPlugin.swift:661`, Android `:728`) | bundle downloaded, verified (SHA-256), and staged |
| `download_error` | `downloadAndStage` catch block + disk-space guard (iOS `:594`/`:670`, Android `:675`/`:731`) | download/verify/extract failed; app keeps running current bundle |
| `applied` | `notifyAppReady` → `coordinator.prepareNotifyAppReady()` (trial → success transition) | a newly activated bundle confirmed healthy |
| `rollback` | payload built in `rollbackLocked`, but **sent from two different callers**: `rollbackCurrentBundle` (notify-timeout) and `load()` via `normalizeStartupState` (startup `app_restarted_before_notify` — iOS `UpdaterPlugin.swift:121-123`, Android `:254`) | an applied bundle failed its health check and was reverted |

`updateAvailable` has no telemetry today but is produced by
`checkLatest` → `classifyLatestManifest` returning `.updateAvailable`, before any
download. That is the natural place to emit it.

### 2.2 The JS wrapper caveat (important)

`packages/capacitor-plugin/src/index.ts` exposes `OtaKit` as a **plain object**,
not the object returned by `registerPlugin`. `registerPlugin` returns the proxy
that carries Capacitor's `addListener`/`removeAllListeners`; our wrapper does not
forward them today. So adding listeners is **not** automatic — we must explicitly
forward `addListener`/`removeAllListeners` from the wrapper to `NativeOtaKit`, and
type them.

### 2.3 Native base classes already support events

- iOS `UpdaterPlugin: CAPPlugin` → has `notifyListeners(_:data:)`.
- Android `UpdaterPlugin extends Plugin` → has `notifyListeners(String, JSObject)`.

No base-class changes; `notifyListeners` is safe to call off the main thread (both
frameworks marshal internally), which matches where our download/apply code runs
(iOS `Task`, Android single-thread `executor`).

### 2.4 The llms.txt generator already anticipates an `EventRow`

`scripts/generate-llms-txt.mjs` (line 330) already has an `EventRow` handler
(`event` / `payload` / `description` attributes). The new docs page should use an
`EventRow` component so the plaintext docs render cleanly with no generator change.

## 3. Design

### 3.1 Event set (v1)

Six events. Names are camelCase (Capacitor convention) and align with the existing
state vocabulary (`staged`, `applied`, `rollback`) to minimize new concepts.

| Event | Payload | When it fires | Primary use case |
|---|---|---|---|
| `updateAvailable` | `LatestVersion` | a check finds a newer bundle, **before** download (any policy, or manual `check()`) | prompt "Download now?" before spending bandwidth |
| `updateStaged` | `{ bundle: BundleInfo }` | bundle downloaded + verified + staged, ready to apply | **prompt "Restart to update?"** and call `apply()` |
| `updateApplied` | `{ bundle: BundleInfo }` | a newly activated bundle confirmed healthy (`notifyAppReady` on a trial bundle) | "You're now on vX" toast / analytics |
| `downloadFailed` | `{ version, runtimeVersion?, releaseId?, reason }` | download/verify/extract/disk error; **non-terminal**, app keeps running | error reporting / diagnostics |
| `rollback` | `{ version, runtimeVersion?, releaseId?, reason }` | an applied bundle failed its health check and was reverted (notify-timeout path; startup rollbacks can't reach a listener — reconcile with `getLastFailure()`, §3.3/§3.5) | alerting on bad releases |
| `downloadProgress` *(optional, Phase 2)* | `{ version, releaseId?, receivedBytes, totalBytes }` | periodically during download | progress bar |

**Deliberately NOT emitted:**
- **`noUpdate`** — would fire on every check (cold start, every resume). Too noisy;
  callers who care can use `check()`'s return value.
- **A separate `updateDownloaded` distinct from `updateStaged`** — in OtaKit,
  download and stage are **atomic** (`downloadAndStage` verifies then stages in one
  operation; telemetry `downloaded` fires exactly when staging completed). There is
  no "downloaded but not staged" state, so one event (`updateStaged`) is honest and
  correct. This must be stated plainly in the docs to avoid a false expectation of
  two events.

### 3.2 Payload types (`definitions.ts`)

Reuse existing shapes (`LatestVersion`, `BundleInfo`) where possible:

```ts
export interface UpdateStagedEvent { bundle: BundleInfo; }
export interface UpdateAppliedEvent { bundle: BundleInfo; }
export interface UpdateFailedEvent {
  version: string;
  runtimeVersion?: string;
  releaseId?: string;
  channel?: string;
  reason: string; // e.g. "hash_mismatch", "insufficient_disk_space", "notify_timeout"
}
export interface DownloadProgressEvent { // Phase 2
  version: string;
  releaseId?: string;
  receivedBytes: number;
  totalBytes: number; // 0 if unknown (chunked)
}

// updateAvailable payload is the existing LatestVersion.
```

`addListener` overloads on `OtaKitPlugin` (and `OtaKitBridgePlugin`):

```ts
addListener(event: 'updateAvailable', cb: (data: LatestVersion) => void): Promise<PluginListenerHandle>;
addListener(event: 'updateStaged',    cb: (data: UpdateStagedEvent) => void): Promise<PluginListenerHandle>;
addListener(event: 'updateApplied',   cb: (data: UpdateAppliedEvent) => void): Promise<PluginListenerHandle>;
addListener(event: 'downloadFailed',  cb: (data: UpdateFailedEvent) => void): Promise<PluginListenerHandle>;
addListener(event: 'rollback',        cb: (data: UpdateFailedEvent) => void): Promise<PluginListenerHandle>;
// Phase 2:
addListener(event: 'downloadProgress', cb: (data: DownloadProgressEvent) => void): Promise<PluginListenerHandle>;
removeAllListeners(): Promise<void>;
```

### 3.3 Emission points (exact locations)

Add a small `emitEvent(name, payload)` helper on each native plugin that wraps
`notifyListeners`, then insert calls next to the existing telemetry:

- **`updateStaged`** — iOS `downloadAndStage`, immediately after
  `sendDeviceEvent(.downloaded…)`; Android same spot after
  `sendDeviceEvent("downloaded"…)`. Payload = the just-staged `BundleInfo`.
- **`downloadFailed`** — both catch/guard sites next to
  `sendDeviceEvent(.downloadError…)`. Map the native error to a stable `reason`
  string.
- **`updateApplied`** — `notifyAppReady`, when
  `prepareNotifyAppReady()` returns a non-nil `applied` payload (i.e. a real
  trial→success transition, not a repeat call). Payload = current `BundleInfo`.
- **`rollback`** — `rollbackCurrentBundle` when `preparation.didRollback`. This
  covers the **notify-timeout path only**. The startup
  `app_restarted_before_notify` rollback does **not** flow through
  `rollbackCurrentBundle`/`prepareRollback` — it happens inside
  `normalizeStartupState` during `load()` (verified: iOS
  `UpdaterCoordinator.swift:150`, event sent at `UpdaterPlugin.swift:121-123`),
  **before any JS listener can exist**, so emitting there would always be lost.
  Deliberately do not emit it; startup rollbacks are surfaced by the existing
  `getLastFailure()` API — the docs' reconciliation pattern (§3.5) must mention
  this explicitly. Payload from the rollback event payload.
- **`updateAvailable`** — `checkLatest`, when the resolution is `.updateAvailable`.
  Emit once per check. Note this means in automatic/immediate flows it fires right
  before the download begins — desired (lets a listener veto or just observe).

Because these sit exactly where `sendDeviceEvent` already sits, the change is
mechanical and low-risk: no new control flow, no new locks (the coordinator's
`operationInProgress` still serializes the surrounding operation).

### 3.4 JS wrapper plumbing (`index.ts`)

```ts
const OtaKit: OtaKitPlugin = {
  …existing…,
  addListener: (event, cb) => NativeOtaKit.addListener(event as any, cb as any),
  removeAllListeners: () => NativeOtaKit.removeAllListeners(),
};
```

`NativeOtaKit` is the `registerPlugin` proxy, which already implements both. Web
stub (`web.ts`) extends `WebPlugin`, which already provides `addListener` /
`removeAllListeners` — events simply never fire on web (correct: no OTA on web).

### 3.5 The missed-event / cold-start race (must document, not over-engineer)

Events can fire before JS attaches a listener:
- A bundle staged in a **previous** session is already sitting there on next launch.
- In `immediate`/`apply-staged` cold start, an apply + reload can happen during
  `load()` before app JS runs.
- `updateApplied` fires **in the reloaded (new) JS context**, so a listener must be
  attached early in startup to catch it.

**v1 guidance (documented, no native buffering):** treat listeners as "live
notifications" and `getState()` as the "source of truth on startup." The canonical
pattern:

```ts
// On app start: catch anything staged while we weren't listening…
const state = await OtaKit.getState();
if (state.staged) showRestartPrompt(state.staged);
// …and anything that rolled back before JS booted (startup rollback).
const failure = await OtaKit.getLastFailure();
if (failure) reportFailure(failure);
// …then stay live for anything that happens later this session.
OtaKit.addListener('updateStaged', ({ bundle }) => showRestartPrompt(bundle));
```

We deliberately do **not** build a native event buffer/replay queue for v1 — the
`getState()` reconciliation covers the only case that matters (a staged bundle
waiting to apply) with zero native complexity. Call this out as an explicit
non-goal in the plan and docs.

### 3.6 Terminal-apply timeline (must document)

`apply()` / immediate flow reloads the WebView and **destroys the old JS context**.
So the realistic flow is:

```
updateStaged (old context)
  → user taps "Restart"
  → OtaKit.apply()            [old JS context ends here; reload]
  → new bundle boots
  → app calls notifyAppReady()
  → updateApplied (NEW context)   ← attach this listener early in startup
```

A listener registered in the old context will not see `updateApplied`. Docs must
show attaching `updateApplied`/`rollback` listeners at app startup, not inside the
"restart" click handler.

### 3.7 Phase 2 — `downloadProgress` (optional, separable)

Byte-level reporting is **already half-built** (verified):
- iOS `Downloader` already implements `URLSessionDownloadDelegate.didWriteData`
  and calls a `progressHandler(percent, totalBytesWritten,
  totalBytesExpectedToWrite)` (`Downloader.swift:94-106`) — the handler
  parameter just defaults to a no-op at the single call site in
  `downloadAndStage`. Phase 2 on iOS = pass a closure that emits the event.
- Android `downloadZip` streams with `input.read(buffer)` but does not read
  `Content-Length` — add progress reporting against
  `connection.getContentLength()` (0/unknown if chunked).
Throttle emissions (e.g. ≤ every 100 ms or 1%) to avoid bridge spam. Orthogonal to
the rest; ship v1 without it and add later. Not needed for the download/apply
prompt flows that motivated this work.

## 4. File-by-file change list

Plugin TS (`packages/capacitor-plugin/src`):
- `definitions.ts` — event payload interfaces; `addListener` overloads +
  `removeAllListeners` on `OtaKitPlugin` and `OtaKitBridgePlugin`; import
  `PluginListenerHandle` from `@capacitor/core`.
- `index.ts` — forward `addListener` / `removeAllListeners` to `NativeOtaKit`.
- `web.ts` — no functional change (inherits from `WebPlugin`); optionally document
  that events never fire on web.

iOS (`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`):
- Add `emitEvent(_ name: String, _ data: [String: Any])` → `notifyListeners`.
- Insert emit calls at the five v1 points (§3.3). Add a `reason` mapping helper for
  failures.
- (No `pluginMethods` change — `addListener`/`removeAllListeners` are handled by
  `CAPPlugin`, not our explicit method list.)

Android (`packages/capacitor-plugin/android/.../UpdaterPlugin.java`):
- Add `emitEvent(String name, JSObject data)` → `notifyListeners`.
- Mirror the five insertions; mirror the `reason` mapping.

Docs:
- **New page** `packages/site/app/docs/events/page.tsx` (§5).
- `packages/site/app/docs/DocsSidebar.tsx` — add "Events & Listeners" under Guides.
- `packages/site/app/docs/page.tsx` — add a `NavCard`.
- `packages/site/app/docs/plugin/page.tsx` — replace the current line "There is no
  listener API in the current plugin surface" with a short "Events" subsection that
  links to the new page. (Grep confirms that sentence exists today.)
- `scripts/generate-llms-txt.mjs` — add the new page to the `DOCS` array (the
  `EventRow` renderer already exists).
- `packages/capacitor-plugin/README.md` — document events + the `getState()`
  reconciliation caveat.

## 5. New docs page: "Events & Listeners"

Route `/docs/events`. Structure (mirrors `channels`/`update-strategies` house
style: `H2`/`H3`/`P`/`Code`/`Pre`, plus an `EventRow` table component matching the
llms generator's expected `event`/`payload`/`description` props):

1. **Intro** — the plugin emits lifecycle events via `OtaKit.addListener(...)`;
   they complement (don't replace) the pull APIs `check()`/`getState()`. Events
   fire only while the app process is alive.
2. **Event reference** — `EventRow` per event (name, payload, when).
3. **Caveats** (the honest section):
   - Events fire only while the app is running (nothing while killed/backgrounded).
   - Reconcile with `getState()` on startup for anything staged while not listening.
   - `apply()` reloads and destroys the old JS context; attach
     `updateApplied`/`rollback` at startup (timeline diagram from §3.6).
   - Download and stage are atomic — one `updateStaged`, no separate "downloaded".
4. **Use cases** (each with a code block):
   - **Auto-download, prompt to apply** (the headline flow):
     `{ launchPolicy: "shadow", resumePolicy: "shadow" }` + `updateStaged` listener
     → your restart prompt → `apply()`.
   - **Prompt before downloading**: `updateAvailable` → confirm → `download()` →
     `updateStaged` → confirm → `apply()`. Pair with `launchPolicy/resumePolicy:
     "off"` (manual) if you want to gate the download itself.
   - **Post-update toast / analytics**: `updateApplied` at startup.
   - **Report failures**: `downloadFailed` + `rollback` → your error reporter;
     mention `getLastFailure()` for cold-start diagnostics.
5. **Cleanup** — keep the `PluginListenerHandle` and call `.remove()`, or
   `OtaKit.removeAllListeners()` (e.g. framework unmount).
6. **See also** — links to Update Strategies and Plugin API.

## 6. Security / correctness notes

- **No new attack surface**: events are outbound notifications of state the app
  already owns; no new input is parsed. Payloads carry only fields already present
  in `BundleInfo`/`LatestVersion`/telemetry.
- **Serialization unchanged**: the download-path emissions happen inside the
  existing `operationInProgress`-guarded operations. `updateApplied` fires from
  `notifyAppReady`, which is *not* operation-locked (same as today's telemetry) —
  but `prepareNotifyAppReady` is `stateLock`-guarded and returns a payload only
  on a genuine transition, so single-emission still holds. No new locks, no
  reentrancy.
- **Threading**: `notifyListeners` is called off-main (iOS `Task`, Android
  `executor`) — both frameworks marshal to JS safely; do not add manual dispatch.
- **`updateApplied` fires only on a genuine trial→success transition** (guarded by
  `prepareNotifyAppReady` returning a payload), so repeat `notifyAppReady()` calls
  don't double-emit.

## 7. Testing

- **TS**: types compile; overloaded `addListener` narrows payloads; web stub
  `addListener`/`removeAllListeners` resolve and never emit.
- **iOS/Android unit**: each of the five emission points fires exactly once with
  the right payload for a representative flow (stage, fail-download, notify-ready,
  timeout-rollback, check-finds-update). Assert no `updateApplied` on a repeat
  `notifyAppReady`.
- **Race/reconciliation**: bundle staged in session A → session B `getState()`
  reports `staged` (documented pattern), and a fresh `updateStaged` in session B
  still emits.
- **Terminal apply**: `updateApplied` observed by a listener attached at startup of
  the reloaded bundle; confirm old-context listener does not receive it.
- **E2E (`examples/demo-app`)**: shadow mode + `updateStaged` listener shows a
  prompt; accept → `apply()` → reload → `updateApplied` toast + `notifyAppReady`.

## 8. Backward compatibility / rollout

Fully additive. Apps that never call `addListener` are unaffected; telemetry is
untouched (events are emitted *alongside* existing `sendDeviceEvent`, not instead).
Safe to ship independently. `downloadProgress` can land later without touching the
v1 event contract.

## 9. Open questions

- **Buffer/replay for missed events?** v1 says no (rely on `getState()`). Revisit
  only if the reconciliation pattern proves error-prone in practice.
- **`updateAvailable` in automatic flows** fires right before an automatic download
  begins — observe-only, or also offer a way to veto the auto-download? Lean
  observe-only for v1 (vetoing = use manual mode). Document the timing so it isn't
  surprising.
- **Single `updateFailed` vs split `downloadFailed`/`rollback`?** Plan splits them
  because they mean different things (non-terminal download error vs a reverted bad
  release) and drive different UX. Keep split unless it proves noisy.
- **`downloadProgress` granularity/throttle** — finalize the emit cadence during
  Phase 2 against real bundle sizes.
```
