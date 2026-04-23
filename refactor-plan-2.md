# OtaKit Plugin Tightening Plan v3

## Purpose

The product model is already mostly right.

We should not reopen the event/policy design again.
We should finish the implementation simplification.

The remaining problem is not "too many update modes."
The remaining problem is that concurrency and state ownership are still spread
across too many places.

This plan tightens that.

The goal is:

- keep the current public behavior model
- remove scattered synchronization from plugin code
- make state ownership explicit and centralized
- keep the implementation boring, small, and predictable

---

## What Stays

These parts of the current design stay:

- three automatic events:
  - `runtime`
  - `launch`
  - `resume`
- four policies on each event:
  - `'off'`
  - `'shadow'`
  - `'apply-staged'`
  - `'immediate'`
- shared core primitives:
  - `checkLatest`
  - `downloadLatest`
  - `applyStaged`
- runtime resolution via `lastResolvedRuntimeKey`
- failed-bundle suppression via `lastFailedBundle`
- rollback model:
  - `trial`
  - timeout rollback
  - restart-before-ready rollback
- `checkInterval` only throttles resume background checks
- no overlay
- no splash-screen ownership
- no listener/event API
- manual APIs stay:
  - `getState()`
  - `check()`
  - `download()`
  - `apply()`
  - `update()`
  - `notifyAppReady()`
  - `getLastFailure()`

This is an implementation cleanup pass, not another flow-model rewrite.

---

## Main Decision

Introduce one small internal `UpdaterCoordinator` per platform.

The coordinator is the central place for:

- update-operation admission
- coherent updater-state snapshots and transitions
- timer-related state decisions

The plugin itself stays responsible for:

- event/policy dispatch
- manifest/network/download work
- hashing/unzip/file I/O outside state transitions
- bridge/WebView activation
- public Capacitor method surface

The important rule is:

- `UpdaterPlugin` should stop doing raw synchronization itself
- direct `BundleStore` access from `UpdaterPlugin` should mostly disappear
- stateful decisions should go through the coordinator

This is the real simplification.

---

## Why This Is The Simplest Viable Model

### Top-level busy checks alone are not enough

A simple "check at the top of each public method" does not solve the real
problem.

The updater can still mutate or inspect state from different places:

- cold start handling
- resume handling
- manual JS APIs
- `notifyAppReady()`
- trial-timeout rollback
- startup trial promotion

Those paths all need coherent snapshots and transitions around:

- `current`
- `fallback`
- `staged`
- `lastFailed`
- `lastResolvedRuntimeKey`

So we need more than a top-level busy flag.

### Serializing whole operations through one actor/executor is also wrong

At first glance, one actor/queue/executor for all updater work sounds clean.
In practice it is too blunt.

If a long background download holds the one global lane, then local state work
gets stuck behind it:

- `notifyAppReady()`
- timeout rollback
- `getState()`

That is not a simplification. That is a hidden bottleneck.

The better split is:

- admission for update operations
- short serialized state sections for snapshots/transitions
- long network/download/reload work outside those state sections

### Why not a full Swift actor / coroutine rewrite

We do not need a large async architecture rewrite here.

In particular on iOS:

- `load()` is synchronous
- some bridge activation decisions are synchronous
- a full actor-first design would force more async boot choreography than this
  plugin needs

So the plan is:

- introduce a small coordinator abstraction
- hide the locking/synchronization inside it
- do not spread raw mechanism across the plugin

---

## Coordinator Contract

Each platform coordinator should expose only a few concepts.

### 1. Operation admission

Used by:

- automatic `runtime` / `launch` / `resume` update flows
- `check()`
- `download()`
- `apply()`
- `update()`

Behavior:

- if another update operation is active:
  - automatic flow logs and skips
  - manual API rejects
- no queuing

### 2. Coherent state snapshot

Used by:

- `getState()`
- `getLastFailure()`
- manifest classification helpers
- failed/staged/current matching helpers

Behavior:

- pure reads only
- no cleanup side effects inside read APIs

### 3. Coherent state mutation

Used by:

- startup pending -> trial promotion
- runtime key resolution
- staging a newly downloaded bundle
- applying staged content
- rollback
- `notifyAppReady()`
- timeout rollback decision path

Behavior:

- short critical sections only
- no network requests inside
- no hashing/unzip inside
- no WebView reload inside
- no device-event dispatch inside
- mutation methods return everything the caller needs for post-mutation work:
  - activation path
  - event payload
  - cleanup targets such as superseded bundle IDs

### 4. Explicit ownership boundary

After this refactor, the rule should be:

- plugin code orchestrates
- coordinator owns updater state
- store is an implementation detail behind the coordinator boundary

That is what removes the "locks in 100 places" feeling.

---

## Target Rules

These should be true after the refactor.

### Admission and state coherence are separate

They solve different problems:

- admission answers:
  - "may a new update operation start?"
- state coherence answers:
  - "is this snapshot/transition based on one consistent updater state?"

They should be centralized together in the coordinator, but they should remain
separate concepts.

### Read APIs are pure reads

`getState()` and `getLastFailure()` must not mutate state.

If stale metadata needs cleanup, do it in:

- startup pruning
- apply/download paths
- explicit cleanup helpers

Not inside a read API.

### Startup state is normalized before the WebView runs

By the time the WebView loads, the current bundle should be one of:

- builtin
- success
- trial

It should not still be `pending`.

Startup should also validate staged pointers so read APIs do not need to
perform repair work later.

### Operational errors stay real errors

`checkLatest(...)` and `downloadLatest(...)` must not swallow transient or
operational failures into `no_update`.

The contract is:

- `no_update` means "we successfully determined there is nothing to do"
- network failure, manifest failure, download failure, hash failure, and unzip
  failure remain real errors

This is important for runtime-resolution behavior and retry-on-next-launch.

### `notifyAppReady()` is not an update operation

`notifyAppReady()` should use the coordinator's state-mutation path, but it
should not be blocked by the update-operation busy gate.

Same for timeout rollback.

They are local state transitions, not new update attempts.

### State sections stay short

The coordinator should not hold state ownership across:

- network fetches
- download
- hash verification
- unzip
- main-thread reload
- event upload

Instead:

- compute or fetch outside
- enter coordinator for the state decision/transition
- leave coordinator
- perform activation / reload / event dispatch afterward

### Terminal activation stays terminal

`apply()` and successful activating `update()` remain terminal:

- success after activation should not resolve in the old JS context
- failure should still reject
- `update()` should still resolve normally on `no_update`

---

## Core Flow Ownership

This is the intended shape of the core methods after the refactor.

### `checkLatest(...)`

- do interval throttling outside or via a tiny helper
- fetch manifest outside coordinator
- classify against current/staged/failed state via coordinator snapshot
- return:
  - `no_update`
  - `already_staged`
  - `update_available`

### `downloadLatest(...)`

- call `checkLatest(...)`
- if update is available:
  - download/hash/unzip outside coordinator
  - stage the finished bundle through one coordinator mutation
- return:
  - `no_update`
  - `staged(bundle)`

### `applyStaged(...)`

- resolve staged bundle and update `current` / `fallback` / `staged` /
  `trial` state through one coordinator mutation
- after the state transition, activate the chosen path and optionally reload
- if activation fails, fail loudly rather than silently pretending success

### `notifyAppReady()`

- confirm only the current `trial` bundle
- update fallback pointer and last healthy bundle through coordinator mutation
- delete the superseded fallback after the state decision is made
- dispatch device event outside the coordinator section

### Timeout rollback

- timer callback re-enters the coordinator
- coordinator decides whether the current bundle is still the same unresolved
  `trial`
- if yes:
  - mark failure
  - restore fallback or builtin
- activation/reload happens after the mutation section

---

## Planned Changes

## 1. Add a real internal coordinator boundary

Create a small internal `UpdaterCoordinator` on each platform.

Responsibilities:

- operation admission
- coherent updater-state reads
- coherent updater-state mutations

Non-responsibilities:

- manifest fetch
- zip download
- hash verification
- unzip
- main-thread activation/reload
- event upload

Recommended internal primitives:

- iOS:
  - coordinator state protection uses `NSLock`
  - update-operation admission stays a separate small gate owned by the
    coordinator
- Android:
  - coordinator state protection uses `ReentrantLock`
  - update-operation admission stays a separate small gate owned by the
    coordinator

This is the main architecture change in this plan.

### Why

This gives us one place to understand:

- who owns updater state
- which calls reject as busy
- which calls are pure reads
- which calls are safe local mutations

### Files

- new iOS internal coordinator file
- new Android internal coordinator file
- both platform `UpdaterPlugin` files

---

## 2. Refactor iOS around the coordinator

### Decision

Add a dedicated internal coordinator on iOS and remove plugin-level raw state
ownership.

After this change:

- `UpdaterPlugin.swift` should not own `stateLock`
- `UpdaterPlugin.swift` should not own ad hoc `checkInProgress` locking
- `BundleStore` access should happen through coordinator helpers

The coordinator can use a small native primitive internally.
That implementation detail is not the point.
The point is that the rest of the plugin stops managing it directly.

### Must move behind the coordinator

At minimum:

- runtime-key reads and writes
- startup current bundle inspection
- startup staged-pointer validation
- startup pending -> trial promotion
- staging writes in `downloadLatest`
- staged cleanup / staged replacement
- `applyStaged()` state transition
- `notifyAppReady()`
- `rollbackCurrentBundle()`
- manifest classification against current/staged/failed state
- `getState()` snapshot construction
- `getLastFailure()`

### Event dispatch rule

Do not dispatch device events from inside coordinator state sections.

Pattern:

- mutate and capture event payload inside coordinator
- send the event after leaving the coordinator

### Why

The current iOS code is partially locked and partially not.
That makes the implementation look simpler than it really is.

Moving the mechanism into one helper is the real simplification.

### Files

- new `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterCoordinator.swift`
- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`

---

## 3. Refactor Android around the coordinator

### Decision

Keep the existing executor only as the worker for automatic/manual update
operations.

Do not pretend the executor is the whole state model.

Instead:

- add a dedicated internal coordinator for state ownership
- keep update-operation rejection as a separate coordinator concern
- route timeout and `notifyAppReady()` through the same coordinator rules as
  the rest of state mutation

### Why not "just put everything on the executor"

Because the executor can be busy doing long work:

- manifest fetch
- download
- unzip

That should not delay or serialize local state confirmation like
`notifyAppReady()`.

### Must move behind the coordinator

At minimum:

- `getState()` snapshot construction
- `getLastFailure()`
- manifest classification against current/staged/failed state
- `applyStaged()` state transition
- `notifyAppReady()`
- `rollbackCurrentBundle()`
- timeout callback decision path
- startup current bundle inspection
- startup staged-pointer validation
- startup pending -> trial promotion
- runtime-key reads and writes

### `getState()` rule

`getState()` becomes a pure read.

Specifically:

- do not clear `stagedBundleId`
- do not repair metadata
- do not write anything

### Store locking note

`BundleStore` can keep its internal synchronized methods if useful, but that is
an implementation detail.

The plugin-level contract should become:

- updater state coherence comes from the coordinator
- not from scattered `synchronized(store)` usage

### Files

- new `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterCoordinator.java`
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`

---

## 4. Fix iOS export parity

### Change

Add `update` to `ios/Sources/UpdaterPlugin/UpdaterPlugin.m`.

### Why

SPM and CocoaPods must export the same native method set.

### Files

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.m`

---

## 5. Keep terminal manual activation semantics correct

### `apply()`

Target behavior:

- if no valid staged bundle exists: reject
- if activation fails: reject
- if activation succeeds and reload is triggered: do not resolve success

### `update()`

Target behavior:

- if `downloadLatest()` returns `no_update`: resolve normally
- if it stages and applies successfully: do not resolve success
- if download/apply fails: reject

### Why

This is still the smallest fix for old-JS-context misuse after activation.

### Files

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`
- `packages/capacitor-plugin/src/definitions.ts`
- `packages/capacitor-plugin/README.md`
- `packages/site/app/docs/plugin/page.tsx`
- generated `llms.txt`

---

## 6. Keep `notifyAppReady()` slightly tighter

Internally, prefer confirming only a current `trial` bundle.

`pending` should already be promoted before JS is ready.

This keeps the state model smaller:

- startup is responsible for pending -> trial
- JS is responsible for trial -> success

### Files

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`

---

## 7. Harden manifest URL construction

Manifest URL building should stop interpolating raw path segments.

Encode or explicitly validate:

- `appId`
- `channel`
- `runtimeVersion`

### Why

This is a real correctness bug, independent of the concurrency cleanup.

### Files

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/ManifestClient.swift`
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/ManifestClient.java`

---

## 8. Keep activation-path safety minimal and local

Do not build a large validation subsystem.

Do the minimum local safety checks only where activation actually happens.

Also do one minimal startup sanity check for the staged pointer so the plugin
does not advertise obviously broken staged content to JS.

### Rule

When activating a stored bundle path:

- if staged path is missing or invalid:
  - clear/discard that staged candidate
  - treat it as "no staged bundle"
- if rollback fallback path is missing:
  - fall back to builtin

At startup:

- if `stagedBundleId` points to missing metadata or a missing bundle directory:
  - clear the staged pointer

That is enough.

### Why

This keeps the plan practical:

- we avoid overbuilding
- we still do not point the WebView at obviously dead content

### Files

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`

---

## 9. Small cleanup that should happen in the same pass

These are not the main point of the refactor, but they should land with it if
they stay low-risk.

### Delete dead Android overload

Remove the unused three-argument `downloadAndStage(...)` overload.

### Delete async base-path helper if no longer needed

If synchronous activation on main is sufficient after the cleanup, remove the
fire-and-forget `applyServerBasePath(...)` variant on both platforms.

### Keep device-event dispatch outside coordinator sections

Especially for:

- `notifyAppReady()`
- rollback

### Leave identity-match dedup optional

`doesBundleMatchLatest(...)` and `doesFailedBundleMatchLatest(...)` can stay
separate unless a shared helper is clearly better.

Do not force that cleanup if it hurts readability.

---

## File-by-File Change Map

### Public TS surface

- `packages/capacitor-plugin/src/definitions.ts`
  - tighten terminal semantics wording for `apply()` and `update()`
- `packages/capacitor-plugin/src/index.ts`
  - keep aligned with native semantics
- `packages/capacitor-plugin/src/web.ts`
  - keep aligned with TS wording and native semantics

### iOS

- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterCoordinator.swift`
  - new internal coordinator
- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`
  - route state through the coordinator
  - terminal manual activation semantics
  - local activation-path safety
  - no event dispatch inside coordinator sections
- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.m`
  - export `update`
- `packages/capacitor-plugin/ios/Sources/UpdaterPlugin/ManifestClient.swift`
  - encode or validate manifest path segments

### Android

- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterCoordinator.java`
  - new internal coordinator
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java`
  - route state through the coordinator
  - pure-read `getState()`
  - timeout / `notifyAppReady()` cleanup
  - terminal manual activation semantics
  - local activation-path safety
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/ManifestClient.java`
  - encode or validate manifest path segments
- `packages/capacitor-plugin/android/src/main/java/com/otakit/updater/BundleStore.java`
  - only touch if the coordinator extraction needs small support changes

### Docs

- `packages/capacitor-plugin/README.md`
- `packages/site/app/docs/plugin/page.tsx`
- generated `llms.txt`

---

## Explicit Non-Goals

These are intentionally not part of this pass:

- no new policy model
- no return to `updateMode`
- no new event/listener API
- no overlay or splash-screen behavior
- no activation-token API yet
- no queuing of concurrent update operations
- no large actor/coroutine architecture rewrite
- no broad bundle-validation subsystem beyond activation-time sanity checks

---

## Validation Matrix

### Public surface

1. iOS SPM exposes `update`
2. iOS CocoaPods exposes `update`
3. TS surface matches both native platforms

### Coordinator architecture

4. `UpdaterPlugin` no longer owns scattered raw synchronization for updater
   state
5. direct `BundleStore` access from `UpdaterPlugin` is reduced to thin
   coordinator-backed paths
6. read APIs do not mutate state
7. timeout rollback and `notifyAppReady()` use the same state-coherence rules
   as other mutations

### Concurrency behavior

8. automatic/manual update operations still reject or skip when another update
   operation is active
9. `notifyAppReady()` is not rejected just because a background update operation
   is in flight
10. Android timeout rollback cannot race unsafely with executor-driven update
    work
11. iOS staging writes cannot race with `getState()` / `notifyAppReady()`
12. runtime-key read/write follows the same coordinator rules on both platforms

### Manual activation semantics

13. `apply()` rejects when nothing valid is staged
14. `apply()` success after activation does not resolve in the old JS context
15. `update()` resolves on `no_update`
16. `update()` success after activation does not resolve in the old JS context

### Flow behavior

17. current runtime/launch/resume policy matrix still behaves as designed
18. rollback on timeout still works
19. rollback on restart-before-ready still works
20. failed-bundle suppression still blocks only the matching release
21. `check()` / `download()` / `apply()` / `update()` still propagate real
    operational failures

### Misc correctness

22. manifest URLs remain correct with reserved characters in `channel` or
    `runtimeVersion`
23. missing staged or fallback path does not point the WebView at dead content

---

## Implementation Order

Do the work in this order:

1. add the internal coordinator on iOS and fold terminal `apply()` /
   `update()` cleanup into the same pass
2. route iOS stateful logic through it, including startup normalization
3. add the internal coordinator on Android and fold terminal `apply()` /
   `update()` cleanup into the same pass
4. route Android stateful logic through it, including startup normalization
5. fix iOS export parity
6. harden manifest URL construction
7. do the small cleanup pass
8. run cross-platform flow verification

This keeps the biggest method reshapes together so we do not refactor the same
paths twice.
