import Foundation
import XCTest
@testable import UpdaterPlugin

final class ManifestKeyConfigTests: XCTestCase {
  func testMalformedExplicitConfigRejectsUnsignedHTTPManifest() async throws {
    let body = Data(#"{"version":"1.0","sha256":"hash","size":1,"releaseId":"release-a","url":"https://example.test/bundle.zip"}"#.utf8)
    let server = try DownloadHTTPServer(responses: [.init(status: 200, retryAfter: nil, body: body, advertisedLength: body.count)])
    let url = try await server.start()
    defer { server.stop() }
    // Intentional self-hosted unsigned mode remains available without explicit keys.
    let unsigned = try await ManifestClient.fetchLatest(cdnUrl: url.absoluteString, appId: "app",
      channel: nil, runtimeVersion: nil, allowInsecureUrls: true)
    XCTAssertNotNil(unsigned)
    let keys = ManifestKeyConfig.parse(["manifestKeys": "mistyped"]).map { ManifestKey(kid: $0.kid, derData: $0.key) }
    do {
      _ = try await ManifestClient.fetchLatest(cdnUrl: url.absoluteString, appId: "app",
        channel: nil, runtimeVersion: nil, allowInsecureUrls: true, manifestKeys: keys)
      XCTFail("Malformed explicit keys must not accept an unsigned update")
    } catch ManifestVerifierError.missingSignature {} // Expected fail-closed result.
    XCTAssertEqual(server.requestCount, 2)
  }

  func testWrongTypeCannotSilentlyDisableVerification() {
    for value: Any in ["mistyped", [String: String](), 123, true, NSNull()] {
      XCTAssertFalse(ManifestKeyConfig.parse(["manifestKeys": value]).isEmpty, "\(value)")
    }
  }

  func testAbsentAndEmptyRetainIntentionalDefaults() {
    XCTAssertTrue(ManifestKeyConfig.parse([:]).isEmpty)
    XCTAssertTrue(ManifestKeyConfig.parse(["manifestKeys": [Any]()]).isEmpty)
  }

  func testMalformedEntriesRemainFailClosed() {
    for value: Any in [[[:]], [123], [["kid": "key"]]] {
      XCTAssertFalse(ManifestKeyConfig.parse(["manifestKeys": value]).isEmpty)
    }
  }

  func testValidConfiguredKeyIsPreserved() throws {
    let key = try XCTUnwrap(HostedManifestKeys.defaults.first)
    let parsed = ManifestKeyConfig.parse(["manifestKeys": [["kid": key.kid, "key": key.key.base64EncodedString()]]])
    XCTAssertEqual(parsed.count, 1)
    XCTAssertEqual(parsed.first?.kid, key.kid)
    XCTAssertEqual(parsed.first?.key, key.key)
  }
}
