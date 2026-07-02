# Implementation Plan: Splash / Loading Screen for Immediate Updates

Status: ready to implement — **design verified against `@capacitor/splash-screen`
source** (both platforms). Minimal.
Owner: —
Related: [01-partial-delta-updates.md](./01-partial-delta-updates.md) (deltas shrink
the download the splash waits on), [CAPGO_IMPROVEMENT_PLAN.md](../../CAPGO_IMPROVEMENT_PLAN.md)

> **Source confidence.** Behavior below is verified by reading
> `@capacitor/splash-screen@8.0.1` iOS + Android source in
> `node_modules` — and `examples/demo-app` already depends on exactly
> `@capacitor/splash-screen: "8.0.1"` (verified in its `package.json`), so the
> E2E setup needs no new dependency. Capgo's `autoSplashscreen` *implementation*
> could **not** be verified — `@capgo/capacitor-updater` is a separate repo, not in `../capgo`. The
> only Capgo fact used is its config (`../capgo/capacitor.config.ts`:
> `SplashScreen.launchAutoHide:false` + `CapacitorUpdater.autoSplashscreen:true`).

## 1. Problem

With an `immediate` policy (the recommended `runtimePolicy: 'immediate'` / a
`launch` immediate, or manual `update()`), the plugin on cold start does
**check → download → apply → `webView.reload()`**. The download can take ~1 min.
Today the user sees: OS launch screen → current/builtin app loads → splash
auto-hides → **old app** → (download) → **reload flash** → new app.

`@capacitor/splash-screen` in its default setup can't fix this because it
auto-hides after the first load and the app calls `hide()` during its normal
startup — both happen before the OTA reload.

**Goal:** for immediate cold start, the user sees **splash → new app**: no old app,
no reload flash, no second/overlay screen — without trapping the user if the
network is slow or fails.

## 2. Verified facts (from `@capacitor/splash-screen@8.0.1` source)

- **iOS** (`SplashScreen.swift`): splash = `parentView.addSubview(...)` where
  `parentView = bridge.viewController.view` — a **sibling view above the WebView**.
  `webView.reload()` reloads content *inside* the WebView only → **the splash
  survives the reload.**
- **Android** (`SplashScreen.java`): splash is added via `windowManager.addView`
  (or a full-screen `Dialog`) — a **separate window on top** → also survives the
  reload.
- Both: `show` / `hide` are JS-callable plugin methods; **`launchAutoHide: false`**
  keeps the launch splash up until `hide()` is called. iOS `showOnLaunch` renders
  the `LaunchScreen` storyboard → continuous from the OS launch screen, **no
  double-screen**.

Conclusion: we should **reuse `@capacitor/splash-screen`** (no custom overlay — a
custom overlay would appear *after* the OS launch screen and cause the
two-screens-in-a-row problem). We do **not** need any cross-plugin native call or
to render our own view.

## 3. Design — defer `notifyAppReady()` during an immediate cold-start update

The whole fix is one behavior change in OtaKit plus a documented app contract.

### App contract
- Install `@capacitor/splash-screen`, set **`SplashScreen: { launchAutoHide: false }`**.
- Keep the pattern OtaKit already recommends:
  ```ts
  await OtaKit.notifyAppReady();
  await SplashScreen.hide();
  ```

### OtaKit change (native, both platforms)
- New opt-in config: **`holdReadyForImmediateUpdate: true`** (default off).
- Set a flag **synchronously in `load()`** when the effective cold-start policy is
  `immediate` (runtime or launch — the decision is synchronous today:
  `dispatchColdStart` → `isRuntimeUnresolved()` is a `UserDefaults` read):
  "immediate cold-start update in progress."
- In `notifyAppReady()`: **if that flag is set, run all native side effects
  immediately as today** (`cancelTrialTimeout`, `prepareNotifyAppReady`
  trial→success transition, telemetry, cleanup) **and defer only the JS
  `call.resolve()`** — store the pending call. Otherwise resolve as today.
  *Why not defer everything:* `normalizeStartupState` can promote a pending
  current bundle to `trial` at startup and schedule the `appReadyTimeout`
  rollback timer (verified: `UpdaterCoordinator.swift:168-173` +
  `UpdaterPlugin.swift:125-129`). If the whole call were held, that timer
  (default 10s) would fire mid-download and roll back + reload a healthy
  bundle. Deferring only the resolve keeps trial/rollback semantics exactly
  as today in every state.
- Clear the flag + drop the stored (old) call when the immediate flow **applies**
  (right before `setServerBasePath` + `reload`): the reload destroys that JS
  context, so the old bundle never reaches `SplashScreen.hide()`.
- Resolve the pending call (and clear the flag) when the flow **settles without a
  reload**: no-update, download/apply failure, or the **max-wait timeout**.

### Why it produces "splash → new app" (trace)
1. Launch splash up (`launchAutoHide:false`).
2. Old bundle loads *under* the splash, boots, `await notifyAppReady()` → **not
   resolved** (flag set) → never calls `hide()`.
3. Download → apply → `reload()` under the splash; old JS context destroyed (the
   hanging await simply goes away — no leak).
4. New bundle loads under the splash, `await notifyAppReady()` → flag cleared →
   **resolves** → app calls `SplashScreen.hide()`.
5. User saw only: splash → new app.

No-update / failure / timeout → `notifyAppReady` resolves → app hides splash →
shows the current bundle. The user is never trapped.

### Interaction with the trial/rollback timer
Unchanged **by construction**: the trial-confirm side effects of
`notifyAppReady` run immediately even while the resolve is held (see above), so
`appReadyTimeout` behaves identically whether or not the splash hold is active.
The post-apply (new) bundle's `notifyAppReady` resolves normally and does its
usual trial-confirm. (An earlier draft argued the old bundle "isn't in a trial
anyway" — not guaranteed; the startup normalizer can put it in trial. The
side-effects-now/resolve-later split removes the assumption.)

## 4. Scope — cold start only (and that's enough)

- **Covered:** `runtimePolicy: 'immediate'` (fresh install / new `runtimeVersion`)
  and `launchPolicy: 'immediate'`. This is where the 1-minute-download + reload
  flash actually hurts.
- **Not covered, by design:** resume. The recommended/default `resumePolicy` is
  `shadow` (resume *checks/stages* but never applies+reloads), so there's no flash
  to cover on resume. An app that sets `resumePolicy: 'immediate'` would still get
  a reload on resume; we document that the splash feature doesn't cover it (a
  resume splash would need programmatic `SplashScreen.show()` + is more intrusive
  since the app is already visible). Revisit only if a real app needs it.

## 5. Config summary

```ts
plugins: {
  OtaKit: {
    holdReadyForImmediateUpdate: true,   // defer notifyAppReady during cold-start immediate
    immediateReadyTimeoutMs: 20000,      // max hold before resolving anyway (never trap)
  },
  SplashScreen: {
    launchAutoHide: false,               // REQUIRED — splash stays up until app hides it
  }
}
```

Default off → zero behavior change for apps that don't opt in. Splash appearance is
configured entirely on `@capacitor/splash-screen`.

## 6. Files touched (small)

Plugin only — no console/CLI/DB work:
- `src/definitions.ts` — add `holdReadyForImmediateUpdate?` + `immediateReadyTimeoutMs?`
  to `OtaKitConfig`.
- iOS `UpdaterPlugin.swift` — read config in `load()`; set the in-progress flag
  synchronously when cold-start policy is immediate; in `notifyAppReady` store the
  `CAPPluginCall` instead of resolving while the flag is set; resolve/clear on
  apply / no-update / failure / timeout (reuse the `scheduleTrialTimeout`
  `DispatchWorkItem` pattern for the timeout).
- Android `UpdaterPlugin.java` — mirror (hold the `PluginCall`, `call.resolve()`
  later / on timeout).
- `packages/capacitor-plugin/README.md` + React/Next docs — document the contract:
  `launchAutoHide:false` + `notifyAppReady()` then `SplashScreen.hide()`.

## 7. Edge cases & risks (honest)

- **App must call `SplashScreen.hide()` after `notifyAppReady()`.** With
  `launchAutoHide:false`, if the app never hides, the splash is stuck — but that's
  inherent to `launchAutoHide:false` regardless of OTA, and it's the already-
  documented pattern. We rely on the contract (we deliberately avoid a fragile
  cross-plugin auto-hide; could add one later as a safety net).
- **Wasted old-bundle boot.** The old bundle still loads + boots under the splash
  (just invisibly) before the reload. Minor wasted work; not a correctness issue.
  Avoiding it would require intercepting Capacitor's initial load (Capgo-style
  `directUpdate`) — more complexity than it's worth for v1.
- **Stuck on slow/failed network.** `immediateReadyTimeoutMs` resolves
  `notifyAppReady` so the app hides the splash and shows the current bundle; the
  download continues in the background and applies next cycle. Deltas (Plan 01)
  reduce how often this bites.
- **App forgets `notifyAppReady()`.** Already required for rollback; the timeout is
  the backstop.
- **Pending-call cleanup on reload.** Ensure the stored (old) `CAPPluginCall` /
  `PluginCall` is dropped when we trigger the reload, so we don't hold a stale ref.

## 8. Testing

E2E (`examples/demo-app`, `@capacitor/splash-screen` + `launchAutoHide:false` +
`holdReadyForImmediateUpdate:true`) with an artificially **slow** download:
- cold start, update available → splash stays → new app; no old app, no flash;
  splash hides after the *new* bundle's `notifyAppReady`.
- cold start, no update → `notifyAppReady` resolves promptly → current app shown.
- download fails → current bundle shown, splash hidden.
- app never calls `notifyAppReady` → resolves at `immediateReadyTimeoutMs`.
- new bundle unhealthy (no `notifyAppReady`) → trial rollback as today; splash
  handling still resolves so the user isn't stuck.
- Unit (native): flag set/cleared correctly; pending call resolved exactly once on
  every settle path; dropped on reload.

## 9. Phasing

1. **Phase 1** — the deferral + timeout + docs. The whole fix.
2. **Later (only if needed)** — optional cross-plugin auto-hide safety net; resume
   coverage via programmatic `SplashScreen.show()`; a progress indicator (note:
   `@capacitor/splash-screen` shows a static image — progress would need a small
   extra native view, deferred).

## 10. Open questions

- Review the previous (non-working) branch — what approach did it take, and does
  this simpler "defer notifyAppReady" model avoid its failure?
- Default `immediateReadyTimeoutMs` — tune against real networks.
- Should `holdReadyForImmediateUpdate` auto-enable when a policy is `immediate`?
  Lean explicit/opt-in (it pairs with the required `launchAutoHide:false`).
