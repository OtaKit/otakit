import Foundation

struct LatestManifest {
  let version: String
  let url: String
  let sha256: String
  let size: Int
  let runtimeVersion: String?
  let releaseId: String?
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
    runtimeVersion: String?,
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
    if let runtimeVersion, !runtimeVersion.isEmpty {
      request.setValue(runtimeVersion, forHTTPHeaderField: "X-Runtime-Version")
    }
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

    let runtimeVersion = (object["runtimeVersion"] as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .nilIfEmpty

    let signature = parseSignature(object["signature"])
    let signatureV2 = parseSignature(object["signatureV2"])

    let releaseId = object["releaseId"] as? String

    // Validate download URL scheme
    guard let dlURL = URL(string: downloadUrl) else {
      throw ManifestClientError.invalidURL
    }
    try requireHTTPS(url: dlURL, allowInsecure: allowInsecureUrls)

    if manifestKeys.isEmpty {
      print("[UpdateKit] WARNING: No manifest signing keys configured — signature verification is disabled for this request.")
    }

    // Verify manifest signature if signing keys are configured.
    // New manifests carry signatureV2 with runtimeVersion in the signed payload.
    // Older servers only return the legacy signature field.
    if !manifestKeys.isEmpty {
      if let sigV2 = signatureV2 {
        try ManifestVerifier.verify(
          appId: appId,
          channel: channel,
          platform: platform,
          version: version,
          sha256: sha256,
          size: size,
          runtimeVersion: runtimeVersion,
          signature: sigV2,
          trustedKeys: manifestKeys
        )
      } else if let sig = signature {
        try ManifestVerifier.verifyLegacy(
          appId: appId,
          channel: channel,
          platform: platform,
          version: version,
          sha256: sha256,
          size: size,
          signature: sig,
          trustedKeys: manifestKeys
        )
      } else {
        throw ManifestVerifierError.missingSignature
      }
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
