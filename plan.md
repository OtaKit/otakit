# Resume-based update checking for the OtaKit Capacitor plugin

## Context

### The problem

The current plugin only checks for updates on **cold start** (app kill + reopen). In practice, users rarely kill apps — they background them. This means:

- `next-launch` (default): check+download on cold start, apply on the *next* cold start = **two full app kills** before an update reaches the user. Could take days.
- `immediate`: download AND apply during a single cold start, but still requires the user to kill the app first.

### What competitors do

**Capgo** checks on **every foreground event** with no throttle. Aggressive — fast delivery, but every resume from every device hits the server simultaneously. No thundering-herd protection. Apply happens when app goes to background (swap while invisible).

**Capawesome** checks on foreground with a **hardcoded 15-minute throttle** (not configurable). Apply requires full restart or explicit `reload()`. Simpler but slower delivery.

**Both** are more responsive than cold-start-only because apps foreground dozens of times per day.

### What we want

Add foreground/resume checking with a sensible throttle (30 min default). Keep it simple. No download progress events. No jitter — app resumes are naturally spread out.

---

## Design

### Update modes

Two production modes and one dev/debug mode. All automatic modes now check + download on both **cold start** and **app resume** (throttled by `checkInterval`).

| Mode | Target use | When it applies a staged bundle |
|---|---|---|
| `next-launch` (default) | Production | Next cold start only |
| `next-resume` | Production | Next resume or cold start |
| `immediate` | Dev/debug | Blocks cold start. On resume: check+download+activate in one shot. |
| `manual` | Custom flows | Never automatic |

### Production modes

**`next-launch`** (default — zero disruption):
- Cold start: activate staged if exists (non-manual modes only), then check+download in background
- Resume: check+download in background only — never auto-apply on resume
- User gets the update on the next cold start after a download completes
- **UX**: no surprise reloads, ever. User never loses in-app state from an update. Slowest delivery but safest.

**`next-resume`** (balanced — recommended for most apps):
- Cold start: activate staged if exists (non-manual modes only), then check+download in background
- Resume: if staged bundle exists → activate + reload. Otherwise → check+download in background.
- Typical flow: resume #1 downloads silently, resume #2 activates with a brief flash
- **UX**: one reload per update, always at the moment the user returns to the app (not mid-session). Predictable. In-progress state may be lost on that resume — developers should document this.

### Dev/debug mode

**`immediate`** (stop-and-wait — primarily for development and testing):
- Cold start: **blocks startup** — check+download+activate before the app loads. User sees splash screen until the latest version is ready.
- Resume: if staged bundle exists → activate + reload. Otherwise → check+download in background → activate + reload when done (mid-session reload).
- **UX**: user always gets the latest version at the cost of startup delays and mid-session reloads. Useful during development to verify OTA updates take effect immediately. Not recommended for production — bad connectivity means users stare at the splash screen, and mid-session reloads are disruptive.
- Works fine for niche production cases like kiosk apps or enterprise devices where "always latest" outweighs UX concerns.

### Shared automatic update logic

Cold start and resume share one method to keep mode-branching in one place:

```
runAutomaticUpdate(trigger: launch | resume):

  // --- guards (resume only) ---

  if trigger == resume AND mode == manual:
    return

  if trigger == resume AND mode in (next-resume, immediate) AND staged bundle exists:
    activate + reload
    return                          // apply what's ready, skip server check

  if trigger == resume AND !throttleAllowsCheck():
    return

  // --- acquire in-flight guard ---

  if !isCheckInProgress.claim():
    return                          // another check is already running

  // --- immediate: blocking check+download+activate ---

  if mode == immediate:
    if trigger == launch:
      // block main thread (behind splash screen)
      result = performCheckAndDownload()    // synchronous
      if result completed successfully:
        recordCheckTimestamp()
      if result has new bundle:
        activate + reload
      isCheckInProgress.release()
      return

    if trigger == resume:
      // background, but activate when done (mid-session reload)
      background {
        try:
          result = performCheckAndDownload()
          if result completed successfully:
            recordCheckTimestamp()
          if result has new bundle:
            activate + reload
        finally:
          isCheckInProgress.release()
      }
      return

  // --- next-launch / next-resume: background check+download ---

  background {
    try:
      result = performCheckAndDownload()
      if result completed successfully:
        recordCheckTimestamp()
    finally:
      isCheckInProgress.release()
  }
```

On cold start, `load()` handles staged activation and TRIAL setup *before* calling this method. Staged activation in `load()` only happens for non-manual modes — `manual` mode never auto-activates.

### Why `next-resume` and `immediate` activate staged on resume without a server check

Speed. If a bundle was already downloaded on a previous resume, the fastest path is to activate it right away — no server roundtrip needed. The next check (after throttle) will discover any even-newer updates.

### Full UX walkthrough per mode

**`next-launch` — developer releases v2:**
1. User backgrounds app, comes back 35 min later
2. Resume: check → v2 found → download in background (user doesn't notice)
3. User keeps using app normally
4. Days later, user kills app and reopens → v2 activates silently on cold start

**`next-resume` — developer releases v2:**
1. User backgrounds app, comes back 35 min later
2. Resume: no staged bundle → check → v2 found → download in background
3. User keeps using app (download completes silently)
4. User backgrounds, comes back 10 min later
5. Resume: staged bundle exists → activate + reload → user sees brief flash, now on v2

**`immediate` — developer testing an OTA update:**
1. Developer deploys v2 via CLI
2. Kills the app, reopens → splash screen → check → v2 found → download → activate → app loads with v2
3. Or: backgrounds and foregrounds → check → v2 found → download → activate → reload with v2

**`next-resume` — user never backgrounds for 30+ min:**
1. User keeps backgrounding/foregrounding within 30 min → throttle prevents checks
2. Eventually a gap > 30 min happens → check+download occurs
3. Next resume → activate

---

## Throttle implementation

- Store `lastCheckTimestamp` (epoch ms) in UserDefaults (iOS) / SharedPreferences (Android)
- Survives app restarts (not just in-memory)
- Default: 30 minutes (`1800000` ms), minimum: 10 minutes (`600000` ms)
- **Record timestamp only after a successful full check cycle** — meaning one of:
  - Manifest returned 204 (no update available)
  - Manifest returned 200 and a matching staged bundle was reused (no download needed)
  - Manifest returned 200 and download + staging succeeded
- **Do NOT record on failure** — network error, manifest error, download hash mismatch, disk full, etc. This ensures failed checks don't block retries for 30 min.

## In-flight guard

An `isCheckInProgress` flag prevents duplicate checks (both automatic and manual):

- **Submit-time, not run-time**: claim the flag *before* dispatching to background. Prevents queueing duplicates.
- **Android**: `AtomicBoolean` with `compareAndSet(false, true)` before `executor.execute()`. Reset in `finally`.
- **iOS**: synchronized flag before creating `Task {}`. Reset in `defer`.
- **Solves the Android initial-launch double-check**: `load()` → `startAutoUpdate()` claims the flag. When `handleOnResume()` fires as part of the initial activity lifecycle, it sees the flag taken and skips. On iOS, `willEnterForegroundNotification` does not fire on initial launch — no double-check risk.

## Throttle and guard behavior for manual API calls

The throttle and in-flight guard apply to **all** check paths — both automatic and manual JS API calls. This prevents apps from accidentally hammering the server (e.g., `check()` called on every render) and avoids concurrent staging races.

| API | Throttle | In-flight guard | Rationale |
|---|---|---|---|
| `check()` | Yes | Yes | Production app code — safe by default |
| `download()` | Yes | Yes | Production app code — safe by default |
| `debug.check()` | No | No | Dev/testing escape hatch — always hits server |
| `debug.download()` | No | No | Dev/testing escape hatch — always hits server |
| Automatic (resume/launch) | Yes | Yes | Plugin internal |

**When throttled or busy, manual calls return useful state rather than blindly returning null:**
- `check()` throttled/busy → if a staged bundle exists, return it as the latest (with `downloaded: true`). Otherwise return `null`.
- `download()` throttled/busy → if a staged bundle exists, return its `BundleInfo`. Otherwise return `null`.

This way developers can still discover already-downloaded updates without hitting the server. For a forced server check, they use `debug.check()` / `debug.download()`.

---

## Config

```ts
plugins: {
  OtaKit: {
    appId: "...",
    checkInterval: 1800000,  // NEW: ms between checks. Default 30 min, min 10 min
    updateMode: "next-launch" | "next-resume" | "immediate" | "manual",
    // ... existing options unchanged
  }
}
```

---

## Files to modify

### 1. TypeScript definitions
**`packages/capacitor-plugin/src/definitions.ts`**

- Add `checkInterval?: number` to `OtaKitConfig`
- Change `OtaKitUpdateMode` to `'manual' | 'next-launch' | 'next-resume' | 'immediate'`

### 2. iOS plugin
**`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift`**

- Add `nextResume` case to `UpdateMode` enum
- Add properties: `checkIntervalMs` (Int), `isCheckInProgress` (Bool, synchronized)
- Add `UserDefaults` key `otakit_last_check_timestamp`
- Register `UIApplication.willEnterForegroundNotification` observer in `load()`
- Add `handleAppWillEnterForeground()` → `runAutomaticUpdate(trigger: .resume)`
- Add `runAutomaticUpdate(trigger:)` with the shared logic
- Add `shouldThrottleCheck()` and `recordCheckTimestamp()` helpers
- Modify `startAutoUpdate()` to call `runAutomaticUpdate(trigger: .launch)`
- Modify `check()` and `download()` to respect throttle + in-flight guard, returning staged info when throttled
- Read `checkInterval` from config in `load()`
- Remove observer in `deinit`

### 3. Android plugin
**`packages/capacitor-plugin/android/src/main/java/com/updatekit/updater/UpdaterPlugin.java`**

- Add `UPDATE_MODE_NEXT_RESUME` constant
- Add fields: `checkIntervalMs` (long), `isCheckInProgress` (AtomicBoolean)
- Add `SharedPreferences` key for `lastCheckTimestamp`
- Override `handleOnResume()` → `runAutomaticUpdate("resume")`
- Add `runAutomaticUpdate(String trigger)` with the shared logic
- Add `shouldThrottleCheck()` and `recordCheckTimestamp()` helpers
- Modify `startAutoUpdate()` to call `runAutomaticUpdate("launch")`
- Modify `check()` and `download()` to respect throttle + in-flight guard, returning staged info when throttled
- Read `checkInterval` from config in `load()`

### 4. README
**`packages/capacitor-plugin/README.md`**

- Update "Update modes" section: two production modes + one dev mode
- Document `checkInterval` config option
- Note that `immediate` is primarily for development/testing
- Document throttle behavior for `check()` / `download()` vs `debug.*` APIs

### 5. Plugin JS wrapper
**`packages/capacitor-plugin/src/index.ts`**

- No changes needed — resume logic and throttle checks are entirely native-side

---

## What we are NOT changing

- `manual` mode — stays exactly the same
- `notifyAppReady()` handshake — same
- Rollback mechanism — same
- Bundle lifecycle states (PENDING/TRIAL/SUCCESS/ERROR) — same
- JS API methods (check, download, apply, update, getState) — same
- Events (downloadStarted, downloadComplete, downloadFailed, updateAvailable, noUpdateAvailable, appReady, rollback) — same
- Manifest fetching, signature verification, SHA-256 verification — same
- Stats reporting — same

---

## Implementation order

1. TypeScript definitions (`checkInterval`, `next-resume` mode)
2. iOS implementation (foreground observer + throttle + `runAutomaticUpdate` + manual API throttle)
3. Android implementation (`handleOnResume` + throttle + `runAutomaticUpdate` + manual API throttle)
4. README update
5. Build + verify both platforms compile

---

## Future improvements (not in this PR)

- **ETag / If-None-Match** on manifest requests — server returns 304 when nothing changed, saves bandwidth
- **CDN caching** on the manifest endpoint — cache for 1-5 min at the edge
- **Apply on background** (Capgo-style) — swap the bundle while the app is invisible, user sees new version on next foreground with zero flash/reload
- **`resetWhenUpdate`** — auto-clean OTA bundles when native app version changes (from app store update)
- **Exponential backoff** on repeated server errors
- **Delay conditions** (Capgo-style) — apply after a specific date, or when native version matches

---

## Verification

1. **Build**: `pnpm --filter @otakit/capacitor-updater build && pnpm --filter @otakit/capacitor-updater typecheck`
2. **iOS compile**: Open `examples/demo-app/ios/App/App.xcworkspace` in Xcode, build
3. **Android compile**: `cd examples/demo-app/android && ./gradlew assembleDebug`
4. **First cold launch**: exactly one automatic check (not two) — validates in-flight guard
5. **Throttle test**: foreground rapidly — logs show throttle skipping
6. **Network failure**: check fails → timestamp NOT recorded → next resume retries immediately
7. **Download failure**: manifest 200 but download fails → timestamp NOT recorded → next resume retries
8. **Manual check() throttled**: call `check()` within 30 min of last check → returns staged bundle or null, no server hit
9. **Manual debug.check() bypasses**: call `debug.check()` at any time → always hits server
10. **Manual + auto no race**: `download()` while auto-check in progress → returns staged/null (doesn't queue a second check)
11. **next-launch**: deploy update → resume downloads silently → cold start activates
12. **next-resume**: deploy update → resume #1 downloads → resume #2 activates with brief reload
13. **immediate cold start**: deploy update → kill app → reopen → splash blocks until latest loads
14. **immediate resume**: deploy update → foreground → downloads + activates in one shot
