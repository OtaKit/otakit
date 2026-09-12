import Expo
import ExpoModulesCore
import OtaKitReactNativeUpdater
import React

/// Private device fixture. Expo still owns the factory, controller and root customization.
open class OtaKitExpoFixtureDelegate: ExpoReactNativeFactoryDelegate {
  @objc(hostDidStart:) public func otaHostDidStart(_ host: NSObject) {
    #if !DEBUG
      OtaKitRuntime.shared.hostDidStart()
    #endif
  }
}

public class OtaKitExpoFixtureHandler: ExpoReactDelegateHandler {
  public override func bundleURL(reactDelegate: ExpoReactDelegate) -> URL? {
    #if DEBUG
      return nil
    #else
      return OtaKitRuntime.shared.bundleURL()
    #endif
  }

  public override func createReactRootView(
    reactDelegate: ExpoReactDelegate,
    moduleName: String,
    initialProperties: [AnyHashable: Any]?,
    launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> UIView? {
    #if DEBUG
      return nil
    #else
      let container = UIView()
      let resources = Bundle.main.bundleURL.appendingPathComponent("OtaKitFixture")
      do {
        let configuration = try Data(
          contentsOf: resources.appendingPathComponent("configuration.json"))
        let folding = try Data(contentsOf: resources.appendingPathComponent("case-folding.json"))
        OtaKitRuntime.shared.prepare(
          configuration: configuration,
          embeddedBundle: resources.appendingPathComponent("payload/index.bundle"),
          caseFoldingData: folding,
          foregroundUIIntent: UIApplication.shared.applicationState != .background,
          reload: { RCTTriggerReloadCommandListeners("OtaKit Expo fixture activation") }
        ) { [weak container] error in
          if let error { fatalError("Expo fixture preparation failed: \(error)") }
          guard let container else { return }
          let root = reactDelegate.reactNativeFactory.recreateRootView(
            withBundleURL: OtaKitRuntime.shared.bundleURL(),
            moduleName: moduleName,
            initialProps: initialProperties,
            launchOptions: launchOptions
          )
          root.frame = container.bounds
          root.autoresizingMask = [.flexibleWidth, .flexibleHeight]
          container.addSubview(root)
        }
      } catch { fatalError("Generate the local Expo fixture resources before building: \(error)") }
      return container
    #endif
  }
}
