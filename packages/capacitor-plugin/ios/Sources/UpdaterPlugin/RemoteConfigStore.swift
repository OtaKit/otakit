import Foundation

/// What the app reads: the config of its channel (or the base config it falls
/// back to), where it came from, and when.
struct RemoteConfigSnapshot: Equatable {
  let file: RemoteConfigFile?
  /// When the file was last fetched or confirmed unchanged (ms since 1970).
  let fetchedAt: Double?
  /// True when this process fetched or confirmed it; false for the saved copy.
  let fresh: Bool

  func toDictionary() -> [String: Any] {
    guard let file else {
      return [
        "valuesJson": NSNull(),
        "experimentsJson": NSNull(),
        "version": NSNull(),
        "channel": NSNull(),
        "fetchedAt": fetchedAt.map(RemoteConfigSnapshot.isoString) ?? NSNull(),
        "source": "none"
      ]
    }
    return [
      "valuesJson": file.valuesJson,
      "experimentsJson": file.experimentsJson ?? NSNull(),
      "version": file.version,
      "channel": file.channel ?? NSNull(),
      "fetchedAt": fetchedAt.map(RemoteConfigSnapshot.isoString) ?? NSNull(),
      "source": fresh ? "remote" : "cache"
    ]
  }

  private static func isoString(_ milliseconds: Double) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1000))
  }

  /// Whether the app would see different config (values, experiments, version or source channel).
  func differs(from other: RemoteConfigSnapshot) -> Bool {
    file?.valuesJson != other.file?.valuesJson
      || file?.experimentsJson != other.file?.experimentsJson
      || file?.version != other.file?.version
      || file?.channel != other.file?.channel
  }
}

/// Persisted state, one atomic JSON file: the last verified file per source
/// channel, which source each app channel resolved to, and the highest version
/// accepted per source (replay protection survives restarts and deletions).
struct RemoteConfigState: Codable, Equatable {
  struct Source: Codable, Equatable {
    var file: RemoteConfigFile
    var etag: String?
    var fetchedAt: Double
  }

  /// Source key (channel, or `__base__`) → its last verified file.
  var sources: [String: Source] = [:]
  /// App channel key → the source key it uses, or "" for no config.
  var resolved: [String: String] = [:]
  /// Source key → highest version accepted.
  var maxVersions: [String: Int] = [:]
  /// Last fetch attempt (ms since 1970), for the resume interval.
  var lastFetchAt: Double = 0
}

final class RemoteConfigStore {
  private let file: URL

  init(directory: URL) {
    file = directory.appendingPathComponent("state.json", isDirectory: false)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  static func defaultDirectory() -> URL {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return support.appendingPathComponent("OtaKitConfig", isDirectory: true)
  }

  /// An unreadable file starts over: config falls back to code defaults until
  /// the next fetch, which is safer than trusting a damaged copy.
  func load() -> RemoteConfigState {
    guard let data = try? Data(contentsOf: file),
          let state = try? JSONDecoder().decode(RemoteConfigState.self, from: data) else {
      return RemoteConfigState()
    }
    return state
  }

  func save(_ state: RemoteConfigState) throws {
    try JSONEncoder().encode(state).write(to: file, options: .atomic)
  }
}
