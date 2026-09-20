import Foundation

/// Empty means intentionally unconfigured; malformed explicit settings must never return empty.
enum ManifestKeyConfig {
  static func parse(_ config: [String: Any]) -> [(kid: String, key: Data)] {
    guard let rawValue = config["manifestKeys"] else { return [] }
    guard let entries = rawValue as? [[String: String]] else { return invalid() }
    let keys: [(kid: String, key: Data)] = entries.compactMap { entry in
      guard let kid = entry["kid"], let encoded = entry["key"],
            let data = Data(base64Encoded: encoded) else { return nil }
      return (kid: kid, key: data)
    }
    return keys.isEmpty && !entries.isEmpty ? invalid() : keys
  }

  private static func invalid() -> [(kid: String, key: Data)] {
    print("[OtaKit] ERROR: Invalid manifestKeys configuration. Manifest verification will reject all updates.")
    return [(kid: "_invalid_", key: Data())]
  }
}
