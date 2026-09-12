# Expo compatibility fixture

This private fixture exercises Expo export and iOS/Android native host integration while preserving a Router/splash/DOM scaffold. The public config-plugin installer and the full OTA device matrix remain unfinished. It is not a release integration example yet.

The fixture includes Router, splash, Constants and a DOM component for that later acceptance. Bare React Native testing lives in `../react-native-app` and does not require native Expo dependencies.

The CLI has an adapter for Expo 57.0.17 / CLI 57.0.19's embed exporter. `export-entry.tsx` is the independent Expo/Constants/DOM export fixture. Its iOS and Android exports contain real Hermes bytecode, an authenticated config snapshot and the complete DOM output; native and DOM source maps stay private. The adapter validates native asset destinations before copying and supplements native source evidence skipped by upstream CNG/pnpm fingerprint rules.

Run `pnpm --filter @otakit/cli build`, then `RUN_EXPO_EXPORT_TESTS=1 pnpm --filter @otakit/cli test -- src/lib/react-native/expo-export.integration.test.ts`. This exercises the built CLI on both platforms, verifies the complete archive and checks rejection of the Router collision. It does not build or run an Expo native app.

The test temporarily creates `.env.production.local` and removes only its own file afterward. It refuses to replace an existing file. `app.config.cjs` and the JS entry read the same public fixture value so the test can detect stale environment inlining after a second export. It also checks production-mode validation, private-value exclusion, environment-file hashes and refusal to seal after those files change. Production export loads Expo's environment before native capture/config/bundling and resets Metro's transform cache; environment-file changes remain conservative native compatibility changes.

Router export is currently blocked by an upstream asset collision. Published Router 57.0.17 and 57.0.21 contain both `clear-icon.png` (64×64) and `clear-icon@1x.png` (16×16), with different bytes but the same Android destination. `close-icon` has the same ambiguity. The shared mapping verifier rejects the export before writing its payload. Resolving this dependency issue is required before Router/splash/device acceptance can finish.

## Android native acceptance

The local Expo module in `modules/otakit-host` retains `ExpoReactHostFactory` and the generated Application/Activity. Its release-only handlers attach OtaKit to the existing host, select the bundle on RN's background executor, and defer Expo's surface until storage preparation completes. Application Activity callbacks record real foreground transitions even while surface creation waits. Each process materializes and verifies the embedded APK payload before selection. This fixture copy routine is not the production installer.

Debug builds leave host selection and surface creation to Expo, and the Metro configuration enables the bootstrap/facades only for production exports. `native-entry.tsx` waits for a DOM-to-native readiness callback before notifying OtaKit and reporting identity/Constants to localhost. The independent entry avoids the Router collision; it does not establish Router acceptance. Reanimated 4.5.1 and Gesture Handler 2.32.0 are pinned to the installed Expo SDK's native dependency recommendations; unconstrained Router peers had selected incompatible versions.

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
