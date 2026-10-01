import Foundation

struct BundleInfo: Codable {
  let id: String
  let version: String
  let runtimeVersion: String?
  let status: BundleStatus
  let downloadedAt: Date?
  let sha256: String?
  let path: String?
  let channel: String?
  let releaseId: String?
  /// Release notes delivered with this bundle (plugin 3.3+).
  var notes: String? = nil

  var isBuiltin: Bool {
    id == "builtin"
  }

  var attemptId: String? {
    guard id.hasPrefix("bundle-"), UUID(uuidString: String(id.dropFirst(7))) != nil else { return nil }
    return id
  }

  func withStatus(_ status: BundleStatus) -> BundleInfo {
    BundleInfo(
      id: id, version: version, runtimeVersion: runtimeVersion, status: status,
      downloadedAt: downloadedAt, sha256: sha256, path: path, channel: channel,
      releaseId: releaseId, notes: notes
    )
  }

  func toDictionary() -> [String: Any] {
    var result: [String: Any] = [
      "id": id,
      "version": version,
      "status": status.rawValue,
    ]

    if let runtimeVersion {
      result["runtimeVersion"] = runtimeVersion
    }

    if let downloadedAt {
      result["downloadedAt"] = ISO8601DateFormatter().string(from: downloadedAt)
    }
    if let sha256 {
      result["sha256"] = sha256
    }
    if let channel {
      // JS may forward this to logs or analytics: never expose a preview token.
      result["channel"] = PreviewLink.reportedChannel(channel)
    }
    if let releaseId {
      result["releaseId"] = releaseId
    }
    if let notes {
      result["notes"] = notes
    }

    return result
  }
}
