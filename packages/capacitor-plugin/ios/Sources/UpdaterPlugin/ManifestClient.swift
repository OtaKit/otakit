import Foundation

private let baseChannelKey = "__base__"
private let defaultRuntimeKey = "__default__"

struct ManifestEncryption {
  let alg: String
  let kid: String
  let wrapNonce: String
  let wrappedDek: String
  let nonce: String
}

struct ManifestFileEntry {
  let path: String
  let sha256: String
  let size: Int?
  let url: String
}

struct LatestManifest {
  let version: String
  /// Bundle zip URL. Present for the zip strategy; nil for deltas.
  let url: String?
  /// Zip hash for the zip strategy; canonical filesHash for deltas.
  let sha256: String
  let size: Int
  let runtimeVersion: String?
  let releaseId: String
  let strategy: String
  let forceImmediate: Bool
  let encryption: ManifestEncryption?
  /// Per-file entries for the deltas strategy; nil for zip.
  let files: [ManifestFileEntry]?
}

struct ManifestSignature {
  let kid: String
  let sig: String
  let iat: Int
  let exp: Int
}

/// A rolling release offered to `percent` of devices (plugin 3.1+).
struct ManifestRollout {
  let manifest: LatestManifest
  let percent: Int
}

struct ParsedManifest {
  /// The release every device may take.
  let stable: LatestManifest
  let rollout: ManifestRollout?
  /// Why a rollout block was ignored; devices then stay on `stable`.
  let rolloutFailure: CheckFailure?
}

enum ManifestClientError: Error {
  case invalidURL
  case invalidResponse
  case requestFailed(String)
  case httpStatus(Int)
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
  ) async throws -> ParsedManifest? {
    let sanitizedBase = cdnUrl.replacingOccurrences(
      of: "/+$",
      with: "",
      options: .regularExpression
    )

    let channelKey = channel?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
      ?? baseChannelKey
    let runtimeKey = runtimeVersion?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
      ?? defaultRuntimeKey

    guard let baseURL = URL(string: sanitizedBase) else {
      throw ManifestClientError.invalidURL
    }
    let url = baseURL
      .appendingPathComponent("manifests", isDirectory: true)
      .appendingPathComponent(appId, isDirectory: true)
      .appendingPathComponent(channelKey, isDirectory: true)
      .appendingPathComponent(runtimeKey, isDirectory: true)
      .appendingPathComponent("manifest.json", isDirectory: false)

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
      throw ManifestClientError.httpStatus(httpResponse.statusCode)
    }

    return try parse(
      data: data,
      appId: appId,
      channel: channel,
      allowInsecureUrls: allowInsecureUrls,
      manifestKeys: manifestKeys
    )
  }

  /// Parse and verify a manifest body. The top level must be valid; an
  /// optional `rollout` block that fails parsing or verification is dropped
  /// (reported in `rolloutFailure`) so a bad block can never block updates.
  static func parse(
    data: Data,
    appId: String,
    channel: String?,
    allowInsecureUrls: Bool = false,
    manifestKeys: [ManifestKey] = []
  ) throws -> ParsedManifest {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ManifestClientError.invalidResponse
    }
    let (stable, signature) = try parseEntry(object, allowInsecureUrls: allowInsecureUrls)

    if manifestKeys.isEmpty {
      print("[OtaKit] WARNING: No manifest signing keys configured — signature verification is disabled for this request.")
    }

    if !manifestKeys.isEmpty {
      guard let signature else {
        throw ManifestVerifierError.missingSignature
      }

      try ManifestVerifier.verify(
        appId: appId,
        channel: channel,
        version: stable.version,
        sha256: stable.sha256,
        size: stable.size,
        runtimeVersion: stable.runtimeVersion,
        strategy: stable.strategy,
        forceImmediate: stable.forceImmediate,
        encryption: stable.encryption,
        signature: signature,
        trustedKeys: manifestKeys
      )
    }

    guard let rawRollout = object["rollout"], !(rawRollout is NSNull) else {
      return ParsedManifest(stable: stable, rollout: nil, rolloutFailure: nil)
    }
    do {
      let rollout = try parseRollout(
        rawRollout,
        stable: stable,
        appId: appId,
        channel: channel,
        allowInsecureUrls: allowInsecureUrls,
        manifestKeys: manifestKeys
      )
      return ParsedManifest(stable: stable, rollout: rollout, rolloutFailure: nil)
    } catch {
      return ParsedManifest(stable: stable, rollout: nil, rolloutFailure: CheckFailure.rollout(error))
    }
  }

  private static func parseRollout(
    _ rawValue: Any,
    stable: LatestManifest,
    appId: String,
    channel: String?,
    allowInsecureUrls: Bool,
    manifestKeys: [ManifestKey]
  ) throws -> ManifestRollout {
    guard let object = rawValue as? [String: Any],
          let percent = object["percent"] as? Int,
          (1...99).contains(percent),
          let stableSha256 = object["stableSha256"] as? String,
          stableSha256 == stable.sha256 else {
      throw ManifestClientError.invalidResponse
    }
    let (manifest, signature) = try parseEntry(object, allowInsecureUrls: allowInsecureUrls)
    let rollout = ManifestRollout(manifest: manifest, percent: percent)
    if !manifestKeys.isEmpty {
      guard let signature else {
        throw ManifestVerifierError.missingSignature
      }
      try ManifestVerifier.verifyRollout(
        appId: appId,
        channel: channel,
        rollout: rollout,
        stableSha256: stableSha256,
        signature: signature,
        trustedKeys: manifestKeys
      )
    }
    return rollout
  }

  /// Bundle fields shared by the top level and the `rollout` block.
  private static func parseEntry(
    _ object: [String: Any],
    allowInsecureUrls: Bool
  ) throws -> (LatestManifest, ManifestSignature?) {
    guard
      let version = object["version"] as? String,
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

    let strategy = (object["strategy"] as? String)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .nilIfEmpty ?? "zip"
    let forceImmediate = object["forceImmediate"] as? Bool ?? false
    let encryption = try parseEncryption(object["encryption"])

    let downloadUrl = (object["url"] as? String)?.nilIfEmpty
    var files: [ManifestFileEntry]?

    if strategy == "deltas" {
      files = try parseFiles(object["files"], allowInsecureUrls: allowInsecureUrls)
    } else {
      guard let downloadUrl, let dlURL = URL(string: downloadUrl) else {
        throw ManifestClientError.invalidResponse
      }
      try requireHTTPS(url: dlURL, allowInsecure: allowInsecureUrls)
    }

    let manifest = LatestManifest(
      version: version,
      url: downloadUrl,
      sha256: sha256,
      size: size,
      runtimeVersion: runtimeVersion,
      releaseId: releaseId,
      strategy: strategy,
      forceImmediate: forceImmediate,
      encryption: encryption,
      files: files
    )
    return (manifest, signature)
  }

  private static func parseFiles(
    _ rawValue: Any?,
    allowInsecureUrls: Bool
  ) throws -> [ManifestFileEntry] {
    guard let rawFiles = rawValue as? [[String: Any]], !rawFiles.isEmpty else {
      throw ManifestClientError.invalidResponse
    }

    var entries: [ManifestFileEntry] = []
    entries.reserveCapacity(rawFiles.count)
    for rawFile in rawFiles {
      guard let path = rawFile["path"] as? String,
            let sha256 = rawFile["sha256"] as? String,
            let fileUrl = rawFile["url"] as? String,
            let parsedUrl = URL(string: fileUrl) else {
        throw ManifestClientError.invalidResponse
      }
      try requireHTTPS(url: parsedUrl, allowInsecure: allowInsecureUrls)
      entries.append(
        ManifestFileEntry(
          path: path,
          sha256: sha256,
          size: rawFile["size"] as? Int,
          url: fileUrl
        )
      )
    }
    return entries
  }

  private static func parseEncryption(_ rawValue: Any?) throws -> ManifestEncryption? {
    guard let rawValue, !(rawValue is NSNull) else {
      return nil
    }
    guard let object = rawValue as? [String: Any],
          let alg = object["alg"] as? String,
          let kid = object["kid"] as? String,
          let wrapNonce = object["wrapNonce"] as? String,
          let wrappedDek = object["wrappedDek"] as? String,
          let nonce = object["nonce"] as? String else {
      throw ManifestClientError.invalidResponse
    }
    return ManifestEncryption(
      alg: alg,
      kid: kid,
      wrapNonce: wrapNonce,
      wrappedDek: wrappedDek,
      nonce: nonce
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
