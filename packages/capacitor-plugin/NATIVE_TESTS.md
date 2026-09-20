Native update tests compile the actual plugin sources on both platforms. Android coordinator tests use Robolectric with real temporary files and Android preferences; iOS tests run in the simulator with isolated storage and UserDefaults suites.

From the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @otakit/capacitor-updater verify:android
pnpm --filter @otakit/capacitor-updater verify:ios
```

Android requires Java 21, Android platform 36 and build-tools 36.0.0, with `ANDROID_HOME` pointing to the SDK. The standalone test project reuses the repository's Gradle wrapper and resolves Capacitor through the plugin's installed package; it does not depend on generated demo-app projects or an emulator. Robolectric executes coordinator tests against Android API 34.

iOS requires Xcode and an installed iPhone simulator runtime. The script selects an available iPhone simulator and runs the Swift package's `OtakitCapacitorUpdater` scheme. Build and test results are under `packages/capacitor-plugin/.build/verification`.

`.github/workflows/native.yml` runs both commands for pull requests and main. Add failure-path regressions alongside each state-management fix. Passing coordinator tests does not replace full WebView and background/foreground tests for bridge or lifecycle changes.
