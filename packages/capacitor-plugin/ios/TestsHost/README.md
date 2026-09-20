# Native test host

This app provides UIKit's application lifecycle and a window scene for the native
test suite. `DocumentReadyBridgeTests` uses a real WKWebView; running it in an
unhosted SwiftPM `xctest` process can leave the initial navigation unstarted.

The shared `UpdaterTests` scheme compiles the unchanged sources from
`../Tests/UpdaterPluginTests` and uses the plugin's local Swift package. The
Capacitor version comes from `../../Package.swift`, including CI's compatibility
pin. This host neither registers the plugin in an app nor starts OTA operations.

From the plugin directory:

```sh
xcodebuild test -project ios/TestsHost/UpdaterTests.xcodeproj \
  -scheme UpdaterTests -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
```

The Xcode project is checked in, so verification does not require XcodeGen.
The verification script fails if the target's compiled sources differ from the
shipped Swift tests, preventing new tests from being silently omitted.
When adding or removing test files, regenerate it with XcodeGen 2.45.4:

```sh
xcodegen generate --spec ios/TestsHost/project.yml
```

This directory is test infrastructure and is excluded from the published package.
