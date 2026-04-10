import Foundation

struct BundleInfo: Codable {
  let id: String
  let version: String
  let status: BundleStatus
  let downloadedAt: Date?
  let sha256: String?
  let path: String?
  let channel: String?
  let releaseId: String?

  var isBuiltin: Bool {
    id == "builtin"
  }

  func toDictionary() -> [String: Any] {
    var result: [String: Any] = [
      "id": id,
      "version": version,
      "status": status.rawValue,
    ]

    if let downloadedAt {
      result["downloadedAt"] = ISO8601DateFormatter().string(from: downloadedAt)
    }
    if let sha256 {
      result["sha256"] = sha256
    }
    if let channel {
      result["channel"] = channel
    }
    if let releaseId {
      result["releaseId"] = releaseId
    }

    return result
  }
}
