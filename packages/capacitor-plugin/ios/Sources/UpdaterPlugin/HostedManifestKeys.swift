import Foundation

enum HostedManifestKeys {
  static let managedServerURL = "https://www.otakit.app/api/v1"

  static let defaults: [(kid: String, key: Data)] = [
    (
      kid: "hosted-2026-04-02-ce611e6d",
      key: Data(
        base64Encoded: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELg6eAj2+7aZ1FJnYUNMjOtWuQLJMomXkPvmeTQ3gXyabpLTDX0m3iWYO3cEOXqIR6NphGC6csS2T5bCtXwIBFw=="
      )!
    )
  ]

  static func matchesManagedServer(_ updateUrl: String) -> Bool {
    let normalized = updateUrl
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
      .lowercased()
    return normalized == managedServerURL
        || normalized == "https://otakit.app/api/v1"
  }
}
