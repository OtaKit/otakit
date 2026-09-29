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
      header: "MANIFEST",
      bundleLines: bundlePayloadLines(
        appId: appId,
        channel: channel,
        version: version,
        sha256: sha256,
        size: size,
        runtimeVersion: runtimeVersion,
        strategy: strategy,
        forceImmediate: forceImmediate,
        encryption: encryption
      ),
      signature: signature
    )
    try verifyCanonicalPayload(payload, signature: signature, trustedKeys: trustedKeys)
  }

  /// Verify a manifest's `rollout` block (plugin 3.1+). Same key and format
  /// as the top level under its own header, plus the rollout lines; must
  /// match the server's `buildRolloutPayload` byte-for-byte.
  static func verifyRollout(
    appId: String,
    channel: String?,
    rollout: ManifestRollout,
    stableSha256: String,
    signature: ManifestSignature,
    trustedKeys: [ManifestKey]
  ) throws {
    let manifest = rollout.manifest
    let payload = buildCanonicalPayload(
      header: "ROLLOUT",
      bundleLines: bundlePayloadLines(
        appId: appId,
        channel: channel,
        version: manifest.version,
        sha256: manifest.sha256,
        size: manifest.size,
        runtimeVersion: manifest.runtimeVersion,
        strategy: manifest.strategy,
        forceImmediate: manifest.forceImmediate,
        encryption: manifest.encryption
      ) + [
        "percent:\(rollout.percent)",
        "releaseId:\(manifest.releaseId)",
        "stableSha256:\(stableSha256)",
        "notesSha256:null"
      ],
      signature: signature
    )
    try verifyCanonicalPayload(payload, signature: signature, trustedKeys: trustedKeys)
  }

  private static func verifyCanonicalPayload(
    _ payload: String,
    signature: ManifestSignature,
    trustedKeys: [ManifestKey]
  ) throws {
    do {
      try verifyPayload(payload, signature: signature, trustedKeys: trustedKeys)
    } catch let error as ManifestVerifierError {
      throw error
    } catch {
      throw ManifestVerifierError.invalidSignature
    }
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
  /// / `buildRolloutPayload` (console/lib/manifest-signing.ts) and the
  /// Android mirror byte-for-byte.
  static func buildCanonicalPayload(
    header: String,
    bundleLines: [String],
    signature: ManifestSignature
  ) -> String {
    return ([header] + bundleLines + [
      "kid:\(signature.kid)",
      "iat:\(signature.iat)",
      "exp:\(signature.exp)"
    ]).joined(separator: "\n")
  }

  static func bundlePayloadLines(
    appId: String,
    channel: String?,
    version: String,
    sha256: String,
    size: Int,
    runtimeVersion: String?,
    strategy: String,
    forceImmediate: Bool,
    encryption: ManifestEncryption?
  ) -> [String] {
    return [
      "appId:\(appId)",
      "channel:\(channel ?? "null")",
      "version:\(version)",
      "sha256:\(sha256)",
      "size:\(size)",
      "runtimeVersion:\(runtimeVersion ?? "null")",
      "strategy:\(strategy)",
      "forceImmediate:\(forceImmediate ? "true" : "false")",
      "encryption:\(encodeEncryptionForPayload(encryption))"
    ]
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
