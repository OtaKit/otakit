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
  ///   - appId, channel: Request context (known by plugin).
  ///   - version, sha256, size, runtimeVersion: Response fields.
  ///   - signature: The signature object from the manifest response.
  ///   - trustedKeys: Array of verification keys configured in the plugin.
  ///
  /// - Throws: `ManifestVerifierError` on failure.
  static func verify(
    appId: String,
    channel: String?,
    version: String,
    sha256: String,
    size: Int,
    runtimeVersion: String?,
    strategy: String,
    forceImmediate: Bool,
    encryption: ManifestEncryption?,
    signature: ManifestSignature,
    trustedKeys: [ManifestKey]
  ) throws {
    let payload = buildCanonicalPayload(
      appId: appId,
      channel: channel,
      version: version,
      sha256: sha256,
      size: size,
      runtimeVersion: runtimeVersion,
      strategy: strategy,
      forceImmediate: forceImmediate,
      encryption: encryption,
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

  /// Encode the encryption block for the canonical payload.
  /// Must match the server's `encodeEncryptionForPayload` exactly.
  private static func encodeEncryptionForPayload(_ encryption: ManifestEncryption?) -> String {
    guard let encryption else {
      return "null"
    }
    return [
      encryption.alg,
      encryption.kid,
      encryption.wrapNonce,
      encryption.wrappedDek,
      encryption.nonce,
    ].joined(separator: "|")
  }

  /// Canonical payload v2 — must match the server's `buildCanonicalPayload`
  /// (console/lib/manifest-signing.ts) and the Android mirror byte-for-byte.
  private static func buildCanonicalPayload(
    appId: String,
    channel: String?,
    version: String,
    sha256: String,
    size: Int,
    runtimeVersion: String?,
    strategy: String,
    forceImmediate: Bool,
    encryption: ManifestEncryption?,
    kid: String,
    iat: Int,
    exp: Int
  ) -> String {
    return [
      "MANIFEST",
      "appId:\(appId)",
      "channel:\(channel ?? "null")",
      "version:\(version)",
      "sha256:\(sha256)",
      "size:\(size)",
      "runtimeVersion:\(runtimeVersion ?? "null")",
      "strategy:\(strategy)",
      "forceImmediate:\(forceImmediate ? "true" : "false")",
      "encryption:\(encodeEncryptionForPayload(encryption))",
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
