# React Native updater

Private implementation of the RN OTA plan. RN app creation remains gated; automatic native build hooks and the remaining device matrix are not release-ready. CLI package sealing, OTA baseline preservation and isolated npm package installation are implemented. See [implementation status](../../research/react-native-ota/implementation-status.md).

The bare updater uses React Native and the native OtaKit core. It does not require Expo's native runtime. Expo adapters and their fixture are separate compatibility work.

## Application integration

Autolinking registers the TurboModule, but the application must prepare native storage and select its bundle before React Native starts. The runnable [bare fixture](../../examples/react-native-app/README.md) contains the current AppDelegate/Application/Activity integration.

- iOS calls `OtaKitRuntime.shared.prepare` before creating the RN root. Preparation runs off the main thread. The factory's bundle URL callback reads the prepared selection, and its host-start callback records completion. Preserve the application's factory, initial props and lifecycle callbacks. Reload through RN's reload-command listeners, as the fixture does.
- Android calls `OtaKitRuntime.prepare` once in `Application.onCreate`, then wraps the application's original `ReactHostDelegate` with `createHost`. Supply its component factory, packages and engine configuration. The Activity records UI intent before creating a root and foreground state on resume/pause. The loader waits for local storage preparation on RN's background executor. Early headless startup while storage is still unavailable remains an acceptance gap.
- Android applications must enable core library desugaring with `com.android.tools:desugar_jdk_libs_nio:2.1.5`. The native core uses NIO for atomic moves and file checks; this is required for API 24/25. The library declares Zip4j 2.11.6. Capacitor's Gradle configuration is unchanged.
- iOS resolves the native core installed with the updater through the shipped CocoaPods helper. It does not depend on a repository checkout or a separately published pod specification.

Add the helper to the Podfile alongside React Native's existing setup, and call it inside each application target that uses OtaKit:

```ruby
require Pod::Executable.execute_command('node', ['-p',
  'require.resolve("@otakit/react-native-updater/scripts/cocoapods.rb", {paths: [process.argv[1]]})', __dir__]).strip

target 'YourApplication' do
  use_otakit_updater!
  # Preserve the application's existing use_native_modules! and use_react_native! calls.
end
```

Run `pod install` afterward. The helper uses CocoaPods' supported [local pod path](https://guides.cocoapods.org/syntax/podfile#pod) declaration, resolving the native core through the installed updater's dependencies. The updater pod pins that core version. Both npm archives include their license and native sources; generated builds, fixture keys, tests and source maps are excluded.

The host configuration contains the embedded receipt, a native build ID, RN/Hermes versions, trusted public signing keys, optional bundle decryption keys, CDN URL and channel. Test fixtures generate this configuration locally. Use the embedded export's `embeddedReceipt` and `nativeBuildId`; the CLI's [package sealing step](../cli/src/lib/react-native/README.md) checks them against the actual built package. Production build hooks and complete resolved-input collection remain outstanding; copying a runtime string into configuration is not a supported substitute.

Wrap the existing Metro configuration with `withOtaKitMetro` from `@otakit/react-native-updater/metro`. This retains the existing initializer/resolver and installs the native instance bootstrap before the app entrypoint. The bootstrap establishes an immutable context for that JS instance.

## JavaScript API

`check()`, `download()` and `apply()` are separate steps. `download()` verifies and durably stages the offered artifact. `apply()` requires a foreground, settled host and a bound instance, with no active trial or activation guard. It can reject with `ACTIVATION_DEFERRED`; keep the staged update for a later eligible launch. A successful reload destroys the outgoing JS instance and its pending promise.

Call `notifyAppReady()` after essential local initialization and root mounting. Bootstrap and host completion do not confirm readiness automatically. Unconfirmed trials have a ten-second foreground-time budget; background time does not consume it. A timeout or process death before readiness rolls back and quarantines that content hash. Calls from an older generation cannot confirm or stage code for its replacement.

`setActivationGuard(true)` temporarily defers activation for application work; clear it when that work completes. Native background-work deferral is stricter: a process started headless, or an Android host observed running a headless task, keeps activation deferred for that process. Clearing the JS guard does not override it. Downloads can still stage a candidate for the next clean foreground process.

`getState()` exposes the current selection, staged update, failed hashes and pending outcome events. `launchContext` belongs to the executing instance. Selecting identical confirmed content updates its verified publication association without reloading or emitting another success. A real switch back to the embedded baseline requires readiness and retains the outgoing fallback until confirmation; it transfers no bundle bytes.

Set the optional native `ingestURL` to the versioned ingest base (for example, `https://ingest.example/v1`) to enable the background event worker. It posts the existing envelope to `/events` with `X-App-Id`, without API credentials. Events retain their UUID and timestamp across retries and cold starts. Only HTTP 202 acknowledges delivery; transport errors, 408, 429 and server errors back off from 5 seconds to 5 minutes. Redirects are rejected and terminal responses retain a local diagnostic. Response bodies are not buffered. The durable outbox retains at most 256 events for 24 hours and exposes `droppedEvents` and `lastEventError`. Malformed saved events cannot discard healthy launch pointers. Event delivery runs independently of update downloads and startup; the default automatic-check policy remains unfinished.

After durable cold-start recovery, the transport owner collects unreferenced cached artifacts, their receipts and interrupted staging directories in the background. It retains current, last-good, previous confirmed and staged code; the embedded application stays in native resources. The optional `previousGood` state field records retention without changing trial rollback selection. Downloads and collection are serialized, and cleanup failures do not block startup or change launch state. Cleanup retries on a later cold start; it is not a disk quota for a process that stays alive indefinitely. Android also collects owned interrupted download files; iOS downloads use the system temporary directory.

## Verification

Shared signed ZIP/AES-GCM/delta fixtures run through Swift and Java. The bare device runner exercises actual Hermes bundles, cold launches, readiness, rollback, corrupt offers, bounded downloads and redirects. Android also exercises a real RN headless task. Results and platform/version limitations belong in the status document, rather than implying support from a declared peer-dependency range.

From the repository root, `node packages/react-native-plugin/scripts/verify-package.mjs /tmp/otakit-package-check` creates a new isolated application, packs both npm archives, checks their inventories and resolves native autolinking without workspace links. It uses local tarballs for the unpublished packages and may download other npm dependencies. Continue with `pod install` and Release builds in that generated application's native directories. Native/device acceptance has passed for RN 0.86.3 using this installation path; it does not establish RN 0.87 or Expo compatibility.
