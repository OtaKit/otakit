import XCTest

@testable import OtaKitUpdaterCore

final class ManifestTests: XCTestCase {
  func testSharedV3FixtureAndTargetTampering() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    let fixture =
      try JSONSerialization.jsonObject(
        with: Data(contentsOf: root.appendingPathComponent("fixtures/manifest-v3.json")))
      as! [String: Any]
    var manifest = fixture["manifest"] as! [String: Any]
    let builtin = Artifact(
      appId: "app-1", platform: "ios", runtimeVersion: String(repeating: "A", count: 43),
      contentHash: "builtin", version: "builtin", bundlePath: "/embedded")
    let keys = ["fixture": Data(base64Encoded: fixture["publicKey"] as! String)!]
    let parsed = try RNManifest.verify(
      data: JSONSerialization.data(withJSONObject: manifest), builtin: builtin, channel: nil,
      keys: keys, now: 1001)
    XCTAssertEqual(
      String(data: try parsed.canonicalPayload(), encoding: .utf8), fixture["canonical"] as? String)
    manifest["releaseId"] = "tampered"
    XCTAssertThrowsError(
      try RNManifest.verify(
        data: JSONSerialization.data(withJSONObject: manifest), builtin: builtin, channel: nil,
        keys: keys, now: 1001))
    manifest = fixture["manifest"] as! [String: Any]
    manifest["schemaVersion"] = 2
    XCTAssertThrowsError(
      try RNManifest.verify(
        data: JSONSerialization.data(withJSONObject: manifest), builtin: builtin, channel: nil,
        keys: keys, now: 1001))
  }
}
