import Foundation

enum HostedManifestKeys {
  static let managedCdnURL = "https://cdn.otakit.app"

  static let defaults: [(kid: String, key: Data)] = [
    (
      kid: "hosted-2026-04-02-ce611e6d",
      key: Data(
        base64Encoded: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELg6eAj2+7aZ1FJnYUNMjOtWuQLJMomXkPvmeTQ3gXyabpLTDX0m3iWYO3cEOXqIR6NphGC6csS2T5bCtXwIBFw=="
      )!
    )
  ]

  static func matchesManagedManifestURL(_ cdnUrl: String) -> Bool {
    let normalized = cdnUrl
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
      .lowercased()
    return normalized == managedCdnURL
        || normalized == "https://www.otakit.app"
  }
}
