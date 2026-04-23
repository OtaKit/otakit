import Capacitor
import CryptoKit
import Foundation
import UIKit

@objc(UpdaterPlugin)
public class UpdaterPlugin: CAPPlugin, CAPBridgedPlugin {
  private enum Policy: String {
    case off
    case shadow
    case applyStaged = "apply-staged"
    case immediate
  }

  private enum CheckResolution {
    case noUpdate
    case alreadyStaged(latest: LatestManifest, bundle: BundleInfo)
    case updateAvailable(LatestManifest)
  }

  private enum DownloadResolution {
    case noUpdate
    case staged(BundleInfo)
  }

  public let identifier = "UpdaterPlugin"
  public let jsName = "OtaKit"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "notifyAppReady", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getLastFailure", returnType: CAPPluginReturnPromise),
  ]

  private let store = BundleStore()
  private lazy var coordinator = UpdaterCoordinator(store: store)
  private var downloader = Downloader()
  private let zipUtils = ZipUtils()
  private let fileManager = FileManager.default

  private var appReadyTimeoutMs = 10_000
  private var allowInsecureUrls = false
  private var launchPolicy: Policy = .applyStaged
  private var resumePolicy: Policy = .shadow
  private var runtimePolicy: Policy = .immediate
  private var ingestUrl = UpdaterPlugin.defaultIngestURL
  private var cdnUrl = UpdaterPlugin.defaultCdnURL
  private var appId: String?
  private var channel: String?
  private var runtimeVersion: String?
  private var manifestKeys: [(kid: String, key: Data)] = []
  private var trialTimeoutWorkItem: DispatchWorkItem?
  private var checkIntervalMs: Int = 600_000
  private var foregroundObserver: NSObjectProtocol?
  private static let defaultIngestURL = "https://ingest.otakit.app/v1"
  private static let defaultCdnURL = "https://cdn.otakit.app"
  private static let ingestPathSuffix = "/v1"
  private static let lastCheckTimestampKey = "otakit_last_check_timestamp"
  private static let defaultRuntimeKey = "__default__"

  public override func load() {
    let envIngestUrl = ProcessInfo.processInfo.environment["OTAKIT_INGEST_URL"]
    let envCdnUrl = ProcessInfo.processInfo.environment["OTAKIT_CDN_URL"]
    ingestUrl = resolveIngestUrl(
      configured: getConfig().getString("ingestUrl"),
      env: envIngestUrl
    )
    cdnUrl = resolveCdnUrl(
      configured: getConfig().getString("cdnUrl"),
      env: envCdnUrl
    )
    appId = getConfig().getString("appId")
    channel = trimToNil(getConfig().getString("channel"))
    runtimeVersion = trimToNil(getConfig().getString("runtimeVersion"))
    store.appRuntimeVersion = runtimeVersion
    allowInsecureUrls = getConfig().getBoolean("allowInsecureUrls", false)
    launchPolicy = resolvePolicy(configured: getConfig().getString("launchPolicy"), defaultPolicy: .applyStaged)
    resumePolicy = resolvePolicy(configured: getConfig().getString("resumePolicy"), defaultPolicy: .shadow)
    runtimePolicy = resolvePolicy(configured: getConfig().getString("runtimePolicy"), defaultPolicy: .immediate)
    downloader = Downloader(allowInsecureUrls: allowInsecureUrls)
    appReadyTimeoutMs = max(1000, getConfig().getInt("appReadyTimeout", 10_000))
    checkIntervalMs = getConfig().getInt("checkInterval", 600_000)

    let rawKeysValue = getConfig().getArray("manifestKeys")
    if let rawKeys = rawKeysValue as? [[String: String]] {
      manifestKeys = rawKeys.compactMap { entry in
        guard let kid = entry["kid"],
              let keyBase64 = entry["key"],
              let keyData = Data(base64Encoded: keyBase64) else { return nil }
        return (kid: kid, key: keyData)
      }
      if manifestKeys.isEmpty && !rawKeys.isEmpty {
        print("[OtaKit] ERROR: manifestKeys configured but all entries are invalid. Manifest verification will reject all updates.")
        manifestKeys = [(kid: "_invalid_", key: Data())]
      }
    } else if rawKeysValue != nil {
      print("[OtaKit] ERROR: manifestKeys has wrong format (expected array of {kid, key}). Manifest verification will reject all updates.")
      manifestKeys = [(kid: "_invalid_", key: Data())]
    }

    if manifestKeys.isEmpty && HostedManifestKeys.matchesManagedManifestURL(cdnUrl) {
      manifestKeys = HostedManifestKeys.defaults
    }

    pruneIncompatibleBundles()

    let startup = coordinator.normalizeStartupState(
      isBundleUsable: isBundleUsable
    )
    coordinator.cleanupBundles(startup.cleanupBundleIds)

    do {
      try applyServerBasePathSynchronously(startup.activationPath)
    } catch {
      print("[OtaKit] startup activation failed: \(error.localizedDescription)")
    }

    if let eventPayload = startup.eventPayload {
      sendDeviceEvent(eventPayload)
    }

    if let trialBundleId = startup.trialBundleId {
      scheduleTrialTimeout(for: trialBundleId)
    } else {
      cancelTrialTimeout()
    }

    dispatchColdStart()

    if resumePolicy != .off {
      foregroundObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.willEnterForegroundNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.handleAppWillEnterForeground()
      }
    }
  }

  deinit {
    if let observer = foregroundObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  private func handleAppWillEnterForeground() {
    handleResume()
  }

  private func shouldSkipCheckInterval() -> Bool {
    guard checkIntervalMs > 0 else { return false }
    let lastCheck = UserDefaults.standard.double(forKey: UpdaterPlugin.lastCheckTimestampKey)
    guard lastCheck > 0 else { return false }
    let elapsed = Date().timeIntervalSince1970 * 1000 - lastCheck
    return elapsed < Double(checkIntervalMs)
  }

  private func recordCheckTimestamp() {
    UserDefaults.standard.set(
      Date().timeIntervalSince1970 * 1000,
      forKey: UpdaterPlugin.lastCheckTimestampKey
    )
  }

  private func dispatchColdStart() {
    if isRuntimeUnresolved() {
      handleRuntime()
    } else {
      handleLaunch()
    }
  }

  private func handleRuntime() {
    switch runtimePolicy {
    case .off:
      resolveCurrentRuntimeKey()
    case .applyStaged:
      let hasStagedBundle = coordinator.snapshotState(
        isStagedBundleUsable: { [self] bundle in
          isCompatibleRuntime(bundle) && isBundleUsable(bundle)
        }
      ).staged != nil
      if hasStagedBundle {
        resolveCurrentRuntimeKey()
        do {
          if !(try applyStaged(reloadAfterApply: false)) {
            print("[OtaKit] Failed to apply a valid staged bundle during runtime handling")
          }
        } catch {
          print("[OtaKit] runtime apply-staged failed: \(error.localizedDescription)")
        }
        return
      }
      executeAutomaticUpdate(label: "runtime apply-staged fallback") { [self] in
        _ = try await downloadLatest(respectInterval: false, channel: nil)
        resolveCurrentRuntimeKey()
      }
    case .shadow:
      executeAutomaticUpdate(label: "runtime shadow") { [self] in
        _ = try await downloadLatest(respectInterval: false, channel: nil)
        resolveCurrentRuntimeKey()
      }
    case .immediate:
      executeAutomaticUpdate(label: "runtime immediate") { [self] in
        let result = try await downloadLatest(respectInterval: false, channel: nil)
        switch result {
        case .noUpdate:
          resolveCurrentRuntimeKey()
        case .staged:
          resolveCurrentRuntimeKey()
          try requireApplyStaged(reloadAfterApply: true)
        }
      }
    }
  }

  private func handleLaunch() {
    switch launchPolicy {
    case .off:
      return
    case .applyStaged:
      do {
        if try applyStaged(reloadAfterApply: false) {
          return
        }
      } catch {
        print("[OtaKit] launch apply-staged failed: \(error.localizedDescription)")
        return
      }
      executeAutomaticUpdate(label: "launch apply-staged fallback") { [self] in
        _ = try await downloadLatest(respectInterval: false, channel: nil)
      }
    case .shadow:
      executeAutomaticUpdate(label: "launch shadow") { [self] in
        _ = try await downloadLatest(respectInterval: false, channel: nil)
      }
    case .immediate:
      executeAutomaticUpdate(label: "launch immediate") { [self] in
        let result = try await downloadLatest(respectInterval: false, channel: nil)
        if case .staged = result {
          try requireApplyStaged(reloadAfterApply: true)
        }
      }
    }
  }

  private func handleResume() {
    switch resumePolicy {
    case .off:
      return
    case .applyStaged:
      executeAutomaticUpdate(label: "resume apply-staged") { [self] in
        if try applyStaged(reloadAfterApply: true) {
          return
        }
        _ = try await downloadLatest(respectInterval: true, channel: nil)
      }
    case .shadow:
      executeAutomaticUpdate(label: "resume shadow") { [self] in
        _ = try await downloadLatest(respectInterval: true, channel: nil)
      }
    case .immediate:
      executeAutomaticUpdate(label: "resume immediate") { [self] in
        let result = try await downloadLatest(respectInterval: false, channel: nil)
        if case .staged = result {
          try requireApplyStaged(reloadAfterApply: true)
        }
      }
    }
  }

  private func executeAutomaticUpdate(
    label: String,
    operation: @escaping () async throws -> Void
  ) {
    guard coordinator.tryBeginOperation() else {
      print("[OtaKit] Skipping \(label): update already in progress")
      return
    }

    Task {
      defer { coordinator.endOperation() }
      do {
        try await operation()
      } catch {
        print("[OtaKit] \(label) failed: \(error.localizedDescription)")
      }
    }
  }

  private func currentRuntimeKey() -> String {
    runtimeVersion ?? UpdaterPlugin.defaultRuntimeKey
  }

  private func isRuntimeUnresolved() -> Bool {
    coordinator.isRuntimeUnresolved(currentRuntimeKey: currentRuntimeKey())
  }

  private func resolveCurrentRuntimeKey() {
    coordinator.resolveRuntimeKey(currentRuntimeKey())
  }

  private func resolvePolicy(configured: String?, defaultPolicy: Policy) -> Policy {
    let raw = configured?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    switch raw {
    case "":
      return defaultPolicy
    case Policy.off.rawValue:
      return .off
    case Policy.shadow.rawValue:
      return .shadow
    case Policy.applyStaged.rawValue:
      return .applyStaged
    case Policy.immediate.rawValue:
      return .immediate
    default:
      print("[OtaKit] Unknown policy '\(raw)', defaulting to '\(defaultPolicy.rawValue)'")
      return defaultPolicy
    }
  }

  @objc func getState(_ call: CAPPluginCall) {
    let snapshot = coordinator.snapshotState(isStagedBundleUsable: isBundleUsable)
    var payload: [String: Any] = [
      "current": snapshot.current.toDictionary(),
      "fallback": snapshot.fallback.toDictionary(),
      "builtinVersion": snapshot.builtinVersion,
    ]
    payload["staged"] = snapshot.staged?.toDictionary() ?? NSNull()
    call.resolve(payload)
  }

  @objc func check(_ call: CAPPluginCall) {
    if !coordinator.tryBeginOperation() {
      call.reject("Another update operation is already in progress")
      return
    }

    Task {
      defer { coordinator.endOperation() }
      do {
        let result = try await checkLatest(respectInterval: false, channel: nil)
        call.resolve(checkResultDictionary(result))
      } catch {
        call.reject("check failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func download(_ call: CAPPluginCall) {
    if !coordinator.tryBeginOperation() {
      call.reject("Another update operation is already in progress")
      return
    }

    Task {
      defer { coordinator.endOperation() }
      do {
        let result = try await downloadLatest(respectInterval: false, channel: nil)
        call.resolve(downloadResultDictionary(result))
      } catch {
        call.reject("download failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func apply(_ call: CAPPluginCall) {
    guard coordinator.tryBeginOperation() else {
      call.reject("Another update operation is already in progress")
      return
    }
    defer { coordinator.endOperation() }

    do {
      guard try applyStaged(reloadAfterApply: true) else {
        call.reject("No valid staged update to apply")
        return
      }
    } catch {
      call.reject("apply failed: \(error.localizedDescription)")
      return
    }
  }

  @objc func update(_ call: CAPPluginCall) {
    guard coordinator.tryBeginOperation() else {
      call.reject("Another update operation is already in progress")
      return
    }

    Task {
      defer { coordinator.endOperation() }
      do {
        let result = try await downloadLatest(respectInterval: false, channel: nil)
        if case .staged = result {
          try requireApplyStaged(reloadAfterApply: true)
          return
        }
        call.resolve()
      } catch {
        call.reject("update failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func notifyAppReady(_ call: CAPPluginCall) {
    cancelTrialTimeout()
    let preparation = coordinator.prepareNotifyAppReady()
    coordinator.cleanupBundles(preparation.cleanupBundleIds)
    if let eventPayload = preparation.eventPayload {
      sendDeviceEvent(eventPayload)
    }

    call.resolve()
  }

  @objc func getLastFailure(_ call: CAPPluginCall) {
    guard let failed = coordinator.lastFailure() else {
      call.resolve()
      return
    }
    call.resolve(failed.toDictionary())
  }

  private func fetchLatest(channel: String?) async throws -> LatestManifest? {
    guard let appId else {
      throw NSError(domain: "OtaKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing appId in plugin config"])
    }

    return try await ManifestClient.fetchLatest(
      cdnUrl: cdnUrl,
      appId: appId,
      channel: channel,
      runtimeVersion: runtimeVersion,
      allowInsecureUrls: allowInsecureUrls,
      manifestKeys: manifestKeys.map {
        ManifestKey(kid: $0.kid, derData: $0.key)
      }
    )
  }

  private func checkLatest(
    respectInterval: Bool,
    channel: String?
  ) async throws -> CheckResolution {
    let targetChannel = resolveTargetChannel(channel)
    if respectInterval, shouldSkipCheckInterval() {
      print("[OtaKit] Skipping resume check: checkInterval has not elapsed")
      return .noUpdate
    }

    let latest = try await fetchLatest(channel: targetChannel)
    guard let manifest = latest else {
      if respectInterval {
        recordCheckTimestamp()
      }
      return .noUpdate
    }

    let resolution = try classifyLatestManifest(manifest, targetChannel: targetChannel)

    if respectInterval {
      recordCheckTimestamp()
    }
    return resolution
  }

  private func downloadLatest(
    respectInterval: Bool,
    channel: String?
  ) async throws -> DownloadResolution {
    let targetChannel = resolveTargetChannel(channel)
    let result = try await checkLatest(respectInterval: respectInterval, channel: channel)
    switch result {
    case .noUpdate:
      return .noUpdate
    case let .alreadyStaged(_, bundle):
      return .staged(bundle)
    case let .updateAvailable(manifest):
      do {
        let bundle = try await downloadLatestManifest(
          manifest,
          targetChannel: targetChannel
        )
        return .staged(bundle)
      } catch let error as NSError where isExpiredURLError(error) {
        guard let refreshed = try await fetchLatest(channel: targetChannel) else {
          return .noUpdate
        }

        switch try classifyLatestManifest(refreshed, targetChannel: targetChannel) {
        case .noUpdate:
          return .noUpdate
        case let .alreadyStaged(_, bundle):
          return .staged(bundle)
        case let .updateAvailable(retryManifest):
          let bundle = try await downloadLatestManifest(
            retryManifest,
            targetChannel: targetChannel
          )
          return .staged(bundle)
        }
      }
    }
  }

  private func classifyLatestManifest(
    _ manifest: LatestManifest,
    targetChannel: String?
  ) throws -> CheckResolution {
    guard isCompatibleRuntime(manifest.runtimeVersion) else {
      throw NSError(
        domain: "OtaKit",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Manifest runtimeVersion does not match the installed app runtime"]
      )
    }

    switch coordinator.classifyLatestManifest(
      manifest,
      targetChannel: targetChannel,
      isStagedBundleUsable: isBundleUsable
    ) {
    case .noUpdate:
      return .noUpdate
    case let .alreadyStaged(bundle):
      return .alreadyStaged(latest: manifest, bundle: bundle)
    case .updateAvailable:
      return .updateAvailable(manifest)
    }
  }

  private func checkResultDictionary(_ result: CheckResolution) -> [String: Any] {
    switch result {
    case .noUpdate:
      return ["kind": "no_update"]
    case let .alreadyStaged(latest, _):
      return [
        "kind": "already_staged",
        "latest": manifestToDictionary(latest),
      ]
    case let .updateAvailable(latest):
      return [
        "kind": "update_available",
        "latest": manifestToDictionary(latest),
      ]
    }
  }

  private func downloadResultDictionary(_ result: DownloadResolution) -> [String: Any] {
    switch result {
    case .noUpdate:
      return ["kind": "no_update"]
    case let .staged(bundle):
      return [
        "kind": "staged",
        "bundle": bundle.toDictionary(),
      ]
    }
  }

  private func isExpiredURLError(_ error: NSError) -> Bool {
    // HTTP 403 or 410 typically indicates an expired presigned URL
    if error.domain == "Downloader" && (error.code == 403 || error.code == 410) {
      return true
    }
    let desc = error.localizedDescription.lowercased()
    return desc.contains("403") || desc.contains("410")
  }

  private func downloadAndStage(
    url: URL,
    version: String,
    expectedSha256: String,
    expectedSize: Int? = nil,
    runtimeVersion: String? = nil,
    channel: String? = nil,
    releaseId: String? = nil
  ) async throws -> BundleInfo {
    // Check disk space before downloading
    if let size = expectedSize {
      let requiredSpace = Int64(Double(size) * 2.5) // zip + extracted + buffer
      let availableSpace = getFreeDiskSpace()
      if availableSpace < requiredSpace {
        let error = NSError(
          domain: "OtaKit",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Insufficient disk space"]
        )
        sendDeviceEvent(
          action: .downloadError,
          bundleVersion: version,
          runtimeVersion: runtimeVersion,
          channel: channel,
          releaseId: releaseId,
          detail: "insufficient_disk_space"
        )
        throw error
      }
    }

    let zipURL = try await downloader.download(from: url)

    let extractDirectory = fileManager.temporaryDirectory
      .appendingPathComponent("otakit-extract-\(UUID().uuidString)", isDirectory: true)
    defer {
      try? fileManager.removeItem(at: zipURL)
      try? fileManager.removeItem(at: extractDirectory)
    }

    do {
      let valid = try HashUtils.verify(
        fileURL: zipURL,
        expectedSha256: expectedSha256
      )
      guard valid else {
        throw NSError(
          domain: "OtaKit",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Downloaded bundle hash mismatch"]
        )
      }

      try zipUtils.extractSecurely(zipURL: zipURL, to: extractDirectory)
      let bundleRoot = try resolveBundleRoot(extractedDirectory: extractDirectory)

      let bundleId = buildBundleId(
        version: version,
        releaseId: releaseId,
        sha256: expectedSha256
      )
      let destination = coordinator.bundleDirectory(for: bundleId)

      if fileManager.fileExists(atPath: destination.path) {
        try fileManager.removeItem(at: destination)
      }

      if bundleRoot.path != destination.path {
        try fileManager.moveItem(at: bundleRoot, to: destination)
      }

      let info = BundleInfo(
        id: bundleId,
        version: version,
        runtimeVersion: runtimeVersion,
        status: .pending,
        downloadedAt: Date(),
        sha256: expectedSha256,
        path: destination.path,
        channel: channel,
        releaseId: releaseId
      )

      let cleanupBundleIds = try coordinator.stageDownloadedBundle(info)
      coordinator.cleanupBundles(cleanupBundleIds)

      sendDeviceEvent(
        action: .downloaded,
        bundleVersion: version,
        runtimeVersion: runtimeVersion,
        channel: channel,
        releaseId: releaseId
      )
      return info
    } catch {
      sendDeviceEvent(
        action: .downloadError,
        bundleVersion: version,
        runtimeVersion: runtimeVersion,
        channel: channel,
        releaseId: releaseId,
        detail: error.localizedDescription
      )
      throw error
    }
  }

  private func resolveBundleRoot(extractedDirectory: URL) throws -> URL {
    let indexAtRoot = extractedDirectory.appendingPathComponent("index.html")
    if fileManager.fileExists(atPath: indexAtRoot.path) {
      return extractedDirectory
    }

    let children = try fileManager.contentsOfDirectory(
      at: extractedDirectory,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    )
    if children.count == 1 {
      let child = children[0]
      let childIndex = child.appendingPathComponent("index.html")
      if fileManager.fileExists(atPath: childIndex.path) {
        return child
      }
    }

    throw NSError(
      domain: "OtaKit",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Bundle archive does not contain index.html"]
    )
  }

  @discardableResult
  private func applyStaged(reloadAfterApply: Bool) throws -> Bool {
    let preparation = coordinator.prepareApplyStaged(
      isCompatibleRuntime: isCompatibleRuntime,
      isBundleUsable: isBundleUsable
    )
    coordinator.cleanupBundles(preparation.cleanupBundleIds)

    guard let activationPath = preparation.activationPath else {
      return false
    }

    try applyServerBasePathSynchronously(activationPath)

    if reloadAfterApply {
      try reloadWebViewSynchronously()
    }

    cancelTrialTimeout()
    if let trialBundleId = preparation.trialBundleId {
      scheduleTrialTimeout(for: trialBundleId)
    }

    return true
  }

  private func requireApplyStaged(reloadAfterApply: Bool) throws {
    guard try applyStaged(reloadAfterApply: reloadAfterApply) else {
      throw NSError(
        domain: "OtaKit",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Expected a staged bundle to be ready for apply"]
      )
    }
  }

  private func scheduleTrialTimeout(for bundleId: String) {
    cancelTrialTimeout()

    let workItem = DispatchWorkItem { [weak self] in
      guard let self else {
        return
      }
      if self.coordinator.isCurrentTrialBundle(bundleId) {
        self.rollbackCurrentBundle(reason: "notify_timeout", shouldReload: true)
      }
    }
    trialTimeoutWorkItem = workItem

    DispatchQueue.main.asyncAfter(
      deadline: .now() + .milliseconds(appReadyTimeoutMs),
      execute: workItem
    )
  }

  private func cancelTrialTimeout() {
    trialTimeoutWorkItem?.cancel()
    trialTimeoutWorkItem = nil
  }

  private func rollbackCurrentBundle(reason: String, shouldReload: Bool) {
    cancelTrialTimeout()
    let preparation = coordinator.prepareRollback(
      reason: reason,
      isBundleUsable: isBundleUsable
    )
    guard preparation.didRollback else {
      return
    }

    coordinator.cleanupBundles(preparation.cleanupBundleIds)
    if let eventPayload = preparation.eventPayload {
      sendDeviceEvent(eventPayload)
    }

    do {
      try applyServerBasePathSynchronously(preparation.activationPath)
      if shouldReload {
        try reloadWebViewSynchronously()
      }
    } catch {
      print("[OtaKit] rollback activation failed: \(error.localizedDescription)")
    }
  }

  private func applyServerBasePathSynchronously(_ path: String?) throws {
    try runOnMainSynchronously { [weak self] in
      guard let self, let bridge = self.bridge else {
        throw NSError(
          domain: "OtaKit",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "Bridge not available for activation"]
        )
      }

      if let path, !path.isEmpty {
        bridge.setServerBasePath(path)
      } else {
        let builtinPath = Bundle.main.resourceURL?
          .appendingPathComponent("public", isDirectory: true).path ?? ""
        bridge.setServerBasePath(builtinPath)
      }
    }
  }

  private func reloadWebViewSynchronously() throws {
    try runOnMainSynchronously { [weak self] in
      guard let webView = self?.bridge?.webView else {
        throw NSError(
          domain: "OtaKit",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "WebView not available for reload"]
        )
      }
      webView.reload()
    }
  }

  private func runOnMainSynchronously(_ work: @escaping () throws -> Void) throws {
    if Thread.isMainThread {
      try work()
      return
    }

    let semaphore = DispatchSemaphore(value: 0)
    final class FailureBox {
      var error: Error?
    }
    let failure = FailureBox()

    DispatchQueue.main.async {
      defer { semaphore.signal() }
      do {
        try work()
      } catch {
        failure.error = error
      }
    }

    semaphore.wait()
    if let error = failure.error {
      throw error
    }
  }

  private func manifestToDictionary(
    _ latest: LatestManifest
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "version": latest.version,
      "url": latest.url,
      "sha256": latest.sha256,
      "size": latest.size,
    ]
    if let runtimeVersion = latest.runtimeVersion {
      payload["runtimeVersion"] = runtimeVersion
    }
    payload["releaseId"] = latest.releaseId
    return payload
  }

  private func downloadLatestManifest(
    _ manifest: LatestManifest,
    targetChannel: String?
  ) async throws -> BundleInfo {
    guard let url = URL(string: manifest.url) else {
      throw NSError(
        domain: "OtaKit",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid download URL from manifest"]
      )
    }

    return try await downloadAndStage(
      url: url,
      version: manifest.version,
      expectedSha256: manifest.sha256,
      expectedSize: manifest.size,
      runtimeVersion: manifest.runtimeVersion,
      channel: targetChannel,
      releaseId: manifest.releaseId
    )
  }

  private func pruneIncompatibleBundles() {
    let cleanupBundleIds = coordinator.pruneIncompatibleBundles(
      isCompatibleRuntime: isCompatibleRuntime
    )
    coordinator.cleanupBundles(cleanupBundleIds)
  }

  private func isCompatibleRuntime(_ runtimeVersion: String?) -> Bool {
    trimToNil(runtimeVersion) == self.runtimeVersion
  }

  private func isCompatibleRuntime(_ bundle: BundleInfo) -> Bool {
    isCompatibleRuntime(bundle.runtimeVersion)
  }

  private func buildBundleId(
    version: String,
    releaseId: String?,
    sha256: String?
  ) -> String {
    let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
    let allowed = CharacterSet(
      charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
    )

    var normalizedScalars = String.UnicodeScalarView()
    for scalar in trimmed.unicodeScalars {
      if allowed.contains(scalar) {
        normalizedScalars.append(scalar)
      } else {
        normalizedScalars.append("-")
      }
    }

    var normalized = String(normalizedScalars).replacingOccurrences(
      of: "-{2,}",
      with: "-",
      options: .regularExpression
    )
    normalized = normalized.trimmingCharacters(in: CharacterSet(charactersIn: "-."))

    if normalized.isEmpty {
      normalized = "bundle"
    }
    if normalized.count > 64 {
      normalized = String(normalized.prefix(64))
    }

    let identitySource = trimToNil(releaseId) ?? trimToNil(sha256) ?? trimmed
    let digest = SHA256.hash(data: Data(identitySource.utf8))
    let suffix = digest.map { String(format: "%02x", $0) }.joined().prefix(12)
    return "\(normalized)-\(suffix)"
  }

  private func sendDeviceEvent(
    action: DeviceEventAction,
    bundleVersion: String? = nil,
    runtimeVersion: String? = nil,
    channel: String? = nil,
    releaseId: String? = nil,
    detail: String? = nil
  ) {
    sendDeviceEvent(
      UpdaterCoordinator.DeviceEventPayload(
        action: action,
        bundleVersion: bundleVersion,
        runtimeVersion: runtimeVersion,
        channel: channel,
        releaseId: releaseId,
        detail: detail
      )
    )
  }

  private func sendDeviceEvent(_ payload: UpdaterCoordinator.DeviceEventPayload) {
    guard let appId else {
      return
    }
    guard let bundleVersion = trimToNil(payload.bundleVersion) else {
      print("[OtaKit] Skipping device event without bundleVersion")
      return
    }
    guard let releaseId = trimToNil(payload.releaseId) else {
      print("[OtaKit] Skipping device event without releaseId")
      return
    }
    let nativeBuild = coordinator.nativeBuild.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !nativeBuild.isEmpty else {
      print("[OtaKit] Skipping device event without nativeBuild")
      return
    }
    DeviceEventClient.send(
      ingestUrl: ingestUrl,
      appId: appId,
      platform: "ios",
      action: payload.action,
      bundleVersion: bundleVersion,
      channel: payload.channel,
      runtimeVersion: trimToNil(payload.runtimeVersion),
      releaseId: releaseId,
      nativeBuild: nativeBuild,
      detail: payload.detail
    )
  }

  private func isBundleUsable(_ bundle: BundleInfo) -> Bool {
    guard !bundle.isBuiltin else {
      return true
    }
    return isBundlePathUsable(bundle.path)
  }

  private func isBundlePathUsable(_ path: String?) -> Bool {
    guard let path = trimToNil(path) else {
      return false
    }

    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: path, isDirectory: &isDirectory),
          isDirectory.boolValue else {
      return false
    }

    let indexPath = URL(fileURLWithPath: path, isDirectory: true)
      .appendingPathComponent("index.html", isDirectory: false).path
    return fileManager.fileExists(atPath: indexPath)
  }

  private func resolveTargetChannel(_ channel: String?) -> String? {
    if let channel = trimToNil(channel) {
      return channel
    }
    return self.channel
  }

  private func trimToNil(_ value: String?) -> String? {
    guard let value else {
      return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func resolveIngestUrl(
    configured: String?,
    env: String?
  ) -> String {
    let configuredValue = configured?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let configuredValue, !configuredValue.isEmpty {
      return normalizeIngestUrl(configuredValue)
    }

    let envValue = env?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let envValue, !envValue.isEmpty {
      return normalizeIngestUrl(envValue)
    }

    return UpdaterPlugin.defaultIngestURL
  }

  private func resolveCdnUrl(
    configured: String?,
    env: String?
  ) -> String {
    let configuredValue = configured?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let configuredValue, !configuredValue.isEmpty {
      return normalizeCdnUrl(configuredValue)
    }

    let envValue = env?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let envValue, !envValue.isEmpty {
      return normalizeCdnUrl(envValue)
    }

    return UpdaterPlugin.defaultCdnURL
  }

  private func normalizeIngestUrl(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let withoutTrailingSlash = trimmed.replacingOccurrences(
      of: "/+$",
      with: "",
      options: .regularExpression
    )

    if withoutTrailingSlash.lowercased().hasSuffix(UpdaterPlugin.ingestPathSuffix) {
      return withoutTrailingSlash
    }

    return withoutTrailingSlash + UpdaterPlugin.ingestPathSuffix
  }

  private func normalizeCdnUrl(_ raw: String) -> String {
    raw
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
  }

  private func getFreeDiskSpace() -> Int64 {
    do {
      let attributes = try fileManager.attributesOfFileSystem(
        forPath: NSHomeDirectory()
      )
      if let freeSize = attributes[.systemFreeSize] as? Int64 {
        return freeSize
      }
    } catch {}
    return Int64.max // If we can't determine, allow download
  }
}
