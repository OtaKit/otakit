# Expo compatibility fixture

This private fixture exercises Expo export and iOS/Android native host integration while preserving a Router/splash/DOM scaffold. The public config-plugin installer and the full OTA device matrix remain unfinished. It is not a release integration example yet.

The fixture includes Router, splash, Constants and a DOM component for that later acceptance. Bare React Native testing lives in `../react-native-app` and does not require native Expo dependencies.

The CLI has an adapter for Expo 57.0.17 / CLI 57.0.19's embed exporter. `export-entry.tsx` is the independent Expo/Constants/DOM export fixture. Its iOS and Android exports contain real Hermes bytecode, an authenticated config snapshot and the complete DOM output; native and DOM source maps stay private. The adapter validates native asset destinations before copying and supplements native source evidence skipped by upstream CNG/pnpm fingerprint rules.

Run `pnpm --filter @otakit/cli build`, then `RUN_EXPO_EXPORT_TESTS=1 pnpm --filter @otakit/cli test -- src/lib/react-native/expo-export.integration.test.ts`. This exercises the built CLI on both platforms, verifies the complete archive and checks the patched Router archive and icon densities. It does not build or run an Expo native app.

The test temporarily creates `.env.production.local` and removes only its own file afterward. It refuses to replace an existing file. `app.config.cjs` and the JS entry read the same public fixture value so the test can detect stale environment inlining after a second export. It also checks production-mode validation, private-value exclusion, environment-file hashes and refusal to seal after those files change. Production export loads Expo's environment before native capture/config/bundling and resets Metro's transform cache; environment-file changes remain conservative native compatibility changes.

The pinned Router dependency uses an explicit [asset patch](../../patches/README.md). Published Router 57.0.17 contains redundant unscaled `clear-icon.png` and `close-icon.png` files identical to their `@4x` variants, but conflicting with different `@1x` files. The patch removes only those two redundant files and retains all four density variants. The exporter still rejects ambiguous destinations. Both platform export tests verify complete archives and the expected icon dimensions. This workspace patch is not shipped by the CLI; other Expo projects still need compatible, unambiguous dependencies.

## Android native acceptance

The local Expo module in `modules/otakit-host` retains `ExpoReactHostFactory` and the generated Application/Activity. Its release-only handlers attach OtaKit to the existing host, select the bundle on RN's background executor, and defer Expo's surface until storage preparation completes. Application Activity callbacks record real foreground transitions even while surface creation waits. Each process materializes and verifies the embedded APK payload before selection. This fixture copy routine is not the production installer.

Debug builds leave host selection and surface creation to Expo, and the Metro configuration enables the bootstrap/facades only for production exports. `native-entry.tsx` waits for a DOM-to-native readiness callback before notifying OtaKit and reporting identity/Constants to localhost. The independent entry isolates host integration from Router. Pass `--router` to either preparation script to export the actual Router entry and run the shared acceptance component inside its home route. Reanimated 4.5.1 and Gesture Handler 2.32.0 are pinned to the installed Expo SDK's native dependency recommendations; unconstrained Router peers had selected incompatible versions.

After configuring JDK 21 and the Android SDK, run from the repository root:

```sh
pnpm --filter @otakit/cli build
NODE_ENV=production pnpm --filter @otakit/expo-fixture exec expo prebuild --platform android --no-install
node examples/expo-app/prepare-android.mjs /tmp/otakit-expo-acceptance
cd examples/expo-app/android
NODE_ENV=production ./gradlew :app:assembleRelease \
  -I ../android-fixture.gradle \
  -PotakitFixtureAssets=/tmp/otakit-expo-acceptance/assets \
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 \
  '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g'
cd ../../..
node examples/expo-app/run-android.mjs emulator-5554 \
  examples/expo-app/android/app/build/outputs/apk/release/app-release.apk \
  /tmp/otakit-expo-acceptance --updates
```

Preparation requires a new output directory outside the repository and creates local test keys there. The fixture Gradle script enables NIO desugaring and uses those staged resources in Release; it does not issue a completed-build receipt. Embedded DOM is also copied to Expo's normal `assets/www.bundle` location. The emulator test compares that APK copy against the export inventory, clears only `com.otakit.expofixture`, and checks two process launches for DOM readiness, original embedded Constants, baseline identity and increasing generations. It uses localhost port 9042 and removes its ADB reverse mapping afterward.

With `--updates`, the runner also serves the local signed fixtures created by `prepare-updates.mjs`. It verifies an AES-GCM encrypted update, cold restart into that update, rollback of an unconfirmed update, an uncaught JS error reaching the default fatal handler followed by cold-start recovery, and return to the embedded baseline without an archive request. Separate markers identify the native bundle, Expo config, DOM script and DOM HTML; staging must preserve the current instance's context. The fixture generator deliberately changes archived test payloads and signs them with its local key. It is not the CLI publication or native-build-receipt workflow. Omit `--updates` to run only the embedded startup checks.

API 36 passed startup and signed update checks. On the API 24 emulator the native host starts, but its bundled Android WebView 53.0.2785.124 fails the DOM page with `TypeError: e.getRootNode is not a function`; DOM readiness correctly fails. Expo DOM acceptance on that device requires a compatible WebView and a rerun. Bare RN's separate API 24 device scenarios pass. Deferred/cancelled startup and the full development/Router/splash matrix remain unverified.

## iOS native acceptance

The local module also supplies an Expo React delegate handler. It returns a deferred container while OtaKit prepares storage, then asks the existing Expo factory to create the real root with the original module name, initial props and launch options. Root customization still runs through Expo. A small delegate subclass forwards each RN host-start notification; the handler supplies the selected bundle URL dynamically on reload. Debug returns Expo's ordinary host/root behavior.

`with-ios-fixture.cjs` wires this private module into the generated Swift template and adds the core CocoaPod and resource phase. It is not the public Expo installer. `ios-fixture.sh` copies the verified payload and Expo's original `www.bundle` location, removing stale files from previous builds. Simulator builds do not issue completed-build receipts.

```sh
NODE_ENV=production pnpm --filter @otakit/expo-fixture exec expo prebuild --platform ios --no-install
(cd examples/expo-app/ios && NODE_ENV=production pod install)
node examples/expo-app/prepare-ios.mjs /tmp/otakit-expo-ios-acceptance
cd examples/expo-app/ios
NODE_ENV=production SKIP_BUNDLING=1 \
  OTAKIT_FIXTURE_ASSETS=/tmp/otakit-expo-ios-acceptance/assets \
  xcodebuild -workspace OtaKitExpoFixture.xcworkspace -scheme OtaKitExpoFixture \
  -configuration Release -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -derivedDataPath /tmp/otakit-expo-derived-data CODE_SIGNING_ALLOWED=NO -jobs 2 build
cd ../../..
node examples/expo-app/run-ios.mjs <UDID> \
  /tmp/otakit-expo-derived-data/Build/Products/Release-iphonesimulator/OtaKitExpoFixture.app \
  /tmp/otakit-expo-ios-acceptance --updates
```

The shared device runner checks every packaged payload file and the separate embedded DOM copy against the export inventory. iOS 26.5 passed embedded cold starts, AES-GCM OTA activation, confirmed OTA cold restart, timeout rollback, real fatal JS exception/process termination with cold-start recovery, and baseline restoration without an archive request. Sixteen reports covered generations 1–12. Native JS, config, DOM script and HTML identities were checked at each transition; the post-build native fingerprint matched its export. These checks use the independent native entry, not Router. iOS console logs, reports and a screenshot are retained beside the fixture artifacts.

## Router acceptance

Use `node examples/expo-app/prepare-android.mjs <new-directory> --router` (or `prepare-ios.mjs`) and build/run as above. The Router root prevents automatic splash hiding; its home route waits for DOM readiness, completes `hideAsync()`, and then confirms OtaKit readiness. Unconfirmed and fatal test variants still withhold readiness. Debug routes avoid importing the updater API.

The shared runner checks the Router path through the same update scenarios, then opens `otakit-expo-fixture://dom` through the native linking API. The DOM route must report matching config/DOM content and preserve the current launch context. DOM bridge callbacks can repeat after focus changes; every report must agree. Packaged payload and embedded DOM trees must exactly match the receipt, including absence of stale files.

Android API 36 and iOS 26.5 passed the Router encrypted update, cold restart, timeout rollback, fatal crash recovery, embedded restoration, splash API completion and warm/cold native deep-link scenarios on the retained Expo builds. Development-device acceptance remains outstanding. These Expo archives predate the latest atomic bootstrap capture and durable failure diagnostics; those changes have fresh bare RN device coverage, with Expo rebuild acceptance still pending.

For iOS Router runs, prepare the standalone UI helper using Ruby with CocoaPods' `xcodeproj` gem available. This creates a separate test project outside the repository and does not change the application's native identity:

```sh
ruby examples/expo-app/prepare-ui-tests.rb /tmp/otakit-expo-ui-tests
xcodebuild -project /tmp/otakit-expo-ui-tests/OtaKitFixtureUI.xcodeproj \
  -scheme OtaKitFixtureUI -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -derivedDataPath /tmp/otakit-expo-ui-tests/DerivedData \
  CODE_SIGNING_ALLOWED=NO -jobs 2 build-for-testing
```

Set `OTAKIT_IOS_UI_TEST_RUN` to the resulting `.xctestrun` file under `DerivedData/Build/Products` when running `run-ios.mjs`. The helper accepts only this fixture's URL confirmation and requires the prompt to close. iOS can remember prior confirmation and show no prompt; the runner still requires the linked screen's report. UI results, console logs, reports and failure screenshots are retained in the fixture output.

## Completed-build hook acceptance

The private native host now also exercises the shipped Gradle/Xcode hooks. Both hooks build fresh baseline exports, stage Expo's separate embedded DOM resources and verify their exact packaged inventories before issuing receipts. The sealer rejects missing, modified or stale DOM files. Android only accepts Expo's installed CLI and the matching RN Hermes compiler; custom bundler/compiler configurations remain rejected. iOS version records resolve the source Info.plist's literal values or ordinary build-setting references, instead of assuming `MARKETING_VERSION` controls a literal Expo plist. Existing version-1 receipts retain their earlier verification.

With a prepared fixture's keys and native inputs, run the Android hook:

```sh
cd examples/expo-app/android
NODE_ENV=production ./gradlew :app:assembleRelease -I ../android-build-fixture.gradle \
  -PotakitFixtureNativeInputs=/tmp/otakit-expo-acceptance/inputs.json \
  -PreactNativeArchitectures=arm64-v8a --max-workers=2 \
  '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g'
```

The hook prints its retained directory under `android/app/build/otakit/release`. To exercise the iOS hook from the repository root:

```sh
NODE_ENV=production node packages/cli/dist/index.js rn build-ios \
  --project examples/expo-app --workspace ios/OtaKitExpoFixture.xcworkspace \
  --scheme OtaKitExpoFixture --sdk iphonesimulator \
  --destination 'platform=iOS Simulator,id=<UDID>' \
  --derived-data /tmp/otakit-expo-derived-data \
  --native-inputs /tmp/otakit-expo-ios-acceptance/inputs.json \
  --version embedded --entry expo-router/entry \
  --output /tmp/otakit-expo-completed-ios --no-code-signing
```

Use a native project generated with the current private config plugin. It skips Expo's ordinary bundling phase only for an OtaKit build request and invokes the public staging hook. Ordinary builds keep their previous behavior. Do not set `SKIP_BUNDLING` for this wrapper.

`node examples/expo-app/prepare-completed.mjs <new-device-directory> <prepared-fixture-directory> <completed-build-directory>` derives local signed fault fixtures from the sealed baseline and matching test keys. Run the usual device runner against the archived `application.apk` or `.app`, passing that new directory and `--updates`. Both platforms passed these full Router scenarios with hook-built archives. These private fixtures still do not constitute a public Expo installer, store-signing or physical-device acceptance.
