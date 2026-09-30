import Foundation

/// Preview links (plugin config `previewLinks: true`).
///
/// `<scheme>://otakit-preview?token=<token>` opens a preview and
/// `<scheme>://otakit-preview?exit=1` ends it. A preview serves one bundle's
/// signed manifest on the hidden channel `__preview_<token>`; manifest paths
/// are public, so the token is the capability. Must match Preview.java and
/// console/lib/preview-links.ts.
enum PreviewLink: Equatable {
  case start(token: String)
  case exit

  static let channelPrefix = "__preview"
  static let host = "otakit-preview"

  static func parse(_ url: URL) -> PreviewLink? {
    guard url.host?.lowercased() == host,
          let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
      return nil
    }
    if items.contains(where: { $0.name == "exit" && $0.value == "1" }) {
      return .exit
    }
    guard let token = items.first(where: { $0.name == "token" })?.value,
          isToken(token) else {
      return nil
    }
    return .start(token: token)
  }

  static func isToken(_ value: String) -> Bool {
    value.range(of: "\\A[a-z2-7]{26}\\z", options: .regularExpression) != nil
  }

  static func channel(for token: String) -> String {
    "\(channelPrefix)_\(token)"
  }

  static func isPreviewChannel(_ channel: String?) -> Bool {
    channel?.hasPrefix(channelPrefix) ?? false
  }

  /// Device events report preview installs without the token.
  static func reportedChannel(_ channel: String?) -> String? {
    isPreviewChannel(channel) ? channelPrefix : channel
  }
}

/// The active preview, persisted so it survives restarts.
struct PreviewState: Codable, Equatable {
  /// Local safety net: a preview ends after this long even if the server
  /// never removed its manifest.
  static let maxAge: TimeInterval = 30 * 24 * 60 * 60

  let token: String
  let startedAt: Date

  var channel: String { PreviewLink.channel(for: token) }

  func isTooOld(now: Date = Date()) -> Bool {
    now.timeIntervalSince(startedAt) > PreviewState.maxAge
  }
}
