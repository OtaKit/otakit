import Foundation
import XCTest
@testable import UpdaterPlugin

/// Release notes (plugin 3.3+). The vector is shared with
/// console/lib/manifest-signing.test.ts and ReleaseNotesTest.java: a complete
/// manifest whose top level, rollout block and both notes blocks are signed.
final class ReleaseNotesTests: XCTestCase {
  private static let appId = "7bb828f1-797c-4d07-8254-068cac664f69"
  private static let vectorKey = ManifestKey(
    kid: "notes-test-key",
    derData: Data(base64Encoded:
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkGEUgoH9yaIEaWpJltHsu43ogX"
        + "XdRAwdqNSnw+m14d4Q10mwUUcQ2QFiwHzwQjShpvlC8pY70jK8EnLGPt3JTA=="
    )!
  )
  private static let stableNotes = "Faster checkout.\nPhotos load 2× faster on Android.\tMerci, café 🚀"
  private static let manifestJSON = #"""
{
  "version": "1.5.0",
  "sha256": "3333333333333333333333333333333333333333333333333333333333333333",
  "size": 140,
  "runtimeVersion": "2026.10",
  "strategy": "zip",
  "forceImmediate": false,
  "encryption": null,
  "releaseId": "5b0e3c1a-6c4f-4b7e-9a1d-2f8e7c6b5a40",
  "channel": "production",
  "signature": {
    "kid": "notes-test-key",
    "sig": "MEYCIQCpkHRddZEHgnEqyvFAP6v0ybbmKeQsGg4-rb30M2QlUQIhAMckbYBJoixOBz3a2oUIITMePtWZx_Cl1tDnXaestZ5l",
    "iat": 1790000000,
    "exp": 2145916800
  },
  "url": "https://cdn.otakit.app/bundles/notes-stable.zip",
  "notes": {
    "text": "Faster checkout.\nPhotos load 2× faster on Android.\tMerci, café 🚀",
    "signature": {
      "kid": "notes-test-key",
      "sig": "MEQCICV24IsfkI_axwR-xKFTRi6RMNhdJM3onk3x-leodaiSAiAvR6ki-Cr6h1a7BJqq_3P8I-jtKpwoEHUSHoUQ6tequQ",
      "iat": 1790000000,
      "exp": 2145916800
    }
  },
  "rollout": {
    "version": "1.5.1",
    "sha256": "4444444444444444444444444444444444444444444444444444444444444444",
    "size": 150,
    "runtimeVersion": "2026.10",
    "strategy": "zip",
    "forceImmediate": false,
    "encryption": null,
    "releaseId": "c2d4e6f8-1a3b-4c5d-8e7f-90a1b2c3d4e5",
    "percent": 20,
    "stableSha256": "3333333333333333333333333333333333333333333333333333333333333333",
    "signature": {
      "kid": "notes-test-key",
      "sig": "MEYCIQDqwD5jJLq9Hsp_6JDncZVBcL7drlYB8mqV6-35ID3JJgIhAJmcp1lUYSPO6SFb6EP6ISd6ij834dym1-fAwzoHznC2",
      "iat": 1790000000,
      "exp": 2145916800
    },
    "url": "https://cdn.otakit.app/bundles/notes-rolling.zip",
    "notes": {
      "text": "Beta: new home screen",
      "signature": {
        "kid": "notes-test-key",
        "sig": "MEYCIQD9N9zyNPpXZvpTgKOFEXrPjsThpU3AxPznEWWJKctVhQIhAM-1u2T8Q0JEelCPmND6Zp9Lpnclw4O3xgd0ktxL3CO9",
        "iat": 1790000000,
        "exp": 2145916800
      }
    }
  }
}
"""#

  private func parse(
    _ json: String = ReleaseNotesTests.manifestJSON,
    keys: [ManifestKey] = [ReleaseNotesTests.vectorKey]
  ) throws -> ParsedManifest {
    try ManifestClient.parse(
      data: Data(json.utf8), appId: Self.appId, channel: "production", manifestKeys: keys
    )
  }

  private func mutate(_ mutation: (inout [String: Any]) throws -> Void) throws -> String {
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(Self.manifestJSON.utf8)) as? [String: Any]
    )
    try mutation(&object)
    let data = try JSONSerialization.data(withJSONObject: object)
    return try XCTUnwrap(String(bytes: data, encoding: .utf8))
  }

  func testVerifiesNotesOfTheStableAndRollingReleases() throws {
    let parsed = try parse()
    XCTAssertEqual(parsed.stable.notes, Self.stableNotes)
    XCTAssertEqual(parsed.rollout?.manifest.notes, "Beta: new home screen")
  }

  func testHashesTheTextLikeTheServer() {
    XCTAssertEqual(
      ManifestVerifier.sha256Hex(Self.stableNotes),
      "d7b1791bd8bae54cc46a8a2d0190ef41061c8e1002db1f9b0ca2a707886e2c54"
    )
  }

  func testDropsNotesThatDoNotVerifyButKeepsTheUpdate() throws {
    let edited = try mutate { object in
      var notes = try XCTUnwrap(object["notes"] as? [String: Any])
      notes["text"] = "Edited in transit"
      object["notes"] = notes
    }
    let unsigned = try mutate { object in
      var notes = try XCTUnwrap(object["notes"] as? [String: Any])
      notes["signature"] = NSNull()
      object["notes"] = notes
    }
    // The stable release's notes copied into the rollout block: bound to another release.
    let moved = try mutate { object in
      var rollout = try XCTUnwrap(object["rollout"] as? [String: Any])
      rollout["notes"] = object["notes"]
      object["rollout"] = rollout
    }

    for json in [edited, unsigned] {
      let parsed = try parse(json)
      XCTAssertEqual(parsed.stable.version, "1.5.0")
      XCTAssertNil(parsed.stable.notes)
      XCTAssertEqual(parsed.rollout?.manifest.notes, "Beta: new home screen")
    }
    let parsed = try parse(moved)
    XCTAssertEqual(parsed.stable.notes, Self.stableNotes)
    XCTAssertNotNil(parsed.rollout)
    XCTAssertNil(parsed.rollout?.manifest.notes)
  }

  func testAcceptsNotesWithoutConfiguredKeys() throws {
    let parsed = try parse(keys: [])
    XCTAssertEqual(parsed.stable.notes, Self.stableNotes)
  }

  func testIgnoresMissingOrEmptyNotes() throws {
    let none = try mutate { $0.removeValue(forKey: "notes") }
    let empty = try mutate { object in
      var notes = try XCTUnwrap(object["notes"] as? [String: Any])
      notes["text"] = ""
      object["notes"] = notes
    }
    XCTAssertNil(try parse(none).stable.notes)
    XCTAssertNil(try parse(empty).stable.notes)
  }

  func testBundleRecordsKeepNotesAndOldRecordsStillDecode() throws {
    let bundle = BundleInfo(
      id: "bundle-1", version: "1.5.0", runtimeVersion: nil, status: .pending,
      downloadedAt: nil, sha256: "hash", path: nil, channel: "production",
      releaseId: "release-1", notes: "Faster checkout."
    )
    let decoded = try JSONDecoder().decode(BundleInfo.self, from: JSONEncoder().encode(bundle))
    XCTAssertEqual(decoded.notes, "Faster checkout.")
    XCTAssertEqual(bundle.withStatus(.success).notes, "Faster checkout.")
    XCTAssertEqual(bundle.toDictionary()["notes"] as? String, "Faster checkout.")

    let legacy = #"{"id":"bundle-0","version":"1.0.0","status":"success"}"#
    XCTAssertNil(try JSONDecoder().decode(BundleInfo.self, from: Data(legacy.utf8)).notes)
  }

  func testRemembersSeenReleasesAndKeepsTheNewestTwenty() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    XCTAssertFalse(fixture.store.isReleaseNotesSeen("release-1"))
    fixture.store.markReleaseNotesSeen("release-1")
    XCTAssertTrue(fixture.reopenStore().isReleaseNotesSeen("release-1"))

    for index in 2...21 {
      fixture.store.markReleaseNotesSeen("release-\(index)")
    }
    let store = fixture.reopenStore()
    XCTAssertFalse(store.isReleaseNotesSeen("release-1"))
    XCTAssertTrue(store.isReleaseNotesSeen("release-2"))
    XCTAssertTrue(store.isReleaseNotesSeen("release-21"))
  }
}
