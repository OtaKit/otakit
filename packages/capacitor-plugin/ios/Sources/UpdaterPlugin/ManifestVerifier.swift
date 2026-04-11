import CryptoKit
import Foundation

struct ManifestKey {
  let kid: String
  let derData: Data
}

enum ManifestVerifierError: Error {
  case unknownKid(String)
  case expired
  case invalidSignature
  case missingSignature
}

enum ManifestVerifier {

  /// Verify a manifest signature using ES256 (ECDSA P-256 + SHA-256).
  ///
  /// - Parameters:
  ///   - appId, channel, platform: Request context (known by plugin).
  ///   - version, sha256, size, runtimeVersion: Response fields.
  ///   - signature: The signature object from the manifest response.
  ///   - trustedKeys: Array of verification keys configured in the plugin.
  ///
  /// - Throws: `ManifestVerifierError` on failure.
  static func verify(
    appId: String,
    channel: String?,
    platform: String,
    version: String,
    sha256: String,
    size: Int,
    runtimeVersion: String?,
    signature: ManifestSignature,
    trustedKeys: [ManifestKey]
  ) throws {
    let payload = buildCanonicalPayload(
      appId: appId,
      channel: channel,
      platform: platform,
      version: version,
      sha256: sha256,
      size: size,
      runtimeVersion: runtimeVersion,
      kid: signature.kid,
      iat: signature.iat,
      exp: signature.exp
    )
    try verifyPayload(payload, signature: signature, trustedKeys: trustedKeys)
  }

  static func verifyLegacy(
    appId: String,
    channel: String?,
    platform: String,
    version: String,
    sha256: String,
    size: Int,
    signature: ManifestSignature,
    trustedKeys: [ManifestKey]
  ) throws {
    let payload = buildLegacyCanonicalPayload(
      appId: appId,
      channel: channel,
      platform: platform,
      version: version,
      sha256: sha256,
      size: size,
      kid: signature.kid,
      iat: signature.iat,
      exp: signature.exp
    )
    try verifyPayload(payload, signature: signature, trustedKeys: trustedKeys)
  }

  private static func verifyPayload(
    _ payload: String,
    signature: ManifestSignature,
    trustedKeys: [ManifestKey]
  ) throws {
    // Check expiry
    let now = Int(Date().timeIntervalSince1970)
    guard signature.exp > now else {
      throw ManifestVerifierError.expired
    }

    // Find matching key
    guard let keyEntry = trustedKeys.first(where: { $0.kid == signature.kid }) else {
      throw ManifestVerifierError.unknownKid(signature.kid)
    }

    // Decode base64url signature
    guard let sigData = base64UrlDecode(signature.sig) else {
      throw ManifestVerifierError.invalidSignature
    }

    // Verify with CryptoKit
    let verificationKey = try P256.Signing.PublicKey(derRepresentation: keyEntry.derData)
    let payloadData = Data(payload.utf8)
    let ecdsaSignature = try P256.Signing.ECDSASignature(derRepresentation: sigData)
    guard verificationKey.isValidSignature(ecdsaSignature, for: payloadData) else {
      throw ManifestVerifierError.invalidSignature
    }
  }

  private static func buildCanonicalPayload(
    appId: String,
    channel: String?,
    platform: String,
    version: String,
    sha256: String,
    size: Int,
    runtimeVersion: String?,
    kid: String,
    iat: Int,
    exp: Int
  ) -> String {
    return [
      "MANIFEST_V2",
      "appId:\(appId)",
      "channel:\(channel ?? "null")",
      "platform:\(platform)",
      "version:\(version)",
      "sha256:\(sha256)",
      "size:\(size)",
      "runtimeVersion:\(runtimeVersion ?? "null")",
      "kid:\(kid)",
      "iat:\(iat)",
      "exp:\(exp)",
    ].joined(separator: "\n")
  }

  private static func buildLegacyCanonicalPayload(
    appId: String,
    channel: String?,
    platform: String,
    version: String,
    sha256: String,
    size: Int,
    kid: String,
    iat: Int,
    exp: Int
  ) -> String {
    return [
      "MANIFEST_V1",
      "appId:\(appId)",
      "channel:\(channel ?? "null")",
      "platform:\(platform)",
      "version:\(version)",
      "sha256:\(sha256)",
      "size:\(size)",
      "minNativeBuild:null",
      "kid:\(kid)",
      "iat:\(iat)",
      "exp:\(exp)",
    ].joined(separator: "\n")
  }

  private static func base64UrlDecode(_ string: String) -> Data? {
    var base64 = string
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = base64.count % 4
    if remainder > 0 {
      base64 += String(repeating: "=", count: 4 - remainder)
    }
    return Data(base64Encoded: base64)
  }
}
