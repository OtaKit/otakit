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
  ///   - version, sha256, size, minNativeBuild: Response fields.
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
    minNativeBuild: Int?,
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

    // Build canonical payload (must match server exactly)
    let payload = buildCanonicalPayload(
      appId: appId,
      channel: channel,
      platform: platform,
      version: version,
      sha256: sha256,
      size: size,
      minNativeBuild: minNativeBuild,
      kid: signature.kid,
      iat: signature.iat,
      exp: signature.exp
    )

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
    minNativeBuild: Int?,
    kid: String,
    iat: Int,
    exp: Int
  ) -> String {
    let minBuildStr = minNativeBuild.map { String($0) } ?? "null"
    return [
      "MANIFEST_V1",
      "appId:\(appId)",
      "channel:\(channel ?? "null")",
      "platform:\(platform)",
      "version:\(version)",
      "sha256:\(sha256)",
      "size:\(size)",
      "minNativeBuild:\(minBuildStr)",
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
