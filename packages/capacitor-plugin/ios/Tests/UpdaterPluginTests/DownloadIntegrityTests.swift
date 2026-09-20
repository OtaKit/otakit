import Foundation
import XCTest
@testable import UpdaterPlugin

final class DownloadIntegrityTests: XCTestCase {
  func testMismatchIncludesHashesAndByteCountsWithoutPaths() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data([1, 2, 3]).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let expected = String(repeating: "0", count: 64)
    let actual = try HashUtils.sha256(fileURL: file)
    XCTAssertThrowsError(try HashUtils.verifyDownload(fileURL: file, expectedSha256: expected, expectedBytes: 10, kind: "bundle")) { error in
      let detail = error.localizedDescription
      XCTAssertTrue(detail.contains("hash mismatch"))
      XCTAssertTrue(detail.contains("expectedSha256=\(expected)"))
      XCTAssertTrue(detail.contains("actualSha256=\(actual)"))
      XCTAssertTrue(detail.contains("expectedBytes=10; receivedBytes=3"))
      XCTAssertFalse(detail.contains(file.path))
      XCTAssertLessThan(detail.count, 500)
    }
  }
  func testSizeMismatchFailsEvenWithMatchingHash() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data([1, 2, 3]).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let hash = try HashUtils.sha256(fileURL: file)
    XCTAssertThrowsError(try HashUtils.verifyDownload(fileURL: file, expectedSha256: hash, expectedBytes: 4, kind: "bundle"))
    try HashUtils.verifyDownload(fileURL: file, expectedSha256: hash.uppercased(), expectedBytes: 3, kind: "bundle")
    try HashUtils.verifyDownload(fileURL: file, expectedSha256: hash, expectedBytes: nil, kind: "bundle")
  }
  func testInvalidExpectedHashIsRedacted() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data([1, 2, 3]).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    XCTAssertThrowsError(try HashUtils.verifyDownload(fileURL: file, expectedSha256: "https://secret.test?token=secret", expectedBytes: nil, kind: "bundle")) { error in
      XCTAssertTrue(error.localizedDescription.contains("expectedSha256=invalid"))
      XCTAssertFalse(error.localizedDescription.contains("secret"))
    }
  }
}
