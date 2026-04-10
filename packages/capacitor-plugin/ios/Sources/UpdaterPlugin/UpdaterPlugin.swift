import Capacitor
import CryptoKit
import Foundation

@objc(UpdaterPlugin)
public class UpdaterPlugin: CAPPlugin, CAPBridgedPlugin {
  private enum UpdateMode: String {
    case manual
    case nextLaunch = "next-launch"
    case immediate
  }

  public let identifier = "UpdaterPlugin"
  public let jsName = "OtaKit"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugGetState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugCheck", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugDownload", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "notifyAppReady", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugReset", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugListBundles", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugDeleteBundle", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "debugGetLastFailure", returnType: CAPPluginReturnPromise),
  ]

  private let store = BundleStore()
  private var downloader = Downloader()
  private let zipUtils = ZipUtils()
  private let fileManager = FileManager.default

  private var appReadyTimeoutMs = 10_000
  private var allowInsecureUrls = false
  private var updateMode: UpdateMode = .nextLaunch
  private var updateUrl = UpdaterPlugin.defaultUpdateURL
  private var appId: String?
  private var channel: String?
  private var manifestKeys: [(kid: String, key: Data)] = []
  private var trialTimeoutWorkItem: DispatchWorkItem?
  private static let defaultUpdateURL = "https://www.otakit.app/api/v1"
  private static let apiPathSuffix = "/api/v1"

  public override func load() {
    let envUpdateUrl = ProcessInfo.processInfo.environment["OTAKIT_SERVER_URL"]
    updateUrl = resolveUpdateUrl(
      configured: getConfig().getString("serverUrl"),
      env: envUpdateUrl
    )
    appId = getConfig().getString("appId")
    channel = trimToNil(getConfig().getString("channel"))
    allowInsecureUrls = getConfig().getBoolean("allowInsecureUrls", false)
    let updateModeRaw = getConfig().getString("updateMode", UpdateMode.nextLaunch.rawValue)
    updateMode = resolveUpdateMode(configured: updateModeRaw)
    downloader = Downloader(allowInsecureUrls: allowInsecureUrls)
    appReadyTimeoutMs = max(1000, getConfig().getInt("appReadyTimeout", 10_000))

    let rawKeysValue = getConfig().getArray("manifestKeys")
    if let rawKeys = rawKeysValue as? [[String: String]] {
      manifestKeys = rawKeys.compactMap { entry in
        guard let kid = entry["kid"],
              let keyBase64 = entry["key"],
              let keyData = Data(base64Encoded: keyBase64) else { return nil }
        return (kid: kid, key: keyData)
      }
      if manifestKeys.isEmpty && !rawKeys.isEmpty {
        print("[UpdateKit] ERROR: manifestKeys configured but all entries are invalid. Manifest verification will reject all updates.")
        manifestKeys = [(kid: "_invalid_", key: Data())]
      }
    } else if rawKeysValue != nil {
      print("[UpdateKit] ERROR: manifestKeys has wrong format (expected array of {kid, key}). Manifest verification will reject all updates.")
      manifestKeys = [(kid: "_invalid_", key: Data())]
    }

    if manifestKeys.isEmpty && HostedManifestKeys.matchesManagedServer(updateUrl) {
      manifestKeys = HostedManifestKeys.defaults
    }

    var current = store.getCurrentBundle()
    if current.status == .trial {
      rollbackCurrentBundle(reason: "app_restarted_before_notify")
      current = store.getCurrentBundle()
    }

    if shouldActivateStagedOnLaunch() {
      current = activateStagedBundleForLaunch()
    }

    if !current.isBuiltin, let path = current.path {
      applyServerBasePath(path)
    } else {
      applyServerBasePath(nil)
    }

    if current.status == .pending {
      store.markStatus(bundleId: current.id, status: .trial)
      scheduleTrialTimeout(for: current.id)
    }

    if isAutomaticUpdateMode() {
      startAutoUpdate()
    }
  }

  private func startAutoUpdate() {
    switch updateMode {
    case .manual:
      return
    case .nextLaunch:
      Task {
        _ = try? await performCheckAndDownload(channel: nil, emitEvents: true)
      }
    case .immediate:
      Task {
        do {
          let downloaded = try await performCheckAndDownload(channel: nil, emitEvents: true)
          if downloaded != nil {
            activateStagedBundleForReload()
            reloadWebView()
          }
        } catch {
          print("[UpdateKit] immediate startup update failed: \(error.localizedDescription)")
        }
      }
    }
  }

  private func shouldActivateStagedOnLaunch() -> Bool {
    updateMode != .manual
  }

  private func isAutomaticUpdateMode() -> Bool {
    updateMode != .manual
  }

  private func resolveUpdateMode(configured: String?) -> UpdateMode {
    let raw = configured?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    switch raw {
    case "", UpdateMode.nextLaunch.rawValue:
      return .nextLaunch
    case UpdateMode.manual.rawValue:
      return .manual
    case UpdateMode.immediate.rawValue:
      return .immediate
    default:
      print("[UpdateKit] Unknown updateMode '\(raw)', defaulting to 'next-launch'")
      return .nextLaunch
    }
  }

  @objc func debugGetState(_ call: CAPPluginCall) {
    let current = store.getCurrentBundle()
    let staged: [String: Any]? = {
      guard let stagedId = store.getStagedBundleId() else {
        return nil
      }
      guard let staged = store.getBundle(id: stagedId) else {
        store.setStagedBundleId(nil)
        return nil
      }
      return staged.toDictionary()
    }()
    var payload: [String: Any] = [
      "current": current.toDictionary(),
      "fallback": store.getFallbackBundle().toDictionary(),
      "builtinVersion": store.builtinVersion,
    ]
    payload["staged"] = staged ?? NSNull()
    call.resolve(payload)
  }

  @objc func debugCheck(_ call: CAPPluginCall) {
    let requestedChannel = call.getString("channel")
    let targetChannel = resolveTargetChannel(requestedChannel)
    Task {
      do {
        let latest = try await fetchLatest(channel: targetChannel)
        if let latest {
          let staged = findMatchingStagedBundle(latest: latest, targetChannel: targetChannel)
          call.resolve(manifestToDictionary(latest, downloaded: staged != nil))
        } else {
          call.resolve()
        }
      } catch {
        call.reject("debugCheck failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func check(_ call: CAPPluginCall) {
    let targetChannel = resolveTargetChannel(nil)
    Task {
      do {
        let latest = try await fetchLatest(channel: targetChannel)
        if let latest {
          let staged = findMatchingStagedBundle(latest: latest, targetChannel: targetChannel)
          call.resolve(manifestToDictionary(latest, downloaded: staged != nil))
        } else {
          call.resolve()
        }
      } catch {
        call.reject("check failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func debugDownload(_ call: CAPPluginCall) {
    let requestedChannel = call.getString("channel")
    Task {
      do {
        let bundle = try await performCheckAndDownload(
          channel: requestedChannel,
          emitEvents: true
        )
        if let bundle {
          call.resolve(bundle.toDictionary())
        } else {
          call.resolve()
        }
      } catch {
        call.reject("debugDownload failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func download(_ call: CAPPluginCall) {
    Task {
      do {
        let bundle = try await performCheckAndDownload(channel: nil, emitEvents: true)
        if let bundle {
          call.resolve(bundle.toDictionary())
        } else {
          call.resolve()
        }
      } catch {
        call.reject("download failed: \(error.localizedDescription)")
      }
    }
  }

  @objc func apply(_ call: CAPPluginCall) {
    guard let stagedId = store.getStagedBundleId() else {
      call.reject("No staged update to apply")
      return
    }
    guard store.getBundle(id: stagedId) != nil else {
      store.setStagedBundleId(nil)
      call.reject("Staged bundle not found")
      return
    }

    activateStagedBundleForReload()
    call.resolve()
    reloadWebView()
  }

  @objc func notifyAppReady(_ call: CAPPluginCall) {
    let current = store.getCurrentBundle()
    guard !current.isBuiltin else {
      call.resolve()
      return
    }

    if current.status == .trial || current.status == .pending {
      let oldFallback = store.getFallbackBundle()

      store.markStatus(bundleId: current.id, status: .success)
      store.setFallbackBundleId(current.id)

      if let confirmed = store.getBundle(id: current.id) {
        notifyListeners("appReady", data: confirmed.toDictionary())
      } else {
        notifyListeners("appReady", data: current.toDictionary())
      }

      sendStats(
        action: .applied,
        bundleVersion: current.version,
        channel: current.channel,
        releaseId: current.releaseId
      )

      if !oldFallback.isBuiltin,
         oldFallback.id != current.id {
        try? store.deleteBundle(id: oldFallback.id)
      }
    }

    call.resolve()
  }

  @objc func debugReset(_ call: CAPPluginCall) {
    cancelTrialTimeout()
    store.setCurrentBundleId(nil)
    store.setStagedBundleId(nil)
    store.setFallbackBundleId(nil)
    store.setFailedBundle(nil)
    applyServerBasePath(nil)
    call.resolve()
    reloadWebView()
  }

  @objc func debugListBundles(_ call: CAPPluginCall) {
    let bundles = store.listDownloadedBundles().map { $0.toDictionary() }
    call.resolve(["bundles": bundles])
  }

  @objc func debugDeleteBundle(_ call: CAPPluginCall) {
    guard let bundleId = call.getString("bundleId") else {
      call.reject("Missing bundleId")
      return
    }
    guard store.bundleExists(id: bundleId) else {
      call.reject("Bundle not found")
      return
    }

    let current = store.getCurrentBundle()
    if current.id == bundleId {
      call.reject("Cannot delete current bundle")
      return
    }

    let fallback = store.getFallbackBundle()
    if fallback.id == bundleId {
      call.reject("Cannot delete fallback bundle")
      return
    }

    if store.getStagedBundleId() == bundleId {
      call.reject("Cannot delete staged bundle")
      return
    }

    do {
      try store.deleteBundle(id: bundleId)
      call.resolve()
    } catch {
      call.reject("Failed to delete bundle: \(error.localizedDescription)")
    }
  }

  @objc func debugGetLastFailure(_ call: CAPPluginCall) {
    guard let failed = store.getFailedBundle() else {
      call.resolve()
      return
    }
    call.resolve(failed.toDictionary())
  }

  private func fetchLatest(channel: String?) async throws -> LatestManifest? {
    guard let appId else {
      throw NSError(domain: "OtaKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing appId in plugin config"])
    }

    let current = store.getCurrentBundle()
    return try await ManifestClient.fetchLatest(
      updateUrl: updateUrl,
      appId: appId,
      channel: channel,
      currentVersion: current.version,
      currentReleaseId: current.releaseId,
      nativeBuild: store.nativeBuild,
      platform: "ios",
      allowInsecureUrls: allowInsecureUrls,
      manifestKeys: manifestKeys.map {
        ManifestKey(kid: $0.kid, derData: $0.key)
      }
    )
  }

  private func performCheckAndDownload(
    channel: String?,
    emitEvents: Bool
  ) async throws -> BundleInfo? {
    let targetChannel = resolveTargetChannel(channel)
    var latest = try await fetchLatest(channel: targetChannel)

    guard var manifest = latest else {
      if emitEvents {
        notifyListeners("noUpdateAvailable", data: [:])
      }
      return nil
    }

    let staged = findMatchingStagedBundle(latest: manifest, targetChannel: targetChannel)
    if emitEvents {
      notifyListeners("updateAvailable", data: manifestToDictionary(manifest, downloaded: staged != nil))
    }

    if let staged {
      return staged
    }

    guard var url = URL(string: manifest.url) else {
      throw NSError(
        domain: "OtaKit",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Invalid download URL from manifest"]
      )
    }

    do {
      return try await downloadAndStage(
        url: url,
        version: manifest.version,
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
        channel: targetChannel,
        releaseId: manifest.releaseId
      )
    } catch let error as NSError where isExpiredURLError(error) {
      // Download URL may have expired — re-fetch manifest once and retry
      latest = try await fetchLatest(channel: targetChannel)
      guard let refreshed = latest else {
        throw error
      }
      manifest = refreshed
      guard let retryUrl = URL(string: manifest.url) else {
        throw error
      }
      url = retryUrl
      return try await downloadAndStage(
        url: url,
        version: manifest.version,
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
        channel: targetChannel,
        releaseId: manifest.releaseId
      )
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
        sendStats(
          action: .downloadError,
          bundleVersion: version,
          channel: channel,
          releaseId: releaseId,
          errorMessage: "insufficient_disk_space"
        )
        throw error
      }
    }

    notifyListeners("downloadStarted", data: ["version": version])
    let zipURL = try await downloader.download(from: url)

    let extractDirectory = fileManager.temporaryDirectory
      .appendingPathComponent("updatekit-extract-\(UUID().uuidString)", isDirectory: true)
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

      let bundleId = buildBundleId(from: version)
      let destination = store.bundleDirectory(for: bundleId)

      if fileManager.fileExists(atPath: destination.path) {
        try fileManager.removeItem(at: destination)
      }

      if bundleRoot.path != destination.path {
        try fileManager.moveItem(at: bundleRoot, to: destination)
      }

      let info = BundleInfo(
        id: bundleId,
        version: version,
        status: .pending,
        downloadedAt: Date(),
        sha256: expectedSha256,
        path: destination.path,
        channel: channel,
        releaseId: releaseId
      )

      let previousStagedId = store.getStagedBundleId()
      try store.saveBundle(info)
      store.setStagedBundleId(bundleId)
      cleanupSupersededStagedBundle(previousStagedId: previousStagedId, replacementId: bundleId)

      notifyListeners("downloadComplete", data: info.toDictionary())
      sendStats(
        action: .downloaded,
        bundleVersion: version,
        channel: channel,
        releaseId: releaseId
      )
      return info
    } catch {
      notifyListeners("downloadFailed", data: [
        "version": version,
        "error": error.localizedDescription,
      ])
      sendStats(
        action: .downloadError,
        bundleVersion: version,
        channel: channel,
        releaseId: releaseId,
        errorMessage: error.localizedDescription
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

  private func activateStagedBundleForLaunch() -> BundleInfo {
    guard let stagedId = store.getStagedBundleId() else {
      return store.getCurrentBundle()
    }
    guard let staged = store.getBundle(id: stagedId) else {
      store.setStagedBundleId(nil)
      return store.getCurrentBundle()
    }

    store.setCurrentBundleId(staged.id)
    store.setStagedBundleId(nil)
    return staged
  }

  private func activateStagedBundleForReload() {
    guard let stagedId = store.getStagedBundleId() else {
      return
    }
    guard var staged = store.getBundle(id: stagedId) else {
      store.setStagedBundleId(nil)
      return
    }

    store.setCurrentBundleId(staged.id)
    store.setStagedBundleId(nil)

    if staged.status == .pending {
      store.markStatus(bundleId: staged.id, status: .trial)
      staged = store.getBundle(id: staged.id) ?? staged
      scheduleTrialTimeout(for: staged.id)
    } else if staged.status == .trial {
      scheduleTrialTimeout(for: staged.id)
    }

    if let path = staged.path {
      applyServerBasePath(path)
    } else {
      applyServerBasePath(nil)
    }
  }

  private func scheduleTrialTimeout(for bundleId: String) {
    cancelTrialTimeout()

    let workItem = DispatchWorkItem { [weak self] in
      guard let self else {
        return
      }
      let current = self.store.getCurrentBundle()
      guard current.id == bundleId else {
        return
      }
      if current.status == .trial {
        self.rollbackCurrentBundle(reason: "notify_timeout")
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

  private func rollbackCurrentBundle(reason: String) {
    cancelTrialTimeout()

    let current = store.getCurrentBundle()
    guard !current.isBuiltin else {
      return
    }

    let failed = BundleInfo(
      id: current.id,
      version: current.version,
      status: .error,
      downloadedAt: current.downloadedAt,
      sha256: current.sha256,
      path: current.path,
      channel: current.channel,
      releaseId: current.releaseId
    )
    store.markStatus(bundleId: current.id, status: .error)
    store.setFailedBundle(failed)
    store.setStagedBundleId(nil)

    sendStats(
      action: .rollback,
      bundleVersion: current.version,
      channel: current.channel,
      releaseId: current.releaseId,
      errorMessage: reason
    )

    let fallback = store.getFallbackBundle()
    if fallback.isBuiltin {
      store.setCurrentBundleId(nil)
      applyServerBasePath(nil)
      notifyListeners("rollback", data: [
        "from": failed.toDictionary(),
        "to": store.builtinBundle().toDictionary(),
        "reason": reason,
      ])
    } else if let fallbackPath = fallback.path {
      store.setCurrentBundleId(fallback.id)
      applyServerBasePath(fallbackPath)
      notifyListeners("rollback", data: [
        "from": failed.toDictionary(),
        "to": fallback.toDictionary(),
        "reason": reason,
      ])
    } else {
      store.setCurrentBundleId(nil)
      applyServerBasePath(nil)
      notifyListeners("rollback", data: [
        "from": failed.toDictionary(),
        "to": store.builtinBundle().toDictionary(),
        "reason": reason,
      ])
    }

    try? store.deleteBundle(id: current.id)

    reloadWebView()
  }

  private func cleanupSupersededStagedBundle(
    previousStagedId: String?,
    replacementId: String
  ) {
    guard let previousStagedId,
          previousStagedId != replacementId,
          previousStagedId != "builtin" else {
      return
    }

    let current = store.getCurrentBundle()
    if previousStagedId == current.id {
      return
    }

    let fallback = store.getFallbackBundle()
    if previousStagedId == fallback.id {
      return
    }

    try? store.deleteBundle(id: previousStagedId)
  }

  private func applyServerBasePath(_ path: String?) {
    DispatchQueue.main.async { [weak self] in
      if let path, !path.isEmpty {
        self?.bridge?.setServerBasePath(path)
      } else {
        let builtinPath = Bundle.main.resourceURL?
          .appendingPathComponent("public", isDirectory: true).path ?? ""
        self?.bridge?.setServerBasePath(builtinPath)
      }
    }
  }

  private func reloadWebView() {
    DispatchQueue.main.async { [weak self] in
      if self?.bridge?.webView == nil {
        print("[OtaKit] WARNING: WebView not available for reload")
      }
      self?.bridge?.webView?.reload()
    }
  }

  private func manifestToDictionary(
    _ latest: LatestManifest,
    downloaded: Bool = false
  ) -> [String: Any] {
    var payload: [String: Any] = [
      "version": latest.version,
      "url": latest.url,
      "sha256": latest.sha256,
      "size": latest.size,
      "downloaded": downloaded,
    ]
    if let releaseId = latest.releaseId {
      payload["releaseId"] = releaseId
    }
    if let minNativeBuild = latest.minNativeBuild {
      payload["minNativeBuild"] = minNativeBuild
    }
    return payload
  }

  private func findMatchingStagedBundle(
    latest: LatestManifest,
    targetChannel: String?
  ) -> BundleInfo? {
    guard let stagedId = store.getStagedBundleId() else {
      return nil
    }
    guard let staged = store.getBundle(id: stagedId) else {
      store.setStagedBundleId(nil)
      return nil
    }

    if trimToNil(staged.channel) != targetChannel {
      return nil
    }

    if let latestReleaseId = latest.releaseId,
       let stagedReleaseId = staged.releaseId,
       latestReleaseId == stagedReleaseId {
      return staged
    }

    if latest.version == staged.version,
       latest.sha256 == staged.sha256 {
      return staged
    }

    return nil
  }

  private func buildBundleId(from version: String) -> String {
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

    let digest = SHA256.hash(data: Data(trimmed.utf8))
    let suffix = digest.map { String(format: "%02x", $0) }.joined().prefix(12)
    return "\(normalized)-\(suffix)"
  }

  private func sendStats(
    action: StatsAction,
    bundleVersion: String? = nil,
    channel: String? = nil,
    releaseId: String? = nil,
    errorMessage: String? = nil
  ) {
    guard let appId else {
      return
    }
    StatsClient.send(
      updateUrl: updateUrl,
      appId: appId,
      platform: "ios",
      action: action,
      bundleVersion: bundleVersion,
      channel: channel,
      releaseId: releaseId,
      nativeBuild: store.nativeBuild,
      errorMessage: errorMessage
    )
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

  private func resolveUpdateUrl(configured: String?, env: String?) -> String {
    let configuredValue = configured?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let configuredValue, !configuredValue.isEmpty {
      return normalizeUpdateUrl(configuredValue)
    }

    let envValue = env?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let envValue, !envValue.isEmpty {
      return normalizeUpdateUrl(envValue)
    }

    return UpdaterPlugin.defaultUpdateURL
  }

  private func normalizeUpdateUrl(_ raw: String) -> String {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let withoutTrailingSlash = trimmed.replacingOccurrences(
      of: "/+$",
      with: "",
      options: .regularExpression
    )

    if withoutTrailingSlash.lowercased().hasSuffix(UpdaterPlugin.apiPathSuffix) {
      return withoutTrailingSlash
    }

    return withoutTrailingSlash + UpdaterPlugin.apiPathSuffix
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
