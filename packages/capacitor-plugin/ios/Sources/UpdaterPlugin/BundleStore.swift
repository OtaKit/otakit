import Foundation

final class BundleStore {
  private enum Keys {
    static let currentBundleId = "otakit_current_bundle_id"
    static let fallbackBundleId = "otakit_fallback_bundle_id"
    static let stagedBundleId = "otakit_staged_bundle_id"
    static let failedBundleInfo = "otakit_failed_bundle_info"
    static let lastResolvedRuntimeKey = "otakit_last_resolved_runtime_key"
  }

  private let defaults = UserDefaults.standard
  private let fileManager = FileManager.default
  var appRuntimeVersion: String?

  private lazy var decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }()

  private lazy var encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()

  private(set) lazy var bundlesDirectory: URL = {
    let appSupport = fileManager.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first!
    let directory = appSupport.appendingPathComponent(
      "otakit_bundles",
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

  func getCurrentBundle() -> BundleInfo {
    guard
      let bundleId = defaults.string(forKey: Keys.currentBundleId),
      let bundle = getBundle(id: bundleId)
    else {
      return builtinBundle()
    }
    return bundle
  }

  func setCurrentBundleId(_ id: String?) {
    if let id {
      defaults.set(id, forKey: Keys.currentBundleId)
    } else {
      defaults.removeObject(forKey: Keys.currentBundleId)
    }
  }

  func getFallbackBundle() -> BundleInfo {
    guard
      let bundleId = defaults.string(forKey: Keys.fallbackBundleId),
      let bundle = getBundle(id: bundleId)
    else {
      return builtinBundle()
    }
    return bundle
  }

  func setFallbackBundleId(_ id: String?) {
    if let id {
      defaults.set(id, forKey: Keys.fallbackBundleId)
    } else {
      defaults.removeObject(forKey: Keys.fallbackBundleId)
    }
  }

  func getStagedBundleId() -> String? {
    defaults.string(forKey: Keys.stagedBundleId)
  }

  func setStagedBundleId(_ id: String?) {
    if let id {
      defaults.set(id, forKey: Keys.stagedBundleId)
    } else {
      defaults.removeObject(forKey: Keys.stagedBundleId)
    }
  }

  func setFailedBundle(_ bundle: BundleInfo?) {
    if let bundle {
      if let data = try? encoder.encode(bundle) {
        defaults.set(data, forKey: Keys.failedBundleInfo)
      }
    } else {
      defaults.removeObject(forKey: Keys.failedBundleInfo)
    }
  }

  func getFailedBundle() -> BundleInfo? {
    guard let data = defaults.data(forKey: Keys.failedBundleInfo) else {
      return nil
    }
    return try? decoder.decode(BundleInfo.self, from: data)
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

  func markStatus(bundleId: String, status: BundleStatus) {
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
    try? saveBundle(bundle)
  }

  func deleteBundle(id: String) throws {
    guard id != "builtin" else {
      return
    }

    try fileManager.removeItem(at: bundleDirectory(for: id))

    if getStagedBundleId() == id {
      setStagedBundleId(nil)
    }
    if defaults.string(forKey: Keys.currentBundleId) == id {
      setCurrentBundleId(nil)
    }
    if defaults.string(forKey: Keys.fallbackBundleId) == id {
      setFallbackBundleId(nil)
    }
  }

}
