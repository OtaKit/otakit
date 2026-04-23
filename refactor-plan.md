# OtaKit Plugin Simplification — Change Plan v5

## Goal

Make the Capacitor plugin boring again.

The plugin should become:

- one small OTA engine
- three lifecycle entry points
- one shared set of update primitives
- one rollback safety loop

It should not be:

- a splash-screen manager
- a launch/resume UI state machine
- a lock-heavy lifecycle coordinator

This refactor does not need backward compatibility. The plugin is still early
enough that we should optimize for the cleanest model now.

---

## Product Direction

The simplified product model is:

- runtime change is its own cold-start event
- normal cold start is its own event
- resume is its own event
- all three events can use the same policy names
- the policies are just compositions of shared primitives

Recommended defaults:

- `runtimePolicy = 'immediate'`
- `launchPolicy = 'apply-staged'`
- `resumePolicy = 'shadow'`

That gives a simple default behavior:

- first install or new `runtimeVersion`: catch up immediately
- later cold starts: apply already staged content if there is any, otherwise
  check and download in the background
- foreground resumes: periodically check and download in the background

No custom overlay. No resume masking. No special launch spinner contract.

---

## Core Design Rule

This is the most important simplification:

- `shadow` = check + download
- `apply-staged` = apply staged if present, otherwise shadow
- `immediate` = check + download + apply

The same underlying primitives should power:

- automatic native flows
- manual JS APIs
- internal engine behavior

We should stop inventing separate event-specific logic trees.

The event handlers should be thin wrappers around the same shared operations.

---

## Public Config

```ts
type OtaKitPolicy = 'off' | 'shadow' | 'apply-staged' | 'immediate'

interface OtaKitConfig {
  appId: string
  channel?: string
  runtimeVersion?: string

  launchPolicy?: OtaKitPolicy
  resumePolicy?: OtaKitPolicy
  runtimePolicy?: OtaKitPolicy

  // Background resume checks only
  checkInterval?: number // default: 600_000

  // Safety
  appReadyTimeout?: number // default: 10_000

  // URLs / trust
  ingestUrl?: string
  serverUrl?: string
  cdnUrl?: string
  manifestKeys?: OtaKitManifestKey[]
  allowInsecureUrls?: boolean
}
```

### Defaults

```ts
launchPolicy = 'apply-staged'
resumePolicy = 'shadow'
runtimePolicy = 'immediate'
checkInterval = 600_000
```

### Manual-only integration

If an app wants to drive everything from JS:

```ts
launchPolicy = 'off'
resumePolicy = 'off'
runtimePolicy = 'off'
```

Then only the manual APIs are used.

For this simplification, "manual APIs" means command-style methods only.
The plugin should not keep a separate event-listener surface just because it
exists today.

---

## Event Model

There are only three automatic events:

- `runtime`
  Cold start where the current runtime lane has not been resolved yet.
- `launch`
  Normal cold start where runtime is already resolved.
- `resume`
  App returning from background.

### Cold-start dispatcher

```text
on cold start:
  prune incompatible bundles
  rollback dangling trial bundle if needed

  if currentRuntimeKey is unresolved:
    handleRuntime(runtimePolicy)
  else:
    handleLaunch(launchPolicy)
```

### Resume dispatcher

```text
on resume:
  if Android first-resume-after-cold-start:
    ignore it
    return

  handleResume(resumePolicy)
```

This is intentionally simple:

- cold start picks exactly one handler
- resume picks exactly one handler
- no event chains into another event

If runtime owns the cold start, launch does not also run on that same startup.

---

## Runtime Resolution

Keep the existing persisted key:

```text
lastResolvedRuntimeKey
```

Normalize the current runtime as:

```text
currentRuntimeKey = trim(runtimeVersion) || "__default__"
```

Runtime is unresolved when:

```text
lastResolvedRuntimeKey != currentRuntimeKey
```

This must stay. Without it, "first launch after runtime change" is not a real
concept in the implementation.

### Runtime resolution rule

Keep runtime handling as simple as possible:

- `handleRuntime()` owns the whole runtime event
- if `handleRuntime()` finishes without a transient failure, resolve the current
  runtime key at the end
- if it fails during manifest fetch, download, or local apply, do not resolve
  the runtime key

That means:

- `runtimePolicy = 'off'` resolves immediately
- `runtimePolicy = 'shadow'` resolves after a successful no-update or successful
  stage
- `runtimePolicy = 'apply-staged'` resolves immediately before a staged apply,
  or after its shadow fallback finishes without transient failure
- `runtimePolicy = 'immediate'` resolves after a successful no-update, or
  immediately before applying a ready staged bundle

Rule of thumb:

- if a runtime path is about to call `applyStaged()`, resolve the runtime key
  first

This keeps retry-on-next-cold-start for transient failures without needing a
large rules table.

### Runtime error handling

The runtime wrapper should be structured like this conceptually:

```text
try:
  run the selected runtime policy
  resolve current runtime key when the runtime flow completed normally
catch transient error:
  log it
  do not resolve current runtime key
  keep booting current bundle
```

---

## Shared Engine Primitives

The engine should revolve around four internal operations.

### Error propagation contract

This is load-bearing and must be explicit:

- `checkLatest()`, `downloadLatest()`, and `applyStaged()` return only normal
  business outcomes
- transient or operational failures must throw / reject
- failures must never be converted into `no_update`

Meaning:

- `no_update` means "we successfully determined there is nothing to do"
- it must not mean "something went wrong"

Examples of failures that must throw:

- manifest fetch failure
- manifest verification failure
- download failure
- hash verification failure
- unzip or staging failure
- local apply failure

Wrappers catch at the boundary where behavior must be decided:

- runtime handler: catch and do not resolve `lastResolvedRuntimeKey`
- launch/resume handlers: catch and keep serving the current bundle
- manual APIs: catch and reject to JS

This is what preserves retry-on-next-cold-start for runtime catch-up.

### 1. `checkLatest(options)`

Check whether the current channel/runtime has a usable update.

Suggested internal result:

```ts
type CheckResolution =
  | { kind: 'no_update' }
  | {
      kind: 'already_staged'
      latest: LatestManifest
      bundle: BundleInfo
    }
  | {
      kind: 'update_available'
      latest: LatestManifest
    }
```

Responsibilities:

- optionally enforce `checkInterval`
- fetch the latest manifest
- verify manifest signature
- compare against current bundle
- compare against staged bundle
- suppress a manifest that matches `lastFailedBundle`
- update the resume check timestamp only when a real interval-respecting check
  was actually performed

Important:

- if the latest manifest matches `lastFailedBundle`, log it and treat it as
  `no_update`
- there is no separate `blocked_latest` result anymore
- if `respectInterval = true` and the interval has not elapsed, log it and
  return `no_update`
- interval bookkeeping lives here, not scattered across event handlers
- manifest fetch or verification failure must throw, not return `no_update`

### 2. `downloadLatest(options)`

Make the latest usable bundle ready locally.

Semantics:

- call `checkLatest(options)`
- if result is `no_update`, return `no_update`
- if result is `already_staged`, return `staged` with that bundle
- if result is `update_available`, download, verify sha256, unzip, stage, and
  return `staged` with the staged bundle
- download, hash, unzip, or staging failure must throw, not return `no_update`

Suggested internal shape:

```ts
type DownloadResolution =
  | { kind: 'no_update' }
  | {
      kind: 'staged'
      bundle: BundleInfo
    }
```

For this plugin, the only successful outcome that matters is:

- the correct bundle is staged locally

We do not need to distinguish "reused staged" vs "downloaded just now" in the
core plan.

### 3. `applyStaged()`

Apply staged content immediately.

Semantics:

- if no staged bundle exists, return `false`
- promote staged bundle to current
- set previous current bundle as fallback
- mark current bundle as `trial`
- start `appReadyTimeout`
- reload the WebView
- return `true`
- activation or reload failure must throw, not return `false`

Suggested internal shape:

```ts
type ApplyResolution = boolean
```

`false` means nothing was staged.
`true` means apply was committed and reload was triggered.

### 4. `resolveCurrentRuntimeKey()`

Persist:

```text
lastResolvedRuntimeKey = currentRuntimeKey
```

This should only be called from the runtime wrapper, not scattered around the
rest of the code.

---

## Policy Semantics

The policy runner should be shared by all three automatic events.

### `off`

```text
do nothing
```

### `shadow`

```text
downloadLatest(...)
```

Meaning:

- check live manifest
- if a newer usable update exists, download and stage it
- never activate on this event

### `apply-staged`

```text
if staged bundle exists:
  applyStaged()
else:
  downloadLatest(...)
```

Meaning:

- if a staged bundle exists, apply it now
- if no staged bundle exists, behave like `shadow`
- this is an automatic policy, not the same thing as the manual `apply()` API

### `immediate`

```text
result = downloadLatest(...)
if result.kind == 'staged':
  applyStaged()
```

Meaning:

- check live manifest
- stage latest if needed
- apply immediately if a bundle is ready locally

Important:

- `apply-staged` is an automatic policy composition, not the same thing as
  manual `apply()`
- `immediate` itself has no runtime-specific behavior
- runtime ownership belongs to the runtime event wrapper, not to `immediate`
- thrown errors are handled by the surrounding event wrapper, not translated
  into `no_update`

---

## Check Interval

`checkInterval` should be handled in exactly one place:

- `checkLatest({ respectInterval: true })`

Everything else should just choose whether to respect it.

### Which flows respect it

Use `respectInterval = true` only for background resume checks:

- resume `shadow`
- resume `apply-staged` fallback when nothing is staged

Use `respectInterval = false` for:

- all launch handling
- all runtime handling
- all `immediate` flows
- all manual JS APIs

This keeps the meaning simple:

- `checkInterval` throttles background resume polling
- it does not throttle explicit apply-now flows

### Timestamp rule

`checkLatest()` is the only place that reads or writes the persisted resume
check timestamp.

Suggested semantics:

- if the interval prevents a real HTTP check, log it and return `no_update`
- do not update the timestamp on an interval skip
- do not update the timestamp when manifest fetch fails
- if a real interval-respecting manifest check finishes, update the timestamp
- later download/apply outcomes do not change that timestamp

That is the simplest consistent model.

---

## Manual API Mapping

The public JS APIs should directly map to the same engine primitives.

Keep these manual APIs:

- `getState()`
- `check()`
- `download()`
- `apply()`
- `update()`
- `notifyAppReady()`
- `getLastFailure()`

Do not preserve the listener API in this refactor:

- no `addListener(...)`
- no `removeAllListeners()`
- no requirement to preserve current event names

If a real integrator later needs reactive update-progress events, we can add a
smaller event surface back intentionally.

Suggested public shapes:

```ts
type CheckResult =
  | { kind: 'no_update' }
  | {
      kind: 'already_staged'
      latest: LatestVersion
    }
  | {
      kind: 'update_available'
      latest: LatestVersion
    }

type DownloadResult =
  | { kind: 'no_update' }
  | {
      kind: 'staged'
      bundle: BundleInfo
    }
```

### `check()`

- wraps `checkLatest({ respectInterval: false })`
- returns `{ kind: 'no_update' }`
- returns `{ kind: 'already_staged', latest }` when the exact latest is already
  staged
- returns `{ kind: 'update_available', latest }` when a newer usable update
  exists

### `download()`

- wraps `downloadLatest({ respectInterval: false })`
- returns `{ kind: 'no_update' }` when nothing new is needed
- returns `{ kind: 'staged', bundle }` when the latest usable bundle is ready
  locally

### `apply()`

- wraps `applyStaged()`
- explicit manual action
- local only

### `update()`

`update()` should use the same core flow as automatic `immediate`:

```text
result = downloadLatest({ respectInterval: false })
if result.kind == 'staged':
  applyStaged()
```

Important:

- `update()` is not a lifecycle wrapper
- `update()` does not own runtime resolution
- `update()` does not respect `checkInterval`
- the old fallback behavior in `src/index.ts` should be deleted
- if `downloadLatest()` or `applyStaged()` throws, `update()` should reject

---

## Failed Bundle Suppression

This safety rule must stay.

### Persisted name

Use:

```text
lastFailedBundle
```

That name is clearer than `failedBundle` or `blockedLatest`.

### What it means

A bundle becomes `lastFailedBundle` only if:

- it was activated
- it entered `trial`
- it did not call `notifyAppReady()` in time
- or the app restarted before `notifyAppReady()`

This is not a network failure.
It is a proven unhealthy activated release.

### Why it exists

Without this rule, a broken release causes an infinite loop:

1. latest bundle downloads
2. latest bundle applies
3. app fails before `notifyAppReady()`
4. rollback happens
5. next check sees the same latest again
6. plugin applies the same broken release again

### Minimal rule

Persist enough information from `lastFailedBundle` to match the latest manifest:

- `releaseId`
- `sha256`
- `runtimeVersion`
- `channel`

During `checkLatest()`:

- if the latest manifest matches `lastFailedBundle`, log suppression and treat
  it as `no_update`

That is enough.

No retry counters. No backoff table. No quarantine state machine.

When a different release appears, the match stops naturally.

---

## Rollback Model

The rollback model should stay exactly as the real safety core of the plugin.

### Bundle states that matter

- builtin
- current
- staged
- fallback
- trial

### Apply flow

When `applyStaged()` succeeds:

1. previous current becomes fallback
2. staged becomes current
3. current is marked `trial`
4. `appReadyTimeout` starts
5. WebView reloads

### Success flow

If JS calls `notifyAppReady()` before timeout:

1. clear `trial`
2. mark current bundle healthy
3. clear pending rollback condition

### Timeout rollback flow

If `notifyAppReady()` does not arrive before timeout:

1. mark current trial bundle as failed
2. persist `lastFailedBundle`
3. restore fallback as current
4. clear trial state

### Restart-before-ready rollback flow

On the next cold start:

1. if current bundle is still `trial`
2. assume previous startup failed
3. mark current trial bundle as failed
4. persist `lastFailedBundle`
5. restore fallback

This is already the correct safety model. We should keep it and remove only the
lifecycle/UI complexity around it.

---

## Concurrency Model

Keep exactly one update owner per platform.

### iOS

Use one `actor` or one dedicated serial queue for:

- automatic event handling
- manual API calls
- trial timer bookkeeping

### Android

Use one executor for:

- automatic event handling
- manual API calls
- mutable bundle state

Main thread should only do:

- WebView reload
- base-path switch
- platform timer bridging if needed

### Busy rule

Concurrent operations should be rejected, not queued.

If a new automatic or manual request arrives while another update operation is
running:

- return immediately
- emit a clear debug log
- do not enqueue future work

Queuing creates stale work and harder-to-reason-about edge cases.

---

## Android Cold-Start Resume Dedupe

This is one real lifecycle wrinkle we still need to keep.

### Why it happens

On Android cold start, Capacitor plugin `load()` runs during activity startup,
and the activity then receives its first `onResume()` immediately after.

So without dedupe, a single cold start can accidentally do both:

- cold-start runtime/launch handling
- resume handling

That is wrong.

### Smallest fix

Keep one explicit boolean:

```text
coldStartInProgress
```

Rule:

```text
load():
  coldStartInProgress = true
  run cold-start dispatch

handleOnResume():
  if coldStartInProgress:
    coldStartInProgress = false
    return

  run real resume dispatch
```

This is the whole fix.

It should not be tied to:

- overlay state
- update mode
- splash behavior

It is just lifecycle dedupe.

---

## What Gets Deleted

Remove entirely:

- custom native overlay on iOS and Android
- overlay state machines
- launch/resume UI ownership logic
- resume masking support
- splash timeout logic tied to update flow
- top-level `updateMode`
- `immediateUpdateOnRuntimeChange`
- custom "next-launch" and "next-resume" product mode branches

What stays:

- manifest verification
- sha256 verification
- staging
- apply
- trial timeout
- rollback
- failed-bundle suppression
- runtime resolution key
- manual command APIs

---

## Implementation Shape

### Phase 1. Public API cleanup

1. Replace top-level mode config with:
   - `launchPolicy`
   - `resumePolicy`
   - `runtimePolicy`
2. Keep policy name `apply-staged` distinct from manual `apply()`
3. Remove overlay-related config from TS definitions and docs
4. Remove listener/event API from TS definitions and docs

### Phase 2. Shared engine extraction

1. implement:
   - `checkLatest(options)`
   - `downloadLatest(options)`
   - `applyStaged()`
   - `resolveCurrentRuntimeKey()`
2. make policy runners compose only those operations
3. centralize interval handling inside `checkLatest(options)`
4. keep a single busy-rejection rule

### Phase 3. Event wrappers

1. implement cold-start dispatcher
2. implement runtime wrapper
3. implement launch wrapper
4. implement resume wrapper

### Phase 4. iOS rewrite

1. delete overlay/state-machine code
2. move to one serialized owner
3. wire lifecycle hooks into the new dispatcher

### Phase 5. Android rewrite

1. delete overlay/state-machine code
2. keep one executor as owner
3. add `coldStartInProgress` first-resume dedupe

### Phase 6. Docs and smoke tests

1. rewrite docs around event policies
2. explain failed-bundle suppression clearly
3. explain rollback clearly
4. test the main flows on both platforms

---

## Test Matrix

### Core safety

1. download -> apply -> `notifyAppReady()` -> success
2. download -> apply -> timeout -> rollback
3. download -> apply -> app restart before ready -> rollback
4. rollback records `lastFailedBundle`
5. latest manifest matching `lastFailedBundle` is treated as no update
6. different release clears suppression naturally

### Runtime event

7. runtime `off` resolves the runtime key and keeps booting current bundle
8. runtime `apply-staged` applies staged bundle if present
9. runtime `apply-staged` with no staged bundle falls back to shadow behavior
10. runtime `shadow` stages but does not apply
11. runtime `immediate` stages and applies
12. runtime handler resolves the runtime key when it finishes without transient
    failure
13. runtime handler does not resolve the runtime key on fetch/download/apply
    failure
14. `checkLatest()` and `downloadLatest()` do not collapse transient failure
    into `no_update`

### Normal cold start

15. launch `off` does nothing
16. launch `apply-staged` applies staged bundle if present
17. launch `apply-staged` with no staged bundle falls back to shadow behavior
18. launch `shadow` checks and downloads, never applies
19. launch `immediate` checks, downloads, applies
20. launch `immediate` failure stays on current bundle

### Resume

21. resume `off` does nothing
22. resume `apply-staged` applies staged bundle immediately if present
23. resume `apply-staged` with no staged bundle falls back to shadow and
    respects `checkInterval`
24. resume `shadow` respects `checkInterval`
25. resume `shadow` downloads but does not apply
26. resume `immediate` ignores `checkInterval`
27. interval-skipped resume check returns no update and does not update the
    stored resume timestamp
28. manifest fetch failure does not update the stored resume timestamp

### Platform lifecycle

29. Android cold start does not also run resume logic immediately afterward
30. iOS foreground path runs only resume logic on real foreground return

### Manual API parity

31. `check()` returns `no_update`, `already_staged`, or `update_available`
32. `download()` returns `no_update` or `staged`
33. `check()` reports exact staged latest as `already_staged`
34. `apply()` is local-only
35. `update()` uses the same core flow as `immediate`
36. manual APIs reject on operational failure; they do not translate failure
    into `no_update`

---

## Flow Appendix

These are the concrete behaviors the implementation should follow.

### A. Cold Start With Runtime Change

Dispatcher:

```text
prune incompatible bundles
rollback dangling trial if needed
handleRuntime(runtimePolicy)
```

#### `runtimePolicy = 'off'`

```text
do nothing special
resolve current runtime key
boot current bundle
```

#### `runtimePolicy = 'apply-staged'`

```text
if staged bundle exists:
  resolve current runtime key
  applyStaged()
  return

result = downloadLatest({ respectInterval: false })

if result.kind == 'no_update' or result.kind == 'staged':
  resolve current runtime key

boot current bundle
```

#### `runtimePolicy = 'shadow'`

```text
result = downloadLatest({ respectInterval: false })

if result.kind == 'no_update' or result.kind == 'staged':
  resolve current runtime key

boot current bundle
```

#### `runtimePolicy = 'immediate'`

```text
result = downloadLatest({ respectInterval: false })

if result.kind == 'staged':
  resolve current runtime key
  applyStaged()
  return

if result.kind == 'no_update':
  resolve current runtime key

boot current bundle
```

### B. Normal Cold Start

Dispatcher:

```text
prune incompatible bundles
rollback dangling trial if needed
handleLaunch(launchPolicy)
```

#### `launchPolicy = 'off'`

```text
boot current bundle
```

#### `launchPolicy = 'apply-staged'`

```text
if applyStaged():
  return

result = downloadLatest({ respectInterval: false })

boot current bundle
```

#### `launchPolicy = 'shadow'`

```text
result = downloadLatest({ respectInterval: false })

boot current bundle
```

#### `launchPolicy = 'immediate'`

```text
result = downloadLatest({ respectInterval: false })

if result.kind == 'staged':
  if applyStaged():
    return

boot current bundle
```

There is no fallback from failed `immediate` to `apply-staged`.

### C. Resume

Dispatcher:

```text
if Android first resume after cold start:
  ignore it
  return

handleResume(resumePolicy)
```

#### `resumePolicy = 'off'`

```text
do nothing
```

#### `resumePolicy = 'apply-staged'`

```text
if applyStaged():
  return

result = downloadLatest({ respectInterval: true })

keep running current bundle
```

#### `resumePolicy = 'shadow'`

```text
result = downloadLatest({ respectInterval: true })

keep running current bundle
```

#### `resumePolicy = 'immediate'`

```text
result = downloadLatest({ respectInterval: false })

if result.kind == 'staged':
  applyStaged()
  return

keep running current bundle
```

### D. Resume Check Interval

This is the intended interval behavior:

#### Resume with `off`

```text
interval does not matter
resume does nothing
```

#### Resume with `apply-staged`

```text
if staged exists:
  apply immediately

if no staged exists:
  run background resume check with respectInterval = true
```

#### Resume with `shadow`

```text
run background resume check with respectInterval = true
```

#### Resume with `immediate`

```text
ignore checkInterval
run check + download + apply
```

#### `checkLatest({ respectInterval: true })`

```text
if interval not elapsed:
  log it
  return no_update

perform the manifest check

if manifest check succeeded:
  update lastResumeCheckAt
```

### E. Rollback Flows

#### Apply then success

```text
staged bundle becomes current trial
app reloads
JS calls notifyAppReady()
trial is cleared
bundle is now healthy current
```

#### Apply then timeout

```text
staged bundle becomes current trial
app reloads
notifyAppReady() never comes
timeout fires
trial bundle is marked failed
lastFailedBundle is stored
fallback becomes current again
```

#### Apply then app restart before ready

```text
staged bundle becomes current trial
app reloads
app dies or restarts before notifyAppReady()
next cold start sees unresolved trial
trial bundle is marked failed
lastFailedBundle is stored
fallback becomes current again
```

#### After rollback, next check sees the same latest release

```text
checkLatest() matches lastFailedBundle
log suppression
return no_update
plugin does not download/apply it again
```

#### After rollback, a newer different release appears

```text
lastFailedBundle no longer matches the latest manifest
normal download/apply flow resumes
```

### F. Manual API Flows

#### `check()`

```text
run checkLatest({ respectInterval: false })

if no_update:
  return { kind: 'no_update' }

if already_staged:
  return { kind: 'already_staged', latest }

if update_available:
  return { kind: 'update_available', latest }
```

#### `download()`

```text
result = downloadLatest({ respectInterval: false })

if result.kind == 'staged':
  return { kind: 'staged', bundle: result.bundle }

otherwise:
  return { kind: 'no_update' }
```

#### `apply()`

```text
run applyStaged()
```

#### `update()`

```text
result = downloadLatest({ respectInterval: false })

if result.kind == 'staged':
  applyStaged()
```

That is it.

`update()` should not have extra hidden behavior beyond that composition.
