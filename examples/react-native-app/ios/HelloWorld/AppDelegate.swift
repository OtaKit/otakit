import OtaKitReactNativeUpdater
import React
import ReactAppDependencyProvider
import React_RCTAppDelegate
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    do {
      let resources = Bundle.main.bundleURL.appendingPathComponent("OtaKitFixture")
      let configuration = try Data(
        contentsOf: resources.appendingPathComponent("configuration.json"))
      let folding = try Data(contentsOf: resources.appendingPathComponent("case-folding.json"))
      OtaKitRuntime.shared.prepare(
        configuration: configuration,
        embeddedBundle: resources.appendingPathComponent("payload/index.bundle"),
        caseFoldingData: folding, foregroundUIIntent: application.applicationState != .background,
        reload: { RCTTriggerReloadCommandListeners("OtaKit fixture activation") }
      ) { error in
        if let error = error { fatalError("Fixture startup failed: \(error)") }
        self.startReactNative(launchOptions)
      }
    } catch { fatalError("Generate the local fixture resources before building: \(error)") }
    return true
  }

  private func startReactNative(_ launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    factory.startReactNative(
      withModuleName: "HelloWorld",
      in: window,
      initialProperties: ProcessInfo.processInfo.arguments.firstIndex(of: "--otakit-e2e").flatMap {
        index in
        ProcessInfo.processInfo.arguments.indices.contains(index + 1)
          ? ["otaTestScenario": ProcessInfo.processInfo.arguments[index + 1]] : nil
      },
      launchOptions: launchOptions
    )

  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    OtaKitRuntime.shared.bundleURL()
  }

  // RCTHostDelegate contains C++ declarations and is not imported into Swift.
  // RN 0.86 invokes this Objective-C selector synchronously after creating each host instance.
  @objc(hostDidStart:) func otaHostDidStart(_ host: NSObject) {
    OtaKitRuntime.shared.hostDidStart()
  }
}
