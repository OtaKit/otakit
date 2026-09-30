import CryptoKit
import Foundation

/// What the last manifest check decided about a lane's active rollout.
struct RolloutState: Equatable {
  let releaseId: String
  let version: String
  let percent: Int
  let bucket: Int
  let included: Bool

  func toDictionary() -> [String: Any] {
    [
      "releaseId": releaseId,
      "version": version,
      "percent": percent,
      "bucket": bucket,
      "included": included
    ]
  }
}

enum Rollout {
  /// The device's number from 1 to 100 for one rollout. Derived from a secret
  /// that never leaves the device, so it is sticky for that rollout and
  /// independent between rollouts. Must match Rollout.java.
  static func bucket(secret: String, key: String) -> Int {
    let digest = SHA256.hash(data: Data("\(secret):\(key)".utf8))
    let value = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    return Int(value % 100) + 1
  }

  /// The manifest this device should follow: the rolling release when its
  /// bucket is within the percent, otherwise the stable release.
  static func select(
    _ parsed: ParsedManifest,
    secret: String
  ) -> (manifest: LatestManifest, state: RolloutState?) {
    guard let rollout = parsed.rollout else {
      return (parsed.stable, nil)
    }
    let bucket = bucket(secret: secret, key: "rollout:\(rollout.manifest.releaseId)")
    let included = bucket <= rollout.percent
    let state = RolloutState(
      releaseId: rollout.manifest.releaseId,
      version: rollout.manifest.version,
      percent: rollout.percent,
      bucket: bucket,
      included: included
    )
    return (included ? rollout.manifest : parsed.stable, state)
  }
}
