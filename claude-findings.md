# Implementation Review Findings

Review of the refactored OtaKit Capacitor plugin against refactor-plan.md v5.

---

## Plan Conformance

All 12 event x policy combinations are implemented correctly on both platforms.
The cold-start dispatcher, runtime/launch/resume handlers, and policy semantics
match the plan's flow appendix.

| Area | Status |
|------|--------|
| Config shape (3 policies, checkInterval, appReadyTimeout) | Matches plan |
| Event model (runtime, launch, resume dispatchers) | Matches plan |
| Shared engine primitives (checkLatest, downloadLatest, applyStaged, resolveCurrentRuntimeKey) | Matches plan |
| Error propagation contract (throws propagate, never collapse to no_update) | Matches plan |
| Runtime key resolution timing (resolve before apply, resolve after success, skip on error) | Matches plan |
| checkInterval scope (respectInterval only for resume shadow/apply-staged fallback) | Matches plan |
| Failed bundle suppression (lastFailedBundle matched by releaseId/sha256/runtimeVersion/channel) | Matches plan |
| Rollback model (trial timeout, restart-before-ready, fallback restoration) | Matches plan |
| Android cold-start resume dedupe (coldStartInProgress boolean) | Matches plan |
| Concurrency (reject, not queue) | Matches plan |
| Manual API mapping (getState, check, download, apply, update, notifyAppReady, getLastFailure) | Matches plan |
| Listener/event API removal | Matches plan |
| Overlay/state-machine/updateMode/immediateUpdateOnRuntimeChange deletion | Matches plan |
| update() atomic as native method | Matches plan |

---

## Real Issues

### 1. Android: `getState` has no synchronization and does a write

`UpdaterPlugin.java:409` — when the staged bundle's data can't be found,
`getState` clears the staged ID:

```java
if (staged == null) {
    store.setStagedBundleId(null);
}
```

This is a write from within a nominally read-only method, running on the main
thread. The executor could be concurrently setting a new staged ID after
completing a download. If the executor finishes staging between
`getStagedBundleId()` and `getBundle()`, `getState` would read the old
(superseded) staged ID, fail to find it, and clear the newly-set staged ID.

Very unlikely timing, but architecturally wrong. On iOS, `getState` is
protected by `withStateLock`.

### 2. Android: `rollbackCurrentBundle` runs on main thread without synchronization against executor

`UpdaterPlugin.java:902` — the trial timeout callback fires on the main thread
via `mainHandler.postDelayed`. It modifies store state (markStatus,
setLastFailedBundle, setStagedBundleId, setCurrentBundleId, deleteBundle)
without any lock.

The executor could be reading store state concurrently (e.g.,
`classifyLatestManifest` reading current/staged). Individual SharedPreferences
reads are atomic, but multi-read consistency is not guaranteed.

Safe in practice because the timeout fires 10+ seconds after apply, by which
time the executor has finished. But the lack of formal exclusion is a gap
compared to iOS's `withStateLock` in the same method.

### 3. iOS: `sendDeviceEvent` called inside `withStateLock`

In `notifyAppReady` (`UpdaterPlugin.swift:452`) and `rollbackCurrentBundle`
(`UpdaterPlugin.swift:887`), `sendDeviceEvent` fires inside the state lock.
This enqueues an async network request. The enqueue is fast, but holding a state
lock while doing I/O dispatch is unnecessary.

Fix: collect the event parameters inside the lock, fire `sendDeviceEvent`
outside.

### 4. iOS: `scheduleTrialTimeout` in `load()` is outside `stateLock`

`UpdaterPlugin.swift:126`:

```swift
if current.status == .pending {
    store.markStatus(bundleId: current.id, status: .trial)
    scheduleTrialTimeout(for: current.id)
}
```

Every other call to `scheduleTrialTimeout` happens inside `withStateLock`. This
one does not. Safe by construction (runs during single-threaded init before any
async operations start), but inconsistent with the pattern everywhere else.

---

## Cleanup Candidates (no behavioral impact)

### 5. Android dead code: 3-arg `downloadAndStage` overload

`UpdaterPlugin.java:674`:

```java
private BundleInfo downloadAndStage(URL url, String version, String expectedSha256)
```

Not called anywhere. Delete it.

### 6. Async `applyServerBasePath` variant used only once

Both platforms have an async fire-and-forget `applyServerBasePath` used only in
`load()` for the initial base path. Since `load()` runs on main, the
synchronous variant handles it correctly. Delete the async variant and use
`applyServerBasePathSynchronously` everywhere.

iOS: `UpdaterPlugin.swift:946` (async) used at line 119.
Android: `UpdaterPlugin.java:971` (async) used at line 198.

### 7. Android: route `notifyAppReady` through executor instead of `synchronized(store)`

`synchronized(store)` in `notifyAppReady` (`UpdaterPlugin.java:494`) only
appears to protect against concurrent access. It does not actually exclude the
executor because the executor never synchronizes on `store`.

Routing `notifyAppReady` work through the executor would give real serialization
for free, matching how all other state mutations work. The call would still be
async from JS's perspective (Capacitor plugin methods already return promises).

---

## Simplification Opportunities

### 8. Android locking could match iOS's pattern

Right now Android relies on three different mechanisms for different methods:

- `AtomicBoolean` + single-thread executor for update operations
- `synchronized(store)` for `notifyAppReady` only
- Main-thread-only assumption for timeout callbacks and `getState`

A single `ReentrantLock` (like iOS's `stateLock`) used in `applyStaged`,
`rollbackCurrentBundle`, `notifyAppReady`, `getState`, and the timeout callback
would be cleaner and give real consistency guarantees at the executor-to-main
boundary.

### 9. `doesBundleMatchLatest` and `doesFailedBundleMatchLatest` share ~80% logic

Both compare channel, runtimeVersion, releaseId, sha256 in the same order. The
only difference: `doesBundleMatchLatest` has a version-only fallback for bundles
without identity fields; `doesFailedBundleMatchLatest` never falls through to
version (correct — don't suppress a release just because it shares a version
string).

A shared `matchByIdentity(bundle, latest, channel, allowVersionFallback)` would
eliminate the duplication. Both platforms duplicate this pair.

---

## Observations (not issues, just notes)

### `doesBundleMatchLatest` version-only fallback guard

The new guard at `UpdaterPlugin.swift:1113` / `UpdaterPlugin.java:1141`:

```
if either side has releaseId or sha256 but didn't match above -> return false
```

Prevents false positives from version-only matching when proper identity fields
exist. Falls through to version comparison only when neither side has identity
fields. Good improvement.

### `buildBundleId` identity-based hash suffix

Now uses `releaseId ?? sha256 ?? version` for the hash suffix instead of just
version. Different releases with the same version string get different bundle
IDs. Prevents ID collisions on re-release.

### `classifyLatestManifest` extraction

Shared by `checkLatest` and the expired-URL retry path in `downloadLatest`.
The retry re-classifies the refreshed manifest, correctly handling the case
where state changed between the original check and the retry.

### `reloadAfterApply` parameter on `applyStaged`

Not in the plan but necessary. During cold start, the WebView hasn't loaded
yet — the base path change is sufficient. During resume or async immediate,
the WebView is already showing old content and needs a reload. The parameter
controls this correctly.

### Pending-to-trial safety net in `load()`

`UpdaterPlugin.swift:124` / `UpdaterPlugin.java:203`: if the current bundle is
PENDING (not yet TRIAL), it gets promoted to TRIAL with a timeout. This catches
the edge case where the app crashed between `setCurrentBundleId` and
`markStatus(.trial)` during a previous `applyStaged` call. Giving it one trial
attempt is correct — if it's bad, the timeout will catch it.

### `isExpiredURLError` is heuristic-based

Both platforms use string matching (`contains("403")`, `contains("410")`) as
a fallback for detecting expired presigned URLs. Could false-positive on error
messages that happen to contain those substrings. The consequence of a false
positive is an extra manifest re-fetch, not data corruption.
