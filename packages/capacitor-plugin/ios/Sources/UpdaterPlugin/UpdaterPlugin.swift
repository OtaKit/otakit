import Capacitor
import CryptoKit
import Foundation

@objc(UpdaterPlugin)
public class UpdaterPlugin: CAPPlugin, CAPBridgedPlugin {
  private enum UpdateMode: String {
    case manual
    case nextLaunch = "next-launch"
    case nextResume = "next-resume"
    case immediate
  }

  private enum Trigger {
    case launch
    case resume
  }

  public let identifier = "UpdaterPlugin"
  public let jsName = "OtaKit"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "notifyAppReady", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "getLastFailure", returnType: CAPPluginReturnPromise),
  ]

  private let store = BundleStore()
  private var downloader = Downloader()
  private let zipUtils = ZipUtils()
  private let fileManager = FileManager.default

  private var appReadyTimeoutMs = 10_000
  private var allowInsecureUrls = false
  private var updateMode: UpdateMode = .nextLaunch
  private var ingestUrl = UpdaterPlugin.defaultIngestURL
  private var cdnUrl = UpdaterPlugin.defaultCdnURL
  private var appId: String?
  private var channel: String?
  private var runtimeVersion: String?
  private var immediateUpdateOnRuntimeChange = false
  private var manifestKeys: [(kid: String, key: Data)] = []
  private var trialTimeoutWorkItem: DispatchWorkItem?
  private var checkIntervalMs: Int = 600_000
  private let isCheckInProgress = NSLock()
  private var checkInProgress = false
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
    let updateModeRaw = getConfig().getString("updateMode", UpdateMode.nextLaunch.rawValue)
    updateMode = resolveUpdateMode(configured: updateModeRaw)
    immediateUpdateOnRuntimeChange = getConfig().getBoolean("immediateUpdateOnRuntimeChange", false)
    downloader = Downloader(allowInsecureUrls: allowInsecureUrls)
    appReadyTimeoutMs = max(1000, getConfig().getInt("appReadyTimeout", 10_000))
    checkIntervalMs = max(600_000, getConfig().getInt("checkInterval", 600_000))

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

    var current = store.getCurrentBundle()
    if current.status == .trial {
      rollbackCurrentBundle(reason: "app_restarted_before_notify")
      current = store.getCurrentBundle()
    }

    let forceImmediateRuntimeChangeLaunch = shouldForceImmediateRuntimeChangeLaunch()

    if !forceImmediateRuntimeChangeLaunch && shouldActivateStagedOnLaunch() {
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
      runAutomaticUpdate(
        trigger: .launch,
        forceImmediateLaunch: forceImmediateRuntimeChangeLaunch
      )
    }

    if isAutomaticUpdateMode() {
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
    runAutomaticUpdate(trigger: .resume, forceImmediateLaunch: false)
  }

  private func runAutomaticUpdate(trigger: Trigger, forceImmediateLaunch: Bool) {
    // Resume-only guards
    if trigger == .resume {
      if updateMode == .manual { return }

      // next-resume and immediate: activate staged bundle on resume without server check
      if (updateMode == .nextResume || updateMode == .immediate),
         let stagedId = store.getStagedBundleId(),
         store.getBundle(id: stagedId) != nil {
        activateStagedBundleForReload()
        reloadWebView()
        return
      }

      if updateMode != .immediate && shouldThrottleCheck() { return }
    }

    if trigger == .launch &&
      !forceImmediateLaunch &&
      updateMode != .immediate &&
      shouldThrottleCheck()
    {
      return
    }

    // Acquire in-flight guard (submit-time)
    guard claimCheckInProgress() else { return }

    // Immediate mode on cold start: block until check+download+activate completes
    if (updateMode == .immediate && trigger == .launch) || forceImmediateLaunch {
      Task {
        defer { releaseCheckInProgress() }
        do {
          let result = try await performCheckAndDownload(channel: nil, emitEvents: true)
          if result != nil {
            if forceImmediateLaunch {
              recordCheckTimestamp()
            }
            activateStagedBundleForReload()
            reloadWebView()
          } else if forceImmediateLaunch {
            resolveCurrentRuntimeKey()
            recordCheckTimestamp()
          }
        } catch {
          if forceImmediateLaunch {
            print("[OtaKit] runtime-change startup update failed: \(error.localizedDescription)")
          } else {
            print("[OtaKit] immediate startup update failed: \(error.localizedDescription)")
          }
        }
      }
      return
    }

    // Immediate mode on resume: background check+download, activate when done
    if updateMode == .immediate && trigger == .resume {
      Task {
        defer { releaseCheckInProgress() }
        do {
          let result = try await performCheckAndDownload(channel: nil, emitEvents: true)
          if result != nil {
            activateStagedBundleForReload()
            reloadWebView()
          }
        } catch {
          print("[OtaKit] immediate resume update failed: \(error.localizedDescription)")
        }
      }
      return
    }

    // next-launch / next-resume: background check+download (fire-and-forget)
    Task {
      defer { releaseCheckInProgress() }
      do {
        _ = try await performCheckAndDownload(channel: nil, emitEvents: true)
        recordCheckTimestamp()
      } catch {
        // Check failed — timestamp not recorded, will retry on next trigger
      }
    }
  }

  private func shouldThrottleCheck() -> Bool {
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

  private func claimCheckInProgress() -> Bool {
    isCheckInProgress.lock()
    defer { isCheckInProgress.unlock() }
    if checkInProgress { return false }
    checkInProgress = true
    return true
  }

  private func releaseCheckInProgress() {
    isCheckInProgress.lock()
    defer { isCheckInProgress.unlock() }
    checkInProgress = false
  }

  private func shouldActivateStagedOnLaunch() -> Bool {
    updateMode != .manual
  }

  private func isAutomaticUpdateMode() -> Bool {
    updateMode != .manual
  }

  private func shouldForceImmediateRuntimeChangeLaunch() -> Bool {
    guard immediateUpdateOnRuntimeChange else {
      return false
    }
    if updateMode == .manual {
      print("[OtaKit] immediateUpdateOnRuntimeChange is ignored when updateMode is manual")
      return false
    }
    if updateMode == .immediate {
      print("[OtaKit] immediateUpdateOnRuntimeChange is ignored when updateMode is immediate")
      return false
    }
    return store.getLastResolvedRuntimeKey() != currentRuntimeKey()
  }

  private func currentRuntimeKey() -> String {
    runtimeVersion ?? UpdaterPlugin.defaultRuntimeKey
  }

  private func resolveCurrentRuntimeKey() {
    store.setLastResolvedRuntimeKey(currentRuntimeKey())
  }

  private func resolveUpdateMode(configured: String?) -> UpdateMode {
    let raw = configured?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    switch raw {
    case "", UpdateMode.nextLaunch.rawValue:
      return .nextLaunch
    case UpdateMode.manual.rawValue:
      return .manual
    case UpdateMode.nextResume.rawValue:
      return .nextResume
    case UpdateMode.immediate.rawValue:
      return .immediate
    default:
      print("[OtaKit] Unknown updateMode '\(raw)', defaulting to 'next-launch'")
      return .nextLaunch
    }
  }

  @objc func getState(_ call: CAPPluginCall) {
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

  @objc func check(_ call: CAPPluginCall) {
    if !claimCheckInProgress() {
      if let stagedId = store.getStagedBundleId(),
         let staged = store.getBundle(id: stagedId) {
        var payload: [String: Any] = [
          "version": staged.version,
          "url": "",
          "sha256": staged.sha256 ?? "",
          "size": 0,
          "downloaded": true,
        ]
        if let runtimeVersion = staged.runtimeVersion {
          payload["runtimeVersion"] = runtimeVersion
        }
        if let releaseId = staged.releaseId {
          payload["releaseId"] = releaseId
        }
        call.resolve(payload)
      } else {
        call.resolve()
      }
      return
    }
    let targetChannel = resolveTargetChannel(nil)
    Task {
      defer { releaseCheckInProgress() }
      do {
        let latest = try await fetchLatest(channel: targetChannel)
        if let latest {
          if isCurrentBundleLatest(latest: latest, targetChannel: targetChannel) {
            call.resolve()
            return
          }
          if shouldSuppressLatestManifest(latest: latest, targetChannel: targetChannel) {
            call.resolve()
            return
          }
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

  @objc func download(_ call: CAPPluginCall) {
    if !claimCheckInProgress() {
      if let stagedId = store.getStagedBundleId(),
         let staged = store.getBundle(id: stagedId) {
        call.resolve(staged.toDictionary())
      } else {
        call.resolve()
      }
      return
    }
    Task {
      defer { releaseCheckInProgress() }
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

      sendDeviceEvent(
        action: .applied,
        bundleVersion: current.version,
        runtimeVersion: current.runtimeVersion,
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

  @objc func getLastFailure(_ call: CAPPluginCall) {
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

  private func performCheckAndDownload(
    channel: String?,
    emitEvents: Bool
  ) async throws -> BundleInfo? {
    let targetChannel = resolveTargetChannel(channel)
    let latest = try await fetchLatest(channel: targetChannel)

    guard var manifest = latest else {
      if emitEvents {
        notifyListeners("noUpdateAvailable", data: [:])
      }
      return nil
    }

    guard isCompatibleRuntime(manifest.runtimeVersion) else {
      throw NSError(
        domain: "OtaKit",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Manifest runtimeVersion does not match the installed app runtime"]
      )
    }

    if isCurrentBundleLatest(latest: manifest, targetChannel: targetChannel) {
      if emitEvents {
        notifyListeners("noUpdateAvailable", data: [:])
      }
      return nil
    }

    if shouldSuppressLatestManifest(latest: manifest, targetChannel: targetChannel) {
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

    return try await downloadLatestManifest(manifest, targetChannel: targetChannel)
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

    notifyListeners("downloadStarted", data: ["version": version])
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
        runtimeVersion: runtimeVersion,
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
      sendDeviceEvent(
        action: .downloaded,
        bundleVersion: version,
        runtimeVersion: runtimeVersion,
        channel: channel,
        releaseId: releaseId
      )
      return info
    } catch {
      notifyListeners("downloadFailed", data: [
        "version": version,
        "error": error.localizedDescription,
      ])
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

  private func activateStagedBundleForLaunch() -> BundleInfo {
    guard let stagedId = store.getStagedBundleId() else {
      return store.getCurrentBundle()
    }
    guard let staged = store.getBundle(id: stagedId) else {
      store.setStagedBundleId(nil)
      return store.getCurrentBundle()
    }
    guard isCompatibleRuntime(staged) else {
      try? store.deleteBundle(id: staged.id)
      return store.getCurrentBundle()
    }

    resolveCurrentRuntimeKey()
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
    guard isCompatibleRuntime(staged) else {
      try? store.deleteBundle(id: staged.id)
      return
    }

    resolveCurrentRuntimeKey()
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
      runtimeVersion: current.runtimeVersion,
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

    sendDeviceEvent(
      action: .rollback,
      bundleVersion: current.version,
      runtimeVersion: current.runtimeVersion,
      channel: current.channel,
      releaseId: current.releaseId,
      detail: reason
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
    if let runtimeVersion = latest.runtimeVersion {
      payload["runtimeVersion"] = runtimeVersion
    }
    payload["releaseId"] = latest.releaseId
    return payload
  }

  private func isCurrentBundleLatest(
    latest: LatestManifest,
    targetChannel: String?
  ) -> Bool {
    doesBundleMatchLatest(store.getCurrentBundle(), latest: latest, targetChannel: targetChannel)
  }

  private func shouldSuppressLatestManifest(
    latest: LatestManifest,
    targetChannel: String?
  ) -> Bool {
    guard let failed = store.getFailedBundle() else {
      return false
    }
    return doesFailedBundleMatchLatest(failed, latest: latest, targetChannel: targetChannel)
  }

  private func doesFailedBundleMatchLatest(
    _ failed: BundleInfo,
    latest: LatestManifest,
    targetChannel: String?
  ) -> Bool {
    if trimToNil(failed.channel) != targetChannel {
      return false
    }

    if trimToNil(failed.runtimeVersion) != trimToNil(latest.runtimeVersion) {
      return false
    }

    if let failedReleaseId = failed.releaseId,
       latest.releaseId == failedReleaseId {
      return true
    }

    if !latest.sha256.isEmpty,
       let failedSha = failed.sha256,
       !failedSha.isEmpty,
       latest.sha256 == failedSha {
      return true
    }

    return false
  }

  private func doesBundleMatchLatest(
    _ bundle: BundleInfo,
    latest: LatestManifest,
    targetChannel: String?
  ) -> Bool {
    if trimToNil(bundle.channel) != targetChannel {
      return false
    }

    if trimToNil(bundle.runtimeVersion) != trimToNil(latest.runtimeVersion) {
      return false
    }

    if let bundleReleaseId = bundle.releaseId,
       latest.releaseId == bundleReleaseId {
      return true
    }

    if !latest.sha256.isEmpty,
       let bundleSha = bundle.sha256,
       !bundleSha.isEmpty,
       latest.sha256 == bundleSha {
      return true
    }

    return latest.version == bundle.version
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

    if trimToNil(staged.runtimeVersion) != trimToNil(latest.runtimeVersion) {
      return nil
    }

    return doesBundleMatchLatest(staged, latest: latest, targetChannel: targetChannel) ? staged : nil
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

    do {
      return try await downloadAndStage(
        url: url,
        version: manifest.version,
        expectedSha256: manifest.sha256,
        expectedSize: manifest.size,
        runtimeVersion: manifest.runtimeVersion,
        channel: targetChannel,
        releaseId: manifest.releaseId
      )
    } catch let error as NSError where isExpiredURLError(error) {
      guard let refreshed = try await fetchLatest(channel: targetChannel) else {
        throw error
      }
      guard let retryURL = URL(string: refreshed.url) else {
        throw error
      }
      return try await downloadAndStage(
        url: retryURL,
        version: refreshed.version,
        expectedSha256: refreshed.sha256,
        expectedSize: refreshed.size,
        runtimeVersion: refreshed.runtimeVersion,
        channel: targetChannel,
        releaseId: refreshed.releaseId
      )
    }
  }

  private func pruneIncompatibleBundles() {
    for bundle in store.listDownloadedBundles() where !isCompatibleRuntime(bundle) {
      try? store.deleteBundle(id: bundle.id)
    }

    if let failed = store.getFailedBundle(), !isCompatibleRuntime(failed) {
      store.setFailedBundle(nil)
    }
  }

  private func isCompatibleRuntime(_ runtimeVersion: String?) -> Bool {
    trimToNil(runtimeVersion) == self.runtimeVersion
  }

  private func isCompatibleRuntime(_ bundle: BundleInfo) -> Bool {
    isCompatibleRuntime(bundle.runtimeVersion)
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

  private func sendDeviceEvent(
    action: DeviceEventAction,
    bundleVersion: String? = nil,
    runtimeVersion: String? = nil,
    channel: String? = nil,
    releaseId: String? = nil,
    detail: String? = nil
  ) {
    guard let appId else {
      return
    }
    guard let bundleVersion = trimToNil(bundleVersion) else {
      print("[OtaKit] Skipping device event without bundleVersion")
      return
    }
    guard let releaseId = trimToNil(releaseId) else {
      print("[OtaKit] Skipping device event without releaseId")
      return
    }
    let nativeBuild = store.nativeBuild.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !nativeBuild.isEmpty else {
      print("[OtaKit] Skipping device event without nativeBuild")
      return
    }
    DeviceEventClient.send(
      ingestUrl: ingestUrl,
      appId: appId,
      platform: "ios",
      action: action,
      bundleVersion: bundleVersion,
      channel: channel,
      runtimeVersion: trimToNil(runtimeVersion),
      releaseId: releaseId,
      nativeBuild: nativeBuild,
      detail: detail
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
