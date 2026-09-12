import CryptoKit
import Foundation

public struct RNManifest: Codable {
  public struct Encryption: Codable {
    public let alg: String
    public let kid: String
    public let wrapNonce: String
    public let wrappedDek: String
    public let nonce: String
  }
  public struct Signature: Codable {
    public let kid: String
    public let sig: String
    public let iat: Int64
    public let exp: Int64
  }
  public struct File: Codable {
    public let path: String
    public let sha256: String
    public let size: Int64
    public let url: String
  }
  public let schemaVersion: Int
  public let appId: String
  public let framework: String
  public let platform: String
  public let channel: String?
  public let version: String
  public let sha256: String
  public let contentHash: String
  public let size: Int64
  public let runtimeVersion: String
  public let strategy: String
  public let forceImmediate: Bool
  public let encryption: Encryption?
  public let releaseId: String
  public let signature: Signature
  public let url: String?
  public let files: [File]?

  public func canonicalPayload() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let channelValue =
      channel == nil ? "null" : String(data: try encoder.encode(channel!), encoding: .utf8)!
    let encryptionValue =
      encryption.map { "\($0.alg)|\($0.kid)|\($0.wrapNonce)|\($0.wrappedDek)|\($0.nonce)" }
      ?? "null"
    return Data(
      [
        "MANIFEST:3", "appId:\(appId)", "framework:\(framework)", "platform:\(platform)",
        "channel:\(channelValue)",
        "version:\(version)", "sha256:\(sha256)", "contentHash:\(contentHash)", "size:\(size)",
        "runtimeVersion:\(runtimeVersion)",
        "strategy:\(strategy)", "forceImmediate:\(forceImmediate ? "true" : "false")",
        "encryption:\(encryptionValue)",
        "releaseId:\(releaseId)", "kid:\(signature.kid)", "iat:\(signature.iat)",
        "exp:\(signature.exp)",
      ].joined(separator: "\n").utf8)
  }

  public static func verify(
    data: Data, builtin: Artifact, channel: String?, keys: [String: Data], now: Int64,
    allowExpiredCache: Bool = false
  ) throws -> RNManifest {
    guard data.count <= 4 * 1024 * 1024,
      let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      raw.keys.contains("channel"), raw.keys.contains("encryption")
    else { throw LaunchError.incompatibleArtifact }
    let manifest = try JSONDecoder().decode(RNManifest.self, from: data)
    guard
      manifest.schemaVersion == 3 && manifest.framework == "react-native"
        && manifest.platform == builtin.platform && manifest.appId == builtin.appId
        && manifest.runtimeVersion == builtin.runtimeVersion && manifest.channel == channel
        && manifest.size > 0 && manifest.size <= 100 * 1024 * 1024
        && matches(manifest.sha256, "^[a-f0-9]{64}$")
        && matches(manifest.contentHash, "^[a-f0-9]{64}$") && !manifest.version.isEmpty
        && manifest.version.utf16.count <= 64
        && !manifest.version.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
        && (channel == nil || matches(channel!, "^[A-Za-z0-9._-]{1,64}$"))
        && manifest.signature.iat <= now + 300
        && (allowExpiredCache || manifest.signature.exp > now)
        && manifest.signature.exp > manifest.signature.iat
        && ["zip", "deltas"].contains(manifest.strategy),
      let key = keys[manifest.signature.kid]
    else { throw LaunchError.incompatibleArtifact }
    if let encryption = manifest.encryption {
      guard manifest.strategy == "zip", encryption.alg == "AES-256-GCM",
        matches(encryption.kid, "^[a-f0-9]{16}$"),
        Data(base64Encoded: encryption.wrapNonce)?.count == 12,
        Data(base64Encoded: encryption.nonce)?.count == 12,
        Data(base64Encoded: encryption.wrappedDek)?.count == 48
      else { throw LaunchError.incompatibleArtifact }
    }
    if manifest.strategy == "deltas" {
      guard manifest.sha256 == manifest.contentHash, let files = manifest.files,
        files.count >= 2 && files.count <= 5000
      else { throw LaunchError.incompatibleArtifact }
    }
    let publicKey = try P256.Signing.PublicKey(derRepresentation: key)
    let signature = try P256.Signing.ECDSASignature(
      derRepresentation: decodeURLBase64(manifest.signature.sig))
    guard publicKey.isValidSignature(signature, for: try manifest.canonicalPayload()) else {
      throw LaunchError.incompatibleArtifact
    }
    return manifest
  }

  private static func matches(_ value: String, _ expression: String) -> Bool {
    value.range(of: expression, options: .regularExpression) != nil
  }
  private static func decodeURLBase64(_ value: String) throws -> Data {
    let base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    guard
      let data = Data(
        base64Encoded: base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4))
    else { throw LaunchError.incompatibleArtifact }
    return data
  }
}
