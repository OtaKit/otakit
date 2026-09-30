import Foundation
import XCTest
@testable import UpdaterPlugin

/// Cross-implementation vectors shared with console/lib/manifest-signing.test.ts
/// and RolloutTest.java: the fixture was signed by the server's payload
/// builders, so any drift between the three fails here.
final class RolloutTests: XCTestCase {
  private static let appId = "7bb828f1-797c-4d07-8254-068cac664f69"
  private static let stableReleaseId = "0f5c1f55-9d3a-4a36-9b0e-6d7f2b1c0a01"
  private static let rollingReleaseId = "f32627ca-9e8c-4358-90d8-bde732400081"
  private static let vectorKey = ManifestKey(
    kid: "rollout-test-key",
    derData: Data(base64Encoded: [
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5baepIzUs2xSVqfJIjpzSlW5qPYH7WRp",
      "YKc+GESnncgO+5+a1eEpDet39AAocMdRIM4fM5z+/WGIlQiqeK3LfA=="
    ].joined()) ?? Data()
  )
  private static let manifestJSON = """
    {
      "version": "1.4.1",
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111",
      "size": 123,
      "runtimeVersion": "2026.10",
      "releaseId": "0f5c1f55-9d3a-4a36-9b0e-6d7f2b1c0a01",
      "strategy": "zip",
      "forceImmediate": false,
      "encryption": null,
      "channel": "production",
      "signature": {
        "kid": "rollout-test-key",
        "sig": "MEYCIQDc7L5nYPzyKYIL-42ou9LK5f5QBuP2OMAbDUsQgBZK2QIhAJpFW7IKkiWS3FxXXwfgksWJapHUWzx4us8q_bzn1vMC",
        "iat": 1790000000,
        "exp": 2145916800
      },
      "url": "https://cdn.otakit.app/bundles/stable.zip",
      "rollout": {
        "version": "1.4.2",
        "sha256": "2222222222222222222222222222222222222222222222222222222222222222",
        "size": 130,
        "runtimeVersion": "2026.10",
        "releaseId": "f32627ca-9e8c-4358-90d8-bde732400081",
        "strategy": "zip",
        "forceImmediate": true,
        "encryption": {
          "alg": "A256GCM",
          "kid": "bundle-key",
          "wrapNonce": "d3JhcE5vbmNl",
          "wrappedDek": "d3JhcHBlZERlaw",
          "nonce": "bm9uY2U"
        },
        "percent": 10,
        "stableSha256": "1111111111111111111111111111111111111111111111111111111111111111",
        "signature": {
          "kid": "rollout-test-key",
          "sig": "MEUCIQCotWyY41G-mCIwoYMSpRlbgUC_zCRmVG9TaGNDZ2JdWAIgH4mQtFOVrDjNoXUVZZHYtGey-KA77jTWw2q7n-fI9TU",
          "iat": 1790000000,
          "exp": 2145916800
        },
        "url": "https://cdn.otakit.app/bundles/rolling.zip"
      }
    }
    """

  private func parse(
    _ json: String = RolloutTests.manifestJSON,
    keys: [ManifestKey] = [RolloutTests.vectorKey]
  ) throws -> ParsedManifest {
    try ManifestClient.parse(
      data: Data(json.utf8), appId: Self.appId, channel: "production", manifestKeys: keys
    )
  }

  private func mutateManifest(_ mutation: (inout [String: Any]) -> Void) throws -> String {
    var object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(Self.manifestJSON.utf8)) as? [String: Any]
    )
    mutation(&object)
    let data = try JSONSerialization.data(withJSONObject: object)
    return try XCTUnwrap(String(bytes: data, encoding: .utf8))
  }

  private func mutateRollout(_ mutation: @escaping (inout [String: Any]) -> Void) throws -> String {
    try mutateManifest { object in
      guard var rollout = object["rollout"] as? [String: Any] else { return }
      mutation(&rollout)
      object["rollout"] = rollout
    }
  }

  private struct RejectedBlock {
    let json: String
    let phase: String
    let detail: String
  }

  private struct BucketVector {
    let secret: String
    let key: String
    let bucket: Int
  }

  func testVerifiesServerSignedStableAndRollingReleases() throws {
    let parsed = try parse()

    XCTAssertEqual(parsed.stable.releaseId, Self.stableReleaseId)
    XCTAssertNil(parsed.rolloutFailure)
    let rollout = try XCTUnwrap(parsed.rollout)
    XCTAssertEqual(rollout.percent, 10)
    XCTAssertEqual(rollout.manifest.releaseId, Self.rollingReleaseId)
    XCTAssertEqual(rollout.manifest.version, "1.4.2")
    XCTAssertEqual(rollout.manifest.url, "https://cdn.otakit.app/bundles/rolling.zip")
    XCTAssertTrue(rollout.manifest.forceImmediate)
    XCTAssertEqual(rollout.manifest.encryption?.kid, "bundle-key")
  }

  func testRolloutPayloadMatchesTheServerByteForByte() {
    let lines = ManifestVerifier.bundlePayloadLines(
      appId: Self.appId, channel: "production", version: "1.4.2",
      sha256: String(repeating: "2", count: 64), size: 130, runtimeVersion: "2026.10",
      strategy: "zip", forceImmediate: true,
      encryption: ManifestEncryption(
        alg: "A256GCM", kid: "bundle-key", wrapNonce: "d3JhcE5vbmNl",
        wrappedDek: "d3JhcHBlZERlaw", nonce: "bm9uY2U"
      )
    )
    let payload = ManifestVerifier.buildCanonicalPayload(
      header: "ROLLOUT",
      bundleLines: lines + [
        "percent:10", "releaseId:\(Self.rollingReleaseId)",
        "stableSha256:\(String(repeating: "1", count: 64))", "notesSha256:null"
      ],
      signature: ManifestSignature(kid: "rollout-test-key", sig: "", iat: 1_790_000_000, exp: 2_145_916_800)
    )
    XCTAssertEqual(payload, """
      ROLLOUT
      appId:7bb828f1-797c-4d07-8254-068cac664f69
      channel:production
      version:1.4.2
      sha256:2222222222222222222222222222222222222222222222222222222222222222
      size:130
      runtimeVersion:2026.10
      strategy:zip
      forceImmediate:true
      encryption:A256GCM|bundle-key|d3JhcE5vbmNl|d3JhcHBlZERlaw|bm9uY2U
      percent:10
      releaseId:f32627ca-9e8c-4358-90d8-bde732400081
      stableSha256:1111111111111111111111111111111111111111111111111111111111111111
      notesSha256:null
      kid:rollout-test-key
      iat:1790000000
      exp:2145916800
      """)
  }

  func testInvalidRolloutBlockFallsBackToStableAndReportsWhy() throws {
    let otherSha = String(repeating: "3", count: 64)
    let insecureURL = "http://cdn.otakit.app/bundles/rolling.zip"
    let cases = [
      RejectedBlock(
        json: try mutateRollout { $0["percent"] = 50 },
        phase: "signature", detail: "rollout_signature_invalid"
      ),
      RejectedBlock(
        json: try mutateRollout { $0["releaseId"] = "other" },
        phase: "signature", detail: "rollout_signature_invalid"
      ),
      RejectedBlock(
        json: try mutateRollout { $0["signature"] = nil },
        phase: "signature", detail: "rollout_signature_missing"
      ),
      RejectedBlock(
        json: try mutateRollout { $0["stableSha256"] = otherSha },
        phase: "check", detail: "rollout_invalid"
      ),
      RejectedBlock(json: try mutateRollout { $0["percent"] = 100 }, phase: "check", detail: "rollout_invalid"),
      RejectedBlock(json: try mutateRollout { $0["percent"] = 0 }, phase: "check", detail: "rollout_invalid"),
      RejectedBlock(json: try mutateRollout { $0["percent"] = "10" }, phase: "check", detail: "rollout_invalid"),
      RejectedBlock(json: try mutateRollout { $0["url"] = insecureURL }, phase: "check", detail: "rollout_invalid"),
      RejectedBlock(
        json: try mutateManifest { $0["rollout"] = [$0["rollout"]] },
        phase: "check", detail: "rollout_invalid"
      )
    ]
    for rejected in cases {
      let parsed = try parse(rejected.json)
      XCTAssertEqual(parsed.stable.releaseId, Self.stableReleaseId)
      XCTAssertNil(parsed.rollout, rejected.detail)
      XCTAssertEqual(parsed.rolloutFailure?.phase, rejected.phase, rejected.detail)
      XCTAssertEqual(parsed.rolloutFailure?.detail, rejected.detail)
    }
  }

  func testUnconfiguredKeysSkipVerificationLikeTheTopLevel() throws {
    let parsed = try parse(try mutateRollout { $0["signature"] = nil }, keys: [])
    XCTAssertEqual(parsed.rollout?.percent, 10)
    XCTAssertNil(parsed.rolloutFailure)
  }

  func testTamperedTopLevelStillFailsTheWholeCheck() {
    let json = Self.manifestJSON.replacingOccurrences(of: "\"size\": 123", with: "\"size\": 124")
    XCTAssertNotEqual(json, Self.manifestJSON)
    XCTAssertThrowsError(try parse(json)) { error in
      XCTAssertEqual(CheckFailure.from(error)?.detail, "signature_invalid")
    }
  }

  func testBucketVectorsMatchTheOtherImplementations() {
    let rolling = "rollout:\(Self.rollingReleaseId)"
    let vectors = [
      BucketVector(secret: "00112233445566778899aabbccddeeff", key: rolling, bucket: 7),
      BucketVector(secret: "00112233445566778899aabbccddeeff", key: "rollout:\(Self.stableReleaseId)", bucket: 8),
      BucketVector(secret: "ffeeddccbbaa99887766554433221100", key: rolling, bucket: 32),
      BucketVector(secret: "0123456789abcdef0123456789abcdef", key: "rollout:release-1", bucket: 80),
      BucketVector(secret: String(repeating: "0", count: 30) + "2f", key: rolling, bucket: 10),
      BucketVector(secret: String(repeating: "0", count: 30) + "c0", key: rolling, bucket: 11)
    ]
    for vector in vectors {
      XCTAssertEqual(
        Rollout.bucket(secret: vector.secret, key: vector.key), vector.bucket, "\(vector.secret) \(vector.key)"
      )
    }
  }

  func testSelectsTheRollingReleaseOnlyWithinThePercent() throws {
    let parsed = try parse()

    let inside = Rollout.select(parsed, secret: String(repeating: "0", count: 30) + "2f")
    XCTAssertEqual(inside.manifest.releaseId, Self.rollingReleaseId)
    XCTAssertEqual(
      inside.state,
      RolloutState(releaseId: Self.rollingReleaseId, version: "1.4.2", percent: 10, bucket: 10, included: true)
    )

    let outside = Rollout.select(parsed, secret: String(repeating: "0", count: 30) + "c0")
    XCTAssertEqual(outside.manifest.releaseId, Self.stableReleaseId)
    XCTAssertEqual(outside.state?.bucket, 11)
    XCTAssertEqual(outside.state?.included, false)

    let noRollout = Rollout.select(
      ParsedManifest(stable: parsed.stable, rollout: nil, rolloutFailure: nil), secret: "any"
    )
    XCTAssertEqual(noRollout.manifest.releaseId, Self.stableReleaseId)
    XCTAssertNil(noRollout.state)
  }

  func testBucketsAreUniformAndIndependentBetweenRollouts() {
    let devices = 50_000
    var counts = [Int](repeating: 0, count: 101)
    var inFirst = 0
    var inBoth = 0
    for index in 0..<devices {
      let secret = String(format: "%032x", index)
      let first = Rollout.bucket(secret: secret, key: "rollout:first")
      let second = Rollout.bucket(secret: secret, key: "rollout:second")
      counts[first] += 1
      if first <= 10 { inFirst += 1 }
      if first <= 10 && second <= 10 { inBoth += 1 }
    }
    XCTAssertEqual(counts[0], 0)
    for bucket in 1...100 {
      // 500 expected per bucket; ±5 standard deviations.
      XCTAssertTrue((388...612).contains(counts[bucket]), "bucket \(bucket): \(counts[bucket])")
    }
    XCTAssertTrue((4_750...5_250).contains(inFirst), "\(inFirst)")
    // Independent rollouts share about 10% × 10% of devices, not the same 10%.
    XCTAssertTrue((400...600).contains(inBoth), "\(inBoth)")
  }

  func testAssignmentSecretPersistsPerInstallation() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    let other = try CoordinatorFixture()
    defer { try? other.cleanup() }

    let secret = fixture.store.assignmentSecret()
    XCTAssertEqual(secret.count, 32)
    XCTAssertEqual(fixture.store.assignmentSecret(), secret)
    XCTAssertEqual(fixture.reopenStore().assignmentSecret(), secret)
    XCTAssertNotEqual(other.store.assignmentSecret(), secret)
  }
}
