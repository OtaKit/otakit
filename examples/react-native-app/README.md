# Bare React Native OTA fixture

This private RN 0.86.3 application exercises the OtaKit native updater with real Metro output and Hermes bytecode. It is based on the React Native community template; see `TemplateLICENSE`.

The fixture generates local signing/encryption keys and talks to `127.0.0.1:9042`. Generated payloads and keys are ignored by Git. It does not contact production. `prepare-simulator.mjs` creates test resources; completed package verification runs separately after the native build.

## Export and prepare

Install workspace dependencies first. iOS additionally needs Xcode and `pod install` in `ios`; its Podfile resolves both local OtaKit pods. Android needs Java 21, SDK 36, NDK 27.1.12297006 and a configured `ANDROID_HOME`/`android/local.properties`. The fixture enables Java NIO desugaring for Android API 24+.

Run from the repository root, using an empty local output directory:

```sh
pnpm --filter @otakit/cli build
RUN_RN_EXPORT_TESTS=1 RN_EXPORT_OUTPUT=/tmp/otakit-ios-export \
  pnpm --filter @otakit/cli test -- src/lib/react-native/export.integration.test.ts
node examples/react-native-app/prepare-simulator.mjs \
  /tmp/otakit-ios-export/ios-<runtime-from-export> /tmp/otakit-ios-fixtures
```

For Android, add `RN_EXPORT_PLATFORM=android`, use a separate output directory and pass its `android-<runtime>` child to the same preparation script. It selects the installed Hermes compiler for the target and writes resources to the appropriate native project. The export defaults to Release native inputs; use `RN_EXPORT_VARIANT=Debug` for a Debug-specific record. Prepare resources before building. Test manifests expire after one hour; regenerate and rebuild if needed.

## Build and run

For iOS, build the `HelloWorld` scheme in `ios/HelloWorld.xcworkspace` for an available simulator. The native entrypoint loads the verified fixture payload; it does not need Metro. For Release builds set `SKIP_BUNDLING=1`, since the export has already produced the embedded bytecode. Then run:

```sh
node examples/react-native-app/run-simulator.mjs \
  <booted-simulator-UUID> <derived-data>/Build/Products/Debug-iphonesimulator/HelloWorld.app \
  /tmp/otakit-ios-fixtures
```

For Android, run `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` in `android`, then:

```sh
ANDROID_HOME=<sdk-path> node examples/react-native-app/run-simulator.mjs \
  emulator-5554 examples/react-native-app/android/app/build/outputs/apk/release/app-release.apk \
  /tmp/otakit-android-fixtures
```

The Android fixture skips Gradle's JS bundling in both Debug and Release because preparation supplies the embedded payload. This fixture setting is not a production build hook.

The runner replaces only the `com.otakit.rnfixture` application on the selected device. On Android it forwards port 9042 using `adb reverse`. It cold-launches the app between scenarios and asserts encrypted ZIP activation/readiness, delta activation, foreground timeout rollback/quarantine, offline cache reuse, tampered-signature rejection, oversized chunked-download rejection, redirect rejection and process-death rollback exactly once. Android additionally starts a real RN headless task and checks that activation remains deferred until a fresh foreground process. Results are written to `simulator-results.json` in the fixture directory, including reports collected before a failure. Run one device at a time because the localhost server shares port 9042.

The runner also checks previous-good retention. On iOS it inspects the simulator's app container after cold recovery and waits for asynchronous cleanup to leave only current/previous-good artifacts and their receipts. To enable the same file inspection on an Android emulator, first enable `adb -s <emulator-id> root` on a local image that supports it, then run with `OTAKIT_TEST_CACHE_FILES=1`. Root access is only for the test runner's private-file inspection; the updater itself does not need it.

The runner also switches to this binary's embedded baseline and checks that readiness produces exactly one success without requesting its ZIP. A second verified publication of those same bytes updates association while preserving the original JS instance context and event history.

For telemetry acceptance, set `OTAKIT_TEST_EVENTS=1` when running both `prepare-simulator.mjs` and `run-simulator.mjs`, and rebuild after preparing resources. This enables the localhost ingest worker. The runner returns 503 while testing launches, then accepts events while deliberately losing the first acceptance response. It verifies identical retry IDs/bodies, attribution, no extra downloads for cached or embedded code, server deduplication and an empty durable outbox after restart. Accepted envelopes are saved to `event-results.json`. This uses a local HTTP stand-in, not live ingest or billing.

The visible buttons also allow manual checks. App readiness is explicit; the bad test variant deliberately withholds it. The RN hosts preserve the fixture's initial props across OTA reloads.

## Acceptance limits

The opt-in completed-build integration verifies the actual built package, then exports an OTA variant and checks that its private baseline archive and receipt still identify the embedded application:

```sh
pnpm --filter @otakit/cli build
RUN_RN_BUILD_TESTS=1 RN_BASELINE_EXPORT="$OTAKIT_BASELINE_DIR" \
  RN_NATIVE_BINARY="$OTAKIT_NATIVE_BINARY" RN_AAPT2="$OTAKIT_AAPT2" \
  pnpm --filter @otakit/cli test -- src/lib/react-native/completed-build.integration.test.ts
```

Set the paths to the platform/runtime export directory and matching Release APK or iOS `.app`. `RN_AAPT2` is needed only for Android. `RN_BUILD_TEST_OUTPUT` optionally retains the completed receipt and OTA output. This acceptance test also runs the built CLI executable, so rebuild it first. The CLI [build workflow](../../packages/cli/src/lib/react-native/README.md) documents `rn export-embedded`, `rn seal-build` and `rn export` without the test harness.

See [implementation status](../../research/react-native-ota/implementation-status.md) for results actually obtained, including API 24 and API 36 Android emulator runs. Package verification does not prove automatic native build hooks, complete resolved-input capture, signing, Expo integration, npm package installation, physical-device behavior, telemetry, or delivery through production storage/CDN. Keep RN app creation gated until those acceptance requirements pass.
