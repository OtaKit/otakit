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

The host configuration contains the embedded receipt, a native build ID, RN/Hermes versions, trusted public signing keys, optional bundle decryption keys, CDN URL and channel. Test fixtures generate this configuration locally. Use the embedded export's `embeddedReceipt` and `nativeBuildId`; the CLI's [package sealing step](../cli/src/lib/react-native/README.md) checks them against the actual built package. Complete resolved-input collection remains outstanding; copying a runtime string into configuration is not a supported substitute.

Wrap the existing Metro configuration with `withOtaKitMetro` from `@otakit/react-native-updater/metro`. This retains the existing initializer/resolver and installs the native instance bootstrap before the app entrypoint. The bootstrap establishes an immutable context for that JS instance.

For a separate Metro development host, pass `{ enabled: false }` as the second argument; this returns the original configuration, including Expo's original resolvers. Match this to the native host selection and avoid importing the updater API in that development entry. The default remains enabled. The private [Expo fixture](../../examples/expo-app/README.md) exercises Android's `whenPrepared`, `selectedBundleFile` and `attachHost` hooks while retaining Expo's factory; automatic Expo installation is still unfinished.

## Android APK build hook

The optional `scripts/android.gradle` hook owns export and Hermes compilation for explicitly selected, non-debuggable variants. Configure it **after** the application's `react { ... }` block in `android/app/build.gradle`:

```groovy
ext.otakitBuild = [
    variants: ['release'],
    projectRoot: file('../..'),
    nativeInputsFile: file('../../otakit-native-inputs.json'),
    cliFile: file('../../node_modules/@otakit/cli/dist/index.js'),
    embeddedVersion: 'embedded-42',
    // entry: 'index.js',
    // nodeCommand: ['node'],
]
apply from: new File(providers.exec {
    commandLine 'node', '-p', "require.resolve('@otakit/react-native-updater/scripts/android.gradle')"
}.standardOutput.asText.get().trim())
```

Supply the native inputs and recorded host settings described in the [CLI build workflow](../cli/src/lib/react-native/README.md). The hook requires the actual Android application ID and variant to match those inputs. It adds resolved external runtime artifacts, the Android boot classpath and its own script to file evidence, plus evaluated SDK, version, namespace, ABI, manifest-placeholder and BuildConfig settings. Project dependency sources still rely on the existing fingerprint/autolinking evidence; custom generators, compiler flags and the complete native toolchain need further acceptance. Custom RN bundle commands/config paths, packager arguments, Hermes commands/flags and alternate RN installations are rejected rather than silently ignored. Entry selection preserves `ENTRY_FILE`, the configured RN entry, and `index.android.js`/`index.js` fallback; an explicit `otakitBuild.entry` takes precedence.

Run the normal `:app:assembleRelease` (or the selected variant's assemble task). The generated-assets dependency runs verified export/staging before asset merging. The hook disables RN's separate bundling task only for selected variants, archives the completed single APK after packaging, and runs `seal-build` before assemble succeeds. Install tasks also depend on sealing. Task failure stops dependent packaging/sealing; no failure finalizer can certify an older APK. Remove manually copied OtaKit resources from that variant's ordinary asset sources when adopting the hook.

Each invocation writes a separate directory under `android/app/build/otakit/<variant>/<id>/`, containing resolved `native-inputs.json`, the archived export, generated assets, `application.apk`, and `completed-build.json`. Preserve that directory before `gradlew clean`; use its resolved inputs, completed receipt and `export/android-<runtime>` directory for later OTA exports. A new invocation collects and verifies again. Gradle up-to-date/build-cache reuse and configuration-cache support are deliberately unavailable until the complete native input closure has been accepted.

This hook handles one unfiltered APK output. Split APKs, AAB sealing, store signing acceptance and Expo native integration remain outstanding. Applying the hook does not enable RN app creation or send anything to a server.

## iOS Xcode build hook

Add this conditional at the start of the application's existing **Bundle React Native code and images** phase, after `set -e`. Keep the ordinary React Native script below it for builds outside this workflow:

```sh
if [ -n "$OTAKIT_BUILD_REQUEST" ] && [ "$TARGET_NAME" = "$OTAKIT_XCODE_TARGET" ]; then
  /bin/bash "$OTAKIT_XCODE_HOOK"
  exit $?
fi
```

Keep this phase after Copy Bundle Resources and before signing, and disable its **Based on dependency analysis** checkbox so every invocation stages fresh resources. The optional hook selects its installed script and Node executable through the CLI. It loads React Native's `.xcode.env`/`.xcode.env.local` environment and rejects unsupported bundler overrides or settings that differ from preflight. If those files select `ENTRY_FILE`, pass the same entry with `--entry`; the CLI's Node executable owns export even when a local file changes `NODE_BINARY`.

After `pod install`, run a non-Debug Hermes build using native inputs and recorded host settings from the [CLI workflow](../cli/src/lib/react-native/README.md):

```sh
otakit rn build-ios --project . --workspace ios/MyApp.xcworkspace \
  --scheme MyApp --configuration Release \
  --native-inputs otakit-native-inputs.json --version embedded-42 \
  --derived-data /private/tmp/my-app-derived-data \
  --output /private/tmp/my-app-build-42
```

Use `--sdk iphonesimulator --destination 'platform=iOS Simulator,id=<UDID>' --no-code-signing` for local simulator acceptance. Signing otherwise retains the project's configuration. `--app-target` disambiguates schemes containing multiple application targets. Entry selection uses `--entry`, Xcode/process `ENTRY_FILE`, then `index.ios.js` or `index.js`.

The CLI checks CocoaPods lock agreement, records generated pod configuration files, the project/workspace, installed hook/environment scripts, selected Hermes compiler and evaluated native build settings. It checks those inputs before build, during export and after packaging. Custom native generators and the full compiler/dependency closure still need acceptance. Keep the archive outside the project and DerivedData, and use a dedicated DerivedData directory without concurrent ordinary Xcode builds; wrapper invocations sharing it are locked.

The phase replaces only the configured OtaKit resource folder in the built `.app`. Existing unrelated files or links in that destination cause an error. The CLI waits for successful `xcodebuild` completion, then archives the finished `.app` and seals its bytes, host settings, baseline and app version fields. Failed builds and skipped/stale phases cannot produce a completed receipt. Every invocation requires a new archive directory; partial failures remain available for diagnosis. Use the returned `native-inputs.json`, `completed-build.json` and `export/ios-<runtime>` for subsequent OTA exports. `.xcarchive`/IPA orchestration, distribution signing and Expo native integration remain outstanding.

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
