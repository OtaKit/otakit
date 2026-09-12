# Expo compatibility fixture

This private fixture exercises Expo export and Android native host integration while preserving a Router/splash/DOM scaffold. Automatic config-plugin installation, iOS host integration and the full OTA device matrix remain unfinished. It is not a release integration example yet.

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
  /tmp/otakit-expo-acceptance
```

Preparation requires a new output directory outside the repository and creates local test keys there. The fixture Gradle script enables NIO desugaring and uses those staged resources in Release; it does not issue a completed-build receipt. Embedded DOM is also copied to Expo's normal `assets/www.bundle` location. The emulator test compares that APK copy against the export inventory, clears only `com.otakit.expofixture`, and checks two process launches for DOM readiness, original embedded Constants, baseline identity and increasing generations. It uses localhost port 9042 and removes its ADB reverse mapping afterward.

API 36 passed those checks. On the API 24 emulator the native host starts, but its bundled Android WebView 53.0.2785.124 fails the DOM page with `TypeError: e.getRootNode is not a function`; DOM readiness correctly fails. Expo DOM acceptance on that device requires a compatible WebView and a rerun. Bare RN's separate API 24 device scenarios pass. Signed Expo OTA reload and the full development/Router/splash matrix remain unverified.
