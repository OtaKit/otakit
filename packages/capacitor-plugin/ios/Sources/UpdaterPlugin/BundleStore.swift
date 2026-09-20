import Foundation

final class BundleStore {
  /// Release identity is metadata; an installation must never reuse a live directory.
  static func newInstallationId() -> String { "bundle-\(UUID().uuidString.lowercased())" }

  private enum Keys {
    static let currentBundleId = "otakit_current_bundle_id"
    static let fallbackBundleId = "otakit_fallback_bundle_id"
    static let stagedBundleId = "otakit_staged_bundle_id"
    static let lastFailedBundleInfo = "otakit_last_failed_bundle_info"
    static let lastResolvedRuntimeKey = "otakit_last_resolved_runtime_key"
    static let overrideChannel = "otakit_override_channel"
  }

  private let defaults: UserDefaults
  private let rootDirectory: URL
  private let fileManager = FileManager.default
  var appRuntimeVersion: String?

  init(defaults: UserDefaults = .standard, rootDirectory: URL? = nil) {
    self.defaults = defaults
    self.rootDirectory = rootDirectory ?? FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    )[0]
  }

  private var decoder: JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }

  private var encoder: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }

  private(set) lazy var bundlesDirectory: URL = {
    let directory = rootDirectory.appendingPathComponent(
      "otakit_bundles",
      isDirectory: true
    )
    try? fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    return directory
  }()

  /// Content-addressed file cache for the deltas strategy (`otakit_files/<sha256>`).
  private(set) lazy var filesCacheDirectory: URL = {
    let directory = rootDirectory.appendingPathComponent(
      "otakit_files",
      isDirectory: true
    )
    try? fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    return directory
  }()

  var builtinVersion: String {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
  }

  var nativeBuild: String {
    Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
  }

  func builtinBundle() -> BundleInfo {
    BundleInfo(
      id: "builtin",
      version: builtinVersion,
      runtimeVersion: appRuntimeVersion,
      status: .builtin,
      downloadedAt: nil,
      sha256: nil,
      path: nil,
      channel: nil,
      releaseId: nil
    )
  }

  func bundleDirectory(for id: String) -> URL {
    bundlesDirectory.appendingPathComponent(id, isDirectory: true)
  }

  private func metadataURL(for id: String) -> URL {
    bundleDirectory(for: id).appendingPathComponent("bundle.json")
  }

  func bundlePath(id: String) -> String? {
    guard let info = getBundle(id: id) else {
      return nil
    }
    return info.path
  }

  func bundleExists(id: String) -> Bool {
    if id == "builtin" {
      return true
    }
    return getBundle(id: id) != nil
  }

  func saveBundle(_ bundle: BundleInfo) throws {
    guard !bundle.isBuiltin else {
      return
    }

    let directory = bundleDirectory(for: bundle.id)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    let data = try encoder.encode(bundle)
    try data.write(to: metadataURL(for: bundle.id), options: .atomic)
  }

  func getBundle(id: String) -> BundleInfo? {
    if id == "builtin" {
      return builtinBundle()
    }

    let metadata = metadataURL(for: id)
    guard let data = try? Data(contentsOf: metadata) else {
      return nil
    }
    return try? decoder.decode(BundleInfo.self, from: data)
  }

  func listDownloadedBundles() -> [BundleInfo] {
    guard
      let ids = try? fileManager.contentsOfDirectory(
        atPath: bundlesDirectory.path
      )
    else {
      return []
    }

    var bundles = ids.compactMap { getBundle(id: $0) }
    bundles.sort { lhs, rhs in
      switch (lhs.downloadedAt, rhs.downloadedAt) {
      case let (left?, right?):
        return left > right
      case (.some, .none):
        return true
      case (.none, .some):
        return false
      case (.none, .none):
        return lhs.id < rhs.id
      }
    }
    return bundles
  }

  private struct CoreState: Codable {
    var version = 1
    var currentId: String?
    var fallbackId: String?
    var stagedId: String?
    var lastFailed: BundleInfo?
  }

  private var stateURL: URL { rootDirectory.appendingPathComponent("otakit-state.json") }
  private let persistenceLock = NSRecursiveLock()

  private func readCoreState() throws -> CoreState {
    persistenceLock.lock()
    defer { persistenceLock.unlock() }
    if fileManager.fileExists(atPath: stateURL.path) {
      let state = try decoder.decode(CoreState.self, from: Data(contentsOf: stateURL))
      guard state.version == 1 else {
        throw CocoaError(.coderReadCorrupt)
      }
      return state
    }
    // Existing installations migrate on their first successful state write.
    let failed = defaults.data(forKey: Keys.lastFailedBundleInfo)
      .flatMap { try? decoder.decode(BundleInfo.self, from: $0) }
    return CoreState(
      currentId: defaults.string(forKey: Keys.currentBundleId),
      fallbackId: defaults.string(forKey: Keys.fallbackBundleId),
      stagedId: defaults.string(forKey: Keys.stagedBundleId),
      lastFailed: failed
    )
  }

  private func writeCoreState(_ state: CoreState) throws {
    try fileManager.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
    try encoder.encode(state).write(to: stateURL, options: .atomic)
  }

  private func mutateCoreState(_ mutation: (inout CoreState) -> Void) throws {
    persistenceLock.lock()
    defer { persistenceLock.unlock() }
    var state = try readCoreState()
    mutation(&state)
    try writeCoreState(state)
  }

  func setCoreState(
    currentId: String?, fallbackId: String?, stagedId: String?, lastFailed: BundleInfo?
  ) throws {
    persistenceLock.lock()
    defer { persistenceLock.unlock() }
    // Validate an existing state before replacing it; corruption must fail closed.
    _ = try readCoreState()
    try writeCoreState(CoreState(
      currentId: currentId, fallbackId: fallbackId, stagedId: stagedId, lastFailed: lastFailed
    ))
  }

  func protectedBundleIds() throws -> Set<String> {
    let state = try readCoreState()
    return Set([state.currentId, state.fallbackId, state.stagedId].compactMap { $0 })
  }

  func getCurrentBundle() -> BundleInfo {
    guard let id = getCurrentBundleId(), let bundle = getBundle(id: id) else {
      return builtinBundle()
    }
    return bundle
  }

  func getCurrentBundleId() -> String? { (try? readCoreState())?.currentId }

  func setCurrentBundleId(_ id: String?) throws {
    try mutateCoreState { $0.currentId = id }
  }

  func getFallbackBundle() -> BundleInfo {
    guard let id = getFallbackBundleId(), let bundle = getBundle(id: id) else {
      return builtinBundle()
    }
    return bundle
  }

  func getFallbackBundleId() -> String? { (try? readCoreState())?.fallbackId }

  func setFallbackBundleId(_ id: String?) throws {
    try mutateCoreState { $0.fallbackId = id }
  }

  func getStagedBundleId() -> String? { (try? readCoreState())?.stagedId }

  func setStagedBundleId(_ id: String?) throws {
    try mutateCoreState { $0.stagedId = id }
  }

  func setLastFailedBundle(_ bundle: BundleInfo?) throws {
    try mutateCoreState { $0.lastFailed = bundle }
  }

  func getLastFailedBundle() -> BundleInfo? { (try? readCoreState())?.lastFailed }

  func getOverrideChannel() -> String? {
    defaults.string(forKey: Keys.overrideChannel)
  }

  func setOverrideChannel(_ channel: String?) {
    if let channel {
      defaults.set(channel, forKey: Keys.overrideChannel)
    } else {
      defaults.removeObject(forKey: Keys.overrideChannel)
    }
  }

  func getLastResolvedRuntimeKey() -> String? {
    defaults.string(forKey: Keys.lastResolvedRuntimeKey)
  }

  func setLastResolvedRuntimeKey(_ runtimeKey: String?) {
    if let runtimeKey {
      defaults.set(runtimeKey, forKey: Keys.lastResolvedRuntimeKey)
    } else {
      // nil clears the key so the next cold start is treated as unresolved again
      defaults.removeObject(forKey: Keys.lastResolvedRuntimeKey)
    }
  }

  func markStatus(bundleId: String, status: BundleStatus) throws {
    guard var bundle = getBundle(id: bundleId) else {
      return
    }
    bundle = BundleInfo(
      id: bundle.id,
      version: bundle.version,
      runtimeVersion: bundle.runtimeVersion,
      status: status,
      downloadedAt: bundle.downloadedAt,
      sha256: bundle.sha256,
      path: bundle.path,
      channel: bundle.channel,
      releaseId: bundle.releaseId
    )
    try saveBundle(bundle)
  }

  func deleteBundle(id: String) throws {
    guard id != "builtin" else {
      return
    }

    try setCoreState(
      currentId: getCurrentBundleId() == id ? nil : getCurrentBundleId(),
      fallbackId: getFallbackBundleId() == id ? nil : getFallbackBundleId(),
      stagedId: getStagedBundleId() == id ? nil : getStagedBundleId(),
      lastFailed: getLastFailedBundle()
    )
    try fileManager.removeItem(at: bundleDirectory(for: id))
  }
}
