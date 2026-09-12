import Foundation
import OtaKitUpdaterCore
import UIKit

@objc(OtaKitRuntime)
public final class OtaKitRuntime: NSObject {
  @objc public static let shared = OtaKitRuntime()
  private var store: LaunchStore?
  private var transport: RNTransport?
  private var reload: (() -> Void)?
  private var timer: Timer?
  private var observers: [NSObjectProtocol] = []
  private var preparationStarted = false

  /// Call before creating RN roots. The completion preserves the application's factory/window/props.
  public func prepare(
    configuration: Data, embeddedBundle: URL, caseFoldingData: Data, foregroundUIIntent: Bool,
    reload: @escaping () -> Void, completion: @escaping (Error?) -> Void
  ) {
    precondition(Thread.isMainThread)
    guard !preparationStarted else {
      completion(
        NSError(
          domain: "OtaKit", code: 1,
          userInfo: [NSLocalizedDescriptionKey: "OtaKit host is already configured"]))
      return
    }
    preparationStarted = true
    self.reload = reload
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let config = try JSONDecoder().decode(RNTransport.Configuration.self, from: configuration)
        let receipt = config.embeddedReceipt
        let builtin = Artifact(
          appId: receipt.appId, platform: "ios", runtimeVersion: receipt.runtimeVersion,
          contentHash: receipt.embeddedContentHash, version: receipt.version,
          bundlePath: embeddedBundle.path, embedded: true)
        guard receipt.framework == "react-native" && receipt.platform == "ios" else {
          throw LaunchError.incompatibleArtifact
        }
        var root = try FileManager.default.url(
          for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        ).appendingPathComponent("OtaKitRN")
        try FileManager.default.createDirectory(
          at: root, withIntermediateDirectories: true,
          attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var storageValues = URLResourceValues()
        storageValues.isExcludedFromBackup = true
        try root.setResourceValues(storageValues)
        let installer = try ArtifactInstaller(caseFoldingData: caseFoldingData)
        let cache = ArtifactCache(
          root: root, builtin: builtin, installer: installer, keys: config.publicKeys,
          rnVersion: config.reactNativeVersion, bytecodeVersion: config.hermesBytecodeVersion)
        let engine = try LaunchStore(
          file: root.appendingPathComponent("launch.json"), buildId: config.nativeBuildId,
          builtin: builtin,
          validateCachedArtifact: { try cache.verify($0) })
        let transport = RNTransport(
          config: config, builtin: builtin, root: root, store: engine, installer: installer,
          cache: cache)
        // Collection runs on the transport actor, never on the startup completion path.
        Task { await transport.collectCache() }
        if let rawIngest = config.ingestURL, let ingest = URL(string: rawIngest),
          let delivery = try? EventDelivery(
            store: engine, base: ingest, appId: builtin.appId, platform: "ios",
            nativeBuild: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
              ?? "unknown",
            allowLocalhost: config.allowLocalhost == true)
        {
          Task.detached(priority: .utility) {
            while !Task.isCancelled {
              let delay = await delivery.flushOnce()
              if delay > 0 { try? await Task.sleep(nanoseconds: delay * 1_000_000_000) }
            }
          }
        }
        _ = try engine.beginLaunch(
          foreground: foregroundUIIntent, activateStaged: true,
          now: ProcessInfo.processInfo.systemUptime)
        DispatchQueue.main.async {
          self.store = engine
          self.transport = transport
          self.observers = [
            NotificationCenter.default.addObserver(
              forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { _ in engine.setForeground(true, now: ProcessInfo.processInfo.systemUptime) },
            NotificationCenter.default.addObserver(
              forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
            ) { _ in engine.setForeground(false, now: ProcessInfo.processInfo.systemUptime) },
          ]
          self.timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
            do {
              if try engine.checkTimeout(now: ProcessInfo.processInfo.systemUptime) {
                self.reload?()
              }
            } catch {
              // Do not select new code after a failed durable state write.
            }
          }
          completion(nil)
        }
      } catch { DispatchQueue.main.async { completion(error) } }
    }
  }

  @objc public func bundleURL() -> URL? {
    store.map { URL(fileURLWithPath: $0.state().current.bundlePath) }
  }
  @objc public func hostDidStart() {
    if let store = store { store.hostReady(generation: store.state().generation) }
  }
  @objc public func captureGeneration() -> String {
    store.map { String($0.state().generation) } ?? "unconfigured"
  }

  @objc public func bind(_ generation: String) throws -> String {
    let engine = try configuredStore()
    guard let value = UInt64(generation) else { throw LaunchError.staleInstance }
    try engine.bindBootstrap(generation: value)
    let artifact = engine.state().current
    var context: [String: Any] = [
      "generation": generation, "appId": artifact.appId, "platform": artifact.platform,
      "runtimeVersion": artifact.runtimeVersion, "contentHash": artifact.contentHash,
      "releaseId": artifact.releaseId as Any? ?? NSNull(),
      "channel": artifact.channel as Any? ?? NSNull(),
      "artifactRoot": NSNull(), "expoConfig": NSNull(), "expoDomRoot": NSNull(),
    ]
    if !artifact.embedded {
      let root = URL(fileURLWithPath: artifact.bundlePath).deletingLastPathComponent()
      context["artifactRoot"] = root.absoluteString.trimmingCharacters(
        in: CharacterSet(charactersIn: "/"))
      let configFile = root.appendingPathComponent("expo-config.json")
      if let data = try? Data(contentsOf: configFile) {
        context["expoConfig"] = try JSONSerialization.jsonObject(with: data)
      }
      let descriptor =
        try JSONSerialization.jsonObject(
          with: Data(contentsOf: root.appendingPathComponent("otakit-bundle.json")))
        as? [String: Any]
      context["expoDomRoot"] = (descriptor?["expo"] as? [String: Any])?["domRoot"] ?? NSNull()
    }
    return String(data: try JSONSerialization.data(withJSONObject: context), encoding: .utf8)!
  }
  @objc public func stateJSON() throws -> String {
    String(data: try JSONEncoder().encode(configuredStore().state()), encoding: .utf8)!
  }
  @objc public func notifyReady(_ generation: String) throws {
    guard let value = UInt64(generation) else { throw LaunchError.staleInstance }
    try configuredStore().notifyReady(from: value)
  }
  @objc public func setGuard(_ active: Bool, generation: String) {
    guard let value = UInt64(generation) else { return }
    store?.setActivationGuard(active, from: value)
  }
  @objc public func apply(_ generation: String) throws -> NSNumber {
    guard let value = UInt64(generation) else { throw LaunchError.staleInstance }
    let next = try configuredStore().apply(from: value, now: ProcessInfo.processInfo.systemUptime)
    if next != value {
      DispatchQueue.main.async { self.reload?() }
      return true
    }
    return false
  }
  @objc public func check(_ generation: String, completion: @escaping (String?, NSError?) -> Void) {
    guard let transport = transport, let value = UInt64(generation) else {
      completion(nil, NSError(domain: "OtaKit", code: 1))
      return
    }
    Task {
      do { completion(try await transport.check(generation: value), nil) } catch {
        completion(nil, error as NSError)
      }
    }
  }
  @objc public func download(
    _ generation: String, completion: @escaping (String?, NSError?) -> Void
  ) {
    guard let transport = transport, let value = UInt64(generation) else {
      completion(nil, NSError(domain: "OtaKit", code: 1))
      return
    }
    Task {
      do { completion(try await transport.download(generation: value), nil) } catch {
        completion(nil, error as NSError)
      }
    }
  }
  private func configuredStore() throws -> LaunchStore {
    guard let store = store else { throw LaunchError.storageUnavailable }
    return store
  }
}

private actor RNTransport {
  struct Receipt: Decodable {
    let appId: String
    let framework: String
    let platform: String
    let runtimeVersion: String
    let version: String
    let embeddedContentHash: String
  }
  struct Configuration: Decodable {
    let cdnURL: URL
    let channel: String?
    let nativeBuildId: String
    let reactNativeVersion: String
    let hermesBytecodeVersion: UInt32
    let embeddedReceipt: Receipt
    let publicKeys: [String: Data]
    let bundleKeys: [String: Data]
    let allowLocalhost: Bool?
    let ingestURL: String?
  }
  private let config: Configuration
  private let builtin: Artifact
  private let root: URL
  private let store: LaunchStore
  private let installer: ArtifactInstaller
  private let cache: ArtifactCache
  private var manifest: RNManifest?
  private var manifestJSON = "null"
  private var busy = false
  private var collectionPending = true
  init(
    config: Configuration, builtin: Artifact, root: URL, store: LaunchStore,
    installer: ArtifactInstaller, cache: ArtifactCache
  ) {
    self.config = config
    self.builtin = builtin
    self.root = root
    self.store = store
    self.installer = installer
    self.cache = cache
  }
  func check(generation: UInt64) async throws -> String {
    try store.assertInstance(generation)
    guard !busy else { throw LaunchError.activationDeferred }
    busy = true
    defer {
      busy = false
      collectCache()
    }
    let url = config.cdnURL.appendingPathComponent(
      "manifests/\(builtin.appId)/v3/ios/\(config.channel ?? "__base__")/\(builtin.runtimeVersion)/manifest.json"
    )
    let file = try await fetch(url, limit: 4 * 1024 * 1024)
    defer { try? FileManager.default.removeItem(at: file) }
    let data = try Data(contentsOf: file)
    try store.assertInstance(generation)
    manifest = try RNManifest.verify(
      data: data, builtin: builtin, channel: config.channel, keys: config.publicKeys,
      now: Int64(Date().timeIntervalSince1970))
    manifestJSON = String(data: data, encoding: .utf8)!
    return manifestJSON
  }
  func download(generation: UInt64) async throws -> String {
    try store.assertInstance(generation)
    guard !busy, let candidate = manifest else { throw LaunchError.activationDeferred }
    busy = true
    defer {
      busy = false
      collectCache()
    }
    guard candidate.signature.exp > Int64(Date().timeIntervalSince1970) else {
      throw LaunchError.incompatibleArtifact
    }
    guard !store.state().failed.contains(candidate.contentHash) else {
      throw LaunchError.quarantined
    }
    if candidate.contentHash == builtin.contentHash {
      guard candidate.version == builtin.version else { throw LaunchError.incompatibleArtifact }
      try store.stage(
        Artifact(
          appId: builtin.appId, platform: builtin.platform, runtimeVersion: builtin.runtimeVersion,
          contentHash: builtin.contentHash, version: candidate.version,
          releaseId: candidate.releaseId, channel: candidate.channel,
          bundlePath: builtin.bundlePath, embedded: true), from: generation)
      return manifestJSON
    }
    let directory = try cache.directory(candidate.contentHash)
    var completed = false
    defer {
      if !completed {
        try? store.recordDownloadFailure(
          Artifact(
            appId: builtin.appId, platform: builtin.platform,
            runtimeVersion: builtin.runtimeVersion, contentHash: candidate.contentHash,
            version: candidate.version,
            releaseId: candidate.releaseId, channel: candidate.channel,
            bundlePath: directory.appendingPathComponent("index.bundle").path),
          detail: "RN download or verification failed")
      }
    }
    var newStaging: URL?
    let inventory: [RNFileIdentity]
    defer { if let staging = newStaging { try? FileManager.default.removeItem(at: staging) } }
    if FileManager.default.fileExists(atPath: directory.path) {
      inventory = try cache.verifyDirectory(candidate)
    } else {
      let staging = root.appendingPathComponent("staging/\(UUID().uuidString)")
      newStaging = staging
      try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
      if candidate.strategy == "zip" {
        guard let raw = candidate.url, let url = URL(string: raw) else {
          throw LaunchError.incompatibleArtifact
        }
        let archive = try await fetch(url, limit: candidate.size)
        defer { try? FileManager.default.removeItem(at: archive) }
        inventory = try installer.installZip(
          archiveURL: archive, into: staging, manifest: candidate, bundleKeys: config.bundleKeys,
          rnVersion: config.reactNativeVersion, bytecodeVersion: config.hermesBytecodeVersion)
      } else {
        try installer.validateDeltaInventory(candidate)
        let files = candidate.files ?? []
        for file in files {
          guard file.size >= 0 && file.size <= 100 * 1024 * 1024, let url = URL(string: file.url)
          else { throw LaunchError.incompatibleArtifact }
          let downloaded = try await fetch(url, limit: file.size)
          defer { try? FileManager.default.removeItem(at: downloaded) }
          let destination = staging.appendingPathComponent(file.path)
          try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
          try FileManager.default.moveItem(at: downloaded, to: destination)
        }
        inventory = try installer.verifyDirectory(
          staging, manifest: candidate, rnVersion: config.reactNativeVersion,
          bytecodeVersion: config.hermesBytecodeVersion)
      }
    }
    try cache.commit(
      staging: newStaging, manifest: candidate, receipt: Data(manifestJSON.utf8), files: inventory)
    try store.stage(
      Artifact(
        appId: builtin.appId, platform: builtin.platform, runtimeVersion: builtin.runtimeVersion,
        contentHash: candidate.contentHash, version: candidate.version,
        releaseId: candidate.releaseId, channel: candidate.channel,
        bundlePath: directory.resolvingSymlinksInPath().appendingPathComponent("index.bundle").path),
      from: generation, downloaded: newStaging != nil)
    completed = true
    return manifestJSON
  }
  private func fetch(_ url: URL, limit: Int64) async throws -> URL {
    try await BoundedDownload.fetch(
      url, limit: limit, allowLocalhost: config.allowLocalhost == true)
  }

  func collectCache() {
    guard collectionPending && !busy else { return }
    collectionPending = false
    // Cleanup failure must not affect the selected code; retry on a later cold start.
    try? cache.collect(store.state())
  }
}
