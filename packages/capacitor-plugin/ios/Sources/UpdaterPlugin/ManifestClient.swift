import Foundation

private let baseChannelKey = "__base__"
private let defaultRuntimeKey = "__default__"

struct LatestManifest {
  let version: String
  let url: String
  let sha256: String
  let size: Int
  let runtimeVersion: String?
  let releaseId: String
}

struct ManifestSignature {
  let kid: String
  let sig: String
  let iat: Int
  let exp: Int
}

enum ManifestClientError: Error {
  case invalidURL
  case invalidResponse
  case requestFailed(String)
  case insecureURL(String)
}

enum ManifestClient {

  static func requireHTTPS(url: URL, allowInsecure: Bool) throws {
    let scheme = url.scheme?.lowercased() ?? ""
    if scheme == "https" { return }
    if allowInsecure {
      let host = url.host?.lowercased() ?? ""
      if host == "localhost" || host == "127.0.0.1" { return }
    }
    throw ManifestClientError.insecureURL(
      "URL must use HTTPS: \(url.absoluteString)"
    )
  }

  static func fetchLatest(
    cdnUrl: String,
    appId: String,
    channel: String?,
    runtimeVersion: String?,
    allowInsecureUrls: Bool = false,
    manifestKeys: [ManifestKey] = []
  ) async throws -> LatestManifest? {
    let sanitizedBase = cdnUrl.replacingOccurrences(
      of: "/+$",
      with: "",
      options: .regularExpression
    )

    let channelKey = channel?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
      ?? baseChannelKey
    let runtimeKey = runtimeVersion?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
      ?? defaultRuntimeKey

    guard let url = URL(
      string: "\(sanitizedBase)/manifests/\(appId)/\(channelKey)/\(runtimeKey)/manifest.json"
    ) else {
      throw ManifestClientError.invalidURL
    }

    try requireHTTPS(url: url, allowInsecure: allowInsecureUrls)

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.timeoutInterval = 30

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw ManifestClientError.invalidResponse
    }

    if httpResponse.statusCode == 404 || httpResponse.statusCode == 204 {
      return nil
    }

    guard httpResponse.statusCode == 200 else {
      let body = String(data: data, encoding: .utf8) ?? "unknown"
      throw ManifestClientError.requestFailed(
        "HTTP \(httpResponse.statusCode): \(body)"
      )
    }

    guard
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let version = object["version"] as? String,
      let downloadUrl = object["url"] as? String,
      let sha256 = object["sha256"] as? String,
      let size = object["size"] as? Int
    else {
      throw ManifestClientError.invalidResponse
    }

    let runtimeVersion = (object["runtimeVersion"] as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .nilIfEmpty

    let signature = parseSignature(object["signature"])
    guard let releaseId = (object["releaseId"] as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .nilIfEmpty else {
      throw ManifestClientError.invalidResponse
    }

    guard let dlURL = URL(string: downloadUrl) else {
      throw ManifestClientError.invalidURL
    }
    try requireHTTPS(url: dlURL, allowInsecure: allowInsecureUrls)

    if manifestKeys.isEmpty {
      print("[UpdateKit] WARNING: No manifest signing keys configured — signature verification is disabled for this request.")
    }

    if !manifestKeys.isEmpty {
      guard let signature else {
        throw ManifestVerifierError.missingSignature
      }

      try ManifestVerifier.verify(
        appId: appId,
        channel: channel,
        version: version,
        sha256: sha256,
        size: size,
        runtimeVersion: runtimeVersion,
        signature: signature,
        trustedKeys: manifestKeys
      )
    }

    return LatestManifest(
      version: version,
      url: downloadUrl,
      sha256: sha256,
      size: size,
      runtimeVersion: runtimeVersion,
      releaseId: releaseId
    )
  }

  private static func parseSignature(_ rawValue: Any?) -> ManifestSignature? {
    guard let sigObj = rawValue as? [String: Any],
          let kid = sigObj["kid"] as? String,
          let sig = sigObj["sig"] as? String,
          let iat = sigObj["iat"] as? Int,
          let exp = sigObj["exp"] as? Int else {
      return nil
    }

    return ManifestSignature(kid: kid, sig: sig, iat: iat, exp: exp)
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}
