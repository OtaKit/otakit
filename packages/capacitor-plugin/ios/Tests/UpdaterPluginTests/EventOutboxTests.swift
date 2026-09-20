import Foundation
import XCTest
@testable import UpdaterPlugin

final class EventOutboxTests: XCTestCase {
  private var directory: URL!
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }
  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
  private func body(_ id: String) throws -> Data {
    try JSONSerialization.data(withJSONObject: ["eventId": id, "sentAt": "2026-09-20T12:00:00Z", "action": "applied"], options: .sortedKeys)
  }
  private func enqueue(_ queue: EventOutbox, _ id: String, _ now: TimeInterval = 0) throws {
    try queue.enqueue(url: URL(string: "https://ingest.example/events")!, appId: "app-a", body: body(id), now: now)
  }
  func testRestartAndLostResponsePreserveOriginalIdentityAndBody() throws {
    let queue = try EventOutbox(directory: directory)
    try enqueue(queue, "original-id", 1)
    try queue.complete(id: "original-id", status: 0, retryAfter: nil, now: 1, random: 0.5)
    let reopened = try EventOutbox(directory: directory)
    XCTAssertNil(try reopened.ready(now: 5.999))
    let retry = try XCTUnwrap(reopened.ready(now: 6))
    XCTAssertEqual(retry.id, "original-id")
    XCTAssertEqual(retry.body, try body("original-id"))
    XCTAssertEqual(retry.appId, "app-a")
    XCTAssertEqual(retry.attempts, 1)
    try reopened.complete(id: retry.id, status: 202, retryAfter: nil, now: 6, random: 0.5)
    XCTAssertNil(try EventOutbox(directory: directory).ready(now: 6))
  }
  func testRateLimitSurvivesRestartAndDoesNotBlockOtherEvents() throws {
    let queue = try EventOutbox(directory: directory)
    try enqueue(queue, "limited", 1)
    try queue.complete(id: "limited", status: 429, retryAfter: "120", now: 1, random: 0.5)
    try enqueue(queue, "other", 2)
    let reopened = try EventOutbox(directory: directory)
    XCTAssertEqual(try reopened.ready(now: 2)?.id, "other")
    try reopened.complete(id: "other", status: 200, retryAfter: nil, now: 2, random: 0.5)
    XCTAssertNil(try reopened.ready(now: 120.999))
    XCTAssertEqual(try reopened.ready(now: 121)?.id, "limited")
  }
  func testPermanentRejectionIsDroppedAndServerFailuresRetry() throws {
    let queue = try EventOutbox(directory: directory)
    try enqueue(queue, "invalid")
    try queue.complete(id: "invalid", status: 400, retryAfter: nil, now: 0, random: 0.5)
    XCTAssertNil(queue.wait(now: 0))
    for status in [408, 425, 429, 500, 502, 503, 504] {
      try enqueue(queue, "retry-\(status)")
      try queue.complete(id: "retry-\(status)", status: status, retryAfter: nil, now: 0, random: 0.5)
    }
    XCTAssertNil(try queue.ready(now: 4.999))
    XCTAssertNotNil(try queue.ready(now: 5))
  }
  func testQueueIsBoundedAndExpiresWithoutRetryingLongDelayEarly() throws {
    let queue = try EventOutbox(directory: directory)
    for index in 0...EventOutbox.limit { try enqueue(queue, "event-\(index)") }
    XCTAssertEqual(try queue.ready(now: 0)?.id, "event-1")
    try queue.complete(id: "event-1", status: 429, retryAfter: String(repeating: "9", count: 500), now: 0, random: 0.5)
    XCTAssertEqual(try queue.ready(now: 0)?.id, "event-2")
    XCTAssertNil(try queue.ready(now: EventOutbox.ttl))
    XCTAssertNil(queue.wait(now: EventOutbox.ttl))
  }
  func testFailedSaveKeepsUnacknowledgedEventInMemoryAndOnDisk() throws {
    let queue = try EventOutbox(directory: directory)
    try enqueue(queue, "keep")
    let file = directory.appendingPathComponent("events.json")
    let original = try Data(contentsOf: file)
    let backup = directory.appendingPathComponent("backup.json")
    try FileManager.default.moveItem(at: file, to: backup)
    try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
    try Data([1]).write(to: file.appendingPathComponent("block"))
    XCTAssertThrowsError(try queue.complete(id: "keep", status: 200, retryAfter: nil, now: 0, random: 0.5))
    XCTAssertEqual(try queue.ready(now: 0)?.id, "keep")
    try FileManager.default.removeItem(at: file)
    try FileManager.default.moveItem(at: backup, to: file)
    XCTAssertEqual(try Data(contentsOf: file), original)
    XCTAssertEqual(try EventOutbox(directory: directory).ready(now: 0)?.id, "keep")
  }
  func testCorruptJSONDoesNotPermanentlyDisableDelivery() throws {
    _ = try EventOutbox(directory: directory)
    try Data("{".utf8).write(to: directory.appendingPathComponent("events.json"))
    let queue = try EventOutbox(directory: directory)
    try enqueue(queue, "new")
    XCTAssertEqual(try EventOutbox(directory: directory).ready(now: 0)?.id, "new")
  }
}
