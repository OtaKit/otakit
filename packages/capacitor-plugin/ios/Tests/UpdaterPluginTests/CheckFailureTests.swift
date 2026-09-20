import Foundation
import XCTest
@testable import UpdaterPlugin

final class CheckFailureTests: XCTestCase {
  func testFailedCheckIsReportedOnceAndStillThrowsOriginalError() async throws {
    var reports: [CheckFailure] = []
    let original = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut,
      userInfo: [NSLocalizedDescriptionKey: "https://secret.test?token=secret"])
    do {
      let _: String = try await CheckFailure.observe({ throw original }, report: { reports.append($0) })
      XCTFail("Expected original error")
    } catch { XCTAssertTrue((error as NSError) === original) }
    XCTAssertEqual(reports.count, 1)
    XCTAssertEqual(reports.first?.phase, "check")
    XCTAssertEqual(reports.first?.detail, "manifest_network_\(NSURLErrorTimedOut)")
    XCTAssertFalse(reports[0].detail.contains("secret"))
  }
  func testSuccessfulNoUpdateAndCancellationDoNotEmitErrors() async throws {
    var reports: [CheckFailure] = []
    let result: String? = try await CheckFailure.observe({ nil }, report: { reports.append($0) })
    XCTAssertNil(result)
    let manifest = try await CheckFailure.observe({ "manifest" }, report: { reports.append($0) })
    XCTAssertEqual(manifest, "manifest")
    do {
      let _: String = try await CheckFailure.observe({ throw CancellationError() }, report: { reports.append($0) })
      XCTFail("Expected cancellation")
    } catch { XCTAssertTrue(error is CancellationError) }
    XCTAssertTrue(reports.isEmpty)
    XCTAssertNil(CheckFailure.from(URLError(.cancelled)))
  }
  func testHTTPFailureIncludesOnlyStatus() {
    let error = CheckFailure.from(ManifestClientError.httpStatus(503))
    XCTAssertEqual(error?.detail, "manifest_http_503")
    XCTAssertEqual(error?.phase, "check")
  }
  func testRealVerifierExpiryAndUnknownKeyRemainTerminalAndAreDistinguishable() async throws {
    for expired in [true, false] {
      var reports: [CheckFailure] = []
      let signature = ManifestSignature(kid: "private-key-label", sig: "invalid-signature", iat: 0,
        exp: expired ? 0 : Int(Date().timeIntervalSince1970) + 600)
      do {
        try await CheckFailure.observe({
          try ManifestVerifier.verify(appId: "app-a", channel: nil, version: "1.0", sha256: "hash", size: 1,
            runtimeVersion: nil, strategy: "zip", forceImmediate: false, encryption: nil, signature: signature, trustedKeys: [])
        }, report: { reports.append($0) })
        XCTFail("Invalid signature accepted")
      } catch { XCTAssertTrue(error is ManifestVerifierError) }
      XCTAssertEqual(reports.count, 1)
      XCTAssertEqual(reports.first?.phase, "signature")
      XCTAssertEqual(reports.first?.detail, expired ? "signature_expired" : "signature_unknown_key")
      XCTAssertFalse(reports[0].detail.contains("private-key-label"))
    }
  }
}
