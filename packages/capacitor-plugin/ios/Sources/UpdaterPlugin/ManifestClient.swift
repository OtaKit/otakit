import Foundation

struct LatestManifest {
  let version: String
  let url: String
  let sha256: String
  let size: Int
  let minNativeBuild: Int?
  let releaseId: String?
  let signature: ManifestSignature?
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
    updateUrl: String,
    appId: String,
    channel: String?,
    currentVersion: String,
    currentReleaseId: String?,
    nativeBuild: String,
    platform: String,
    allowInsecureUrls: Bool = false,
    manifestKeys: [ManifestKey] = []
  ) async throws -> LatestManifest? {
    let sanitizedBase = updateUrl.replacingOccurrences(
      of: "/+$",
      with: "",
      options: .regularExpression
    )

    guard let baseURL = URL(string: sanitizedBase) else {
      throw ManifestClientError.invalidURL
    }
    let url = baseURL.appendingPathComponent("manifest")

    try requireHTTPS(url: url, allowInsecure: allowInsecureUrls)

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue(appId, forHTTPHeaderField: "X-App-Id")
    request.setValue(platform, forHTTPHeaderField: "X-Platform")
    if let channel, !channel.isEmpty {
      request.setValue(channel, forHTTPHeaderField: "X-Channel")
    }
    request.setValue(currentVersion, forHTTPHeaderField: "X-Current-Version")
    if let currentReleaseId, !currentReleaseId.isEmpty {
      request.setValue(currentReleaseId, forHTTPHeaderField: "X-Release-Id")
    }
    request.setValue(nativeBuild, forHTTPHeaderField: "X-Native-Build")
    request.timeoutInterval = 30

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw ManifestClientError.invalidResponse
    }

    if httpResponse.statusCode == 204 {
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

    var minNativeBuild: Int?
    if let numeric = object["minNativeBuild"] as? NSNumber {
      minNativeBuild = numeric.intValue
    } else if let stringValue = object["minNativeBuild"] as? String {
      minNativeBuild = Int(stringValue)
    }

    var signature: ManifestSignature?
    if let sigObj = object["signature"] as? [String: Any],
       let kid = sigObj["kid"] as? String,
       let sig = sigObj["sig"] as? String,
       let iat = sigObj["iat"] as? Int,
       let exp = sigObj["exp"] as? Int {
      signature = ManifestSignature(kid: kid, sig: sig, iat: iat, exp: exp)
    }

    let releaseId = object["releaseId"] as? String

    // Validate download URL scheme
    guard let dlURL = URL(string: downloadUrl) else {
      throw ManifestClientError.invalidURL
    }
    try requireHTTPS(url: dlURL, allowInsecure: allowInsecureUrls)

    if manifestKeys.isEmpty {
      print("[UpdateKit] WARNING: No manifest signing keys configured — signature verification is disabled for this request.")
    }

    // Verify manifest signature if signing keys are configured
    if !manifestKeys.isEmpty {
      guard let sig = signature else {
        throw ManifestVerifierError.missingSignature
      }
      try ManifestVerifier.verify(
        appId: appId,
        channel: channel,
        platform: platform,
        version: version,
        sha256: sha256,
        size: size,
        minNativeBuild: minNativeBuild,
        signature: sig,
        trustedKeys: manifestKeys
      )
    }

    return LatestManifest(
      version: version,
      url: downloadUrl,
      sha256: sha256,
      size: size,
      minNativeBuild: minNativeBuild,
      releaseId: releaseId,
      signature: signature
    )
  }
}
