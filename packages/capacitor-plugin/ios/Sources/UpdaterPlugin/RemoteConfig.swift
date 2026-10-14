import Foundation

/// A verified remote config file (plugin 3.4+): one channel's values, or a
/// signed deletion of them. Mirrors console/lib/config-files.ts.
struct RemoteConfigFile: Codable, Equatable {
  let appId: String
  /// Channel of the file; nil for the base channel.
  let channel: String?
  /// Increases with every change; an older version is never accepted again.
  let version: Int
  /// The channel's config was deleted: devices on it use the base config.
  let deleted: Bool
  /// Exactly the signed text: a JSON object.
  let valuesJson: String
  /// Exactly the signed text: a JSON array, or nil without experiments.
  let experimentsJson: String?
  let updatedAt: String?
}

enum RemoteConfigError: Error, Equatable {
  case invalidResponse
  case tooLarge
  case wrongApp
  case wrongChannel
  case invalidVersion
  case invalidValues
  case invalidExperiments
  case missingSignature
  case httpStatus(Int)
}

enum RemoteConfigParser {
  /// Config files are at most 16 KiB of values; anything this big is not one.
  static let maxBytes = 64 * 1024

  /// Parse and verify a config file fetched for `channel`. With trusted keys
  /// (hosted default or configured) an unsigned or tampered file is refused,
  /// as for manifests.
  static func parse(
    data: Data,
    appId: String,
    channel: String?,
    trustedKeys: [ManifestKey]
  ) throws -> RemoteConfigFile {
    guard data.count <= maxBytes else { throw RemoteConfigError.tooLarge }
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw RemoteConfigError.invalidResponse
    }
    guard (object["appId"] as? String) == appId else { throw RemoteConfigError.wrongApp }
    guard try fileChannel(object["channel"]) == channel else { throw RemoteConfigError.wrongChannel }
    guard let version = object["version"] as? Int, version >= 1 else {
      throw RemoteConfigError.invalidVersion
    }
    let deleted = (object["deleted"] as? Bool) ?? false
    guard let valuesJson = object["valuesJson"] as? String,
          jsonText(valuesJson) is [String: Any] else {
      throw RemoteConfigError.invalidValues
    }
    let experimentsJson = try experiments(object["experimentsJson"])

    if trustedKeys.isEmpty {
      print("[OtaKit] WARNING: No manifest signing keys configured — remote config is not verified.")
    } else {
      guard let signature = ManifestClient.parseSignature(object["signature"]) else {
        throw RemoteConfigError.missingSignature
      }
      try ManifestVerifier.verifyConfig(
        appId: appId,
        channel: channel,
        version: version,
        deleted: deleted,
        valuesJson: valuesJson,
        experimentsJson: experimentsJson,
        signature: signature,
        trustedKeys: trustedKeys
      )
    }
    return RemoteConfigFile(
      appId: appId,
      channel: channel,
      version: version,
      deleted: deleted,
      valuesJson: valuesJson,
      experimentsJson: experimentsJson,
      updatedAt: object["updatedAt"] as? String
    )
  }

  /// The file's channel: a name, or nil (JSON null or absent) for the base channel.
  private static func fileChannel(_ raw: Any?) throws -> String? {
    if raw == nil || raw is NSNull { return nil }
    guard let name = raw as? String else { throw RemoteConfigError.wrongChannel }
    return name
  }

  /// The experiments text, which must be a JSON array, or nil.
  private static func experiments(_ raw: Any?) throws -> String? {
    if raw == nil || raw is NSNull { return nil }
    guard let text = raw as? String, jsonText(text) is [Any] else {
      throw RemoteConfigError.invalidExperiments
    }
    return text
  }

  private static func jsonText(_ text: String) -> Any? {
    guard let data = text.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data)
  }
}

/// Fetches, verifies and keeps the app's remote config. One fetch runs at a
/// time; concurrent refreshes share it.
actor RemoteConfigClient {
  struct Context {
    let cdnUrl: String
    let appId: String
    /// The app's channel (setChannel override, else configured); nil for base.
    let channel: String?
    let trustedKeys: [ManifestKey]
    let allowInsecureUrls: Bool
  }

  struct RefreshResult {
    let snapshot: RemoteConfigSnapshot
    let changed: Bool
    let error: String?
  }

  static let baseKey = "__base__"

  private let store: RemoteConfigStore
  private let session: URLSession
  private var state: RemoteConfigState
  /// Source keys fetched or confirmed in this process.
  private var freshSources: Set<String> = []
  private var inFlight: (id: Int, appId: String, channel: String?, task: Task<RefreshResult, Never>)?
  private var refreshCount = 0

  init(store: RemoteConfigStore, session: URLSession? = nil) {
    self.store = store
    self.state = store.load()
    if let session {
      self.session = session
    } else {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      configuration.timeoutIntervalForRequest = 15
      configuration.timeoutIntervalForResource = 30
      self.session = URLSession(configuration: configuration)
    }
  }

  static func key(_ channel: String?) -> String { channel ?? baseKey }

  /// The config the app sees now, without any network access.
  func snapshot(appId: String, channel: String?) -> RemoteConfigSnapshot {
    guard state.appId == nil || state.appId == appId else {
      return RemoteConfigSnapshot(file: nil, fetchedAt: nil, fresh: false)
    }
    let appKey = RemoteConfigClient.key(channel)
    let sourceKey: String?
    if let resolved = state.resolved[appKey] {
      sourceKey = resolved.isEmpty ? nil : resolved
    } else {
      // Never fetched for this channel (for example right after setChannel):
      // most channels use the base config, so show that until the fetch.
      sourceKey = state.sources[RemoteConfigClient.baseKey] != nil ? RemoteConfigClient.baseKey : nil
    }
    guard let sourceKey, let source = state.sources[sourceKey],
          source.file.appId == appId, !source.file.deleted else {
      return RemoteConfigSnapshot(file: nil, fetchedAt: nil, fresh: false)
    }
    return RemoteConfigSnapshot(
      file: source.file,
      fetchedAt: source.fetchedAt,
      fresh: freshSources.contains(sourceKey)
    )
  }

  /// Whether a resume should skip fetching because the last one was recent.
  func shouldSkip(intervalMs: Int) -> Bool {
    guard intervalMs > 0, state.lastFetchAt > 0 else { return false }
    return Date().timeIntervalSince1970 * 1000 - state.lastFetchAt < Double(intervalMs)
  }

  /// Fetch now. Callers that arrive while a fetch for the same app and channel
  /// runs share its result (`ownFetch` false, so only one of them reports a
  /// change); a fetch for another channel (setChannel meanwhile) runs anew.
  func refresh(_ context: Context) async -> (result: RefreshResult, ownFetch: Bool) {
    if let current = inFlight {
      let result = await current.task.value
      if current.appId == context.appId && current.channel == context.channel {
        return (result, false)
      }
    }
    refreshCount += 1
    let id = refreshCount
    let task = Task { await self.performRefresh(context) }
    inFlight = (id, context.appId, context.channel, task)
    let result = await task.value
    if inFlight?.id == id { inFlight = nil }
    return (result, true)
  }

  private enum Outcome {
    case file(RemoteConfigFile, etag: String?)
    case notModified
    case notFound
  }

  private func performRefresh(_ context: Context) async -> RefreshResult {
    if state.appId != context.appId {
      state = RemoteConfigState()
      state.appId = context.appId
      freshSources = []
    }
    let before = snapshot(appId: context.appId, channel: context.channel)
    var error: String?
    do {
      let appKey = RemoteConfigClient.key(context.channel)
      var resolvedKey: String?
      if let channel = context.channel {
        let own = try await fetchSource(channel: channel, context: context)
        if let own, !own.file.deleted {
          resolvedKey = RemoteConfigClient.key(channel)
        } else {
          // No config of its own (or a signed deletion): use the base copy
          // already on the device even if the base fetch below fails.
          state.resolved[appKey] = RemoteConfigClient.baseKey
        }
      }
      if resolvedKey == nil {
        let base = try await fetchSource(channel: nil, context: context)
        resolvedKey = (base != nil && !base!.file.deleted) ? RemoteConfigClient.baseKey : ""
      }
      state.resolved[appKey] = resolvedKey
    } catch let failure {
      error = RemoteConfigClient.describe(failure)
      print("[OtaKit] Remote config refresh failed: \(error ?? "")")
    }
    state.lastFetchAt = Date().timeIntervalSince1970 * 1000
    do {
      try store.save(state)
    } catch {
      print("[OtaKit] Cannot save remote config: \(error.localizedDescription)")
    }
    let after = snapshot(appId: context.appId, channel: context.channel)
    return RefreshResult(snapshot: after, changed: after.differs(from: before), error: error)
  }

  /// Fetch one source's file and update the state. Returns the source's
  /// current entry (nil when it has never had a file).
  private func fetchSource(
    channel: String?,
    context: Context
  ) async throws -> RemoteConfigState.Source? {
    let key = RemoteConfigClient.key(channel)
    let known = state.sources[key].flatMap { $0.file.appId == context.appId ? $0 : nil }
    let outcome = try await request(channel: channel, etag: known?.etag, context: context)
    let now = Date().timeIntervalSince1970 * 1000
    switch outcome {
    case let .file(file, etag):
      if file.version < (state.maxVersions[key] ?? 0) {
        // An older file than one already accepted: a stale cache or a replay.
        print("[OtaKit] Ignoring remote config version \(file.version) for \(key): already saw a newer one")
        return known
      }
      state.maxVersions[key] = max(state.maxVersions[key] ?? 0, file.version)
      let source = RemoteConfigState.Source(file: file, etag: etag, fetchedAt: now)
      state.sources[key] = source
      freshSources.insert(key)
      return source
    case .notModified:
      guard var source = known else { return nil }
      source.fetchedAt = now
      state.sources[key] = source
      freshSources.insert(key)
      return source
    case .notFound:
      // The server writes a signed deletion instead of removing a file, so a
      // missing file the device has seen before is not trusted to mean "gone".
      if let known {
        print("[OtaKit] Remote config for \(key) is missing; keeping the last verified copy")
        return known
      }
      return nil
    }
  }

  private func request(channel: String?, etag: String?, context: Context) async throws -> Outcome {
    let base = context.cdnUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    guard let baseURL = URL(string: base) else { throw ManifestClientError.invalidURL }
    let url = baseURL
      .appendingPathComponent("config", isDirectory: true)
      .appendingPathComponent(context.appId, isDirectory: true)
      .appendingPathComponent(RemoteConfigClient.key(channel), isDirectory: true)
      .appendingPathComponent("config.json", isDirectory: false)
    try ManifestClient.requireHTTPS(url: url, allowInsecure: context.allowInsecureUrls)

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw RemoteConfigError.invalidResponse }
    switch http.statusCode {
    case 200:
      let file = try RemoteConfigParser.parse(
        data: data,
        appId: context.appId,
        channel: channel,
        trustedKeys: context.trustedKeys
      )
      return .file(file, etag: http.value(forHTTPHeaderField: "ETag"))
    case 304:
      return .notModified
    case 403, 404:
      // R2 answers a missing public object with 404 (403 without list access).
      return .notFound
    default:
      throw RemoteConfigError.httpStatus(http.statusCode)
    }
  }

  private static func describe(_ error: Error) -> String {
    if let config = error as? RemoteConfigError {
      switch config {
      case .httpStatus(let status): return "http_\(status)"
      case .tooLarge: return "too_large"
      case .wrongApp, .wrongChannel, .invalidVersion, .invalidValues, .invalidExperiments,
           .invalidResponse: return "invalid_config"
      case .missingSignature: return "missing_signature"
      }
    }
    if error is ManifestVerifierError { return "signature_invalid" }
    if case ManifestClientError.insecureURL = error { return "insecure_url" }
    return "network_error"
  }
}
