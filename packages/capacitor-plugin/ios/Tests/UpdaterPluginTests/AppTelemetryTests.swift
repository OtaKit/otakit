import Foundation
import XCTest
@testable import UpdaterPlugin

final class AppTelemetryTests: XCTestCase {
  private let context: [String: Any] = [
    "platform": "ios", "sessionId": "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f", "bundleVersion": "1.0.0",
    "nativeBuild": "42", "osVersion": "18.2", "sdkVersion": "3.4.0",
  ]

  private func item(_ index: Int, stack: Int = 100) -> [String: Any] {
    ["kind": "error", "eventId": UUID().uuidString.lowercased(), "name": "TypeError",
     "message": "boom \(index)", "stack": String(repeating: "s", count: stack), "handled": false]
  }

  func testWrapsItemsInBatchesWithTheDeviceContext() throws {
    var ids = 0
    let result = AppTelemetryClient.batches(
      items: [item(1), item(2)], context: context,
      now: Date(timeIntervalSince1970: 1_760_000_000), makeId: { ids += 1; return "batch-\(ids)" })
    XCTAssertEqual(result.itemCounts, [2])
    XCTAssertEqual(result.dropped, 0)
    let batch = try XCTUnwrap(JSONSerialization.jsonObject(with: result.bodies[0]) as? [String: Any])
    XCTAssertEqual(batch["batchId"] as? String, "batch-1")
    XCTAssertEqual(batch["sentAt"] as? String, "2025-10-09T08:53:20.000Z")
    XCTAssertEqual((batch["context"] as? [String: Any])?["sessionId"] as? String, context["sessionId"] as? String)
    let items = try XCTUnwrap(batch["items"] as? [[String: Any]])
    XCTAssertEqual(items.map { $0["message"] as? String }, ["boom 1", "boom 2"])
    XCTAssertEqual(items[0]["handled"] as? Bool, false)
  }

  func testSplitsByCountAndSizeAndDropsInvalidItems() {
    let many = (0..<120).map { item($0) }
    XCTAssertEqual(AppTelemetryClient.batches(items: many, context: context).itemCounts, [50, 50, 20])

    let large = (0..<10).map { item($0, stack: 15_000) }
    let sized = AppTelemetryClient.batches(items: large, context: context)
    XCTAssertEqual(sized.itemCounts.reduce(0, +), 10)
    XCTAssertTrue(sized.itemCounts.count >= 3)
    for body in sized.bodies { XCTAssertLessThanOrEqual(body.count, 64 * 1024) }

    let invalid: [Any] = ["text", ["name": "no kind"], ["kind": 1], item(1, stack: 17_000), item(2)]
    let filtered = AppTelemetryClient.batches(items: invalid, context: context)
    XCTAssertEqual(filtered.itemCounts, [1])
    XCTAssertEqual(filtered.dropped, 4)
  }

  func testTelemetryOutboxIsSeparateAndBounded() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let telemetry = try EventOutbox(directory: directory, limits: .appTelemetry)
    let events = try EventOutbox(directory: directory)
    let url = URL(string: "https://ingest.example/v1/app-telemetry")!
    for index in 0...EventOutbox.Limits.appTelemetry.count {
      let body = try JSONSerialization.data(withJSONObject: ["batchId": "batch-\(index)", "items": []])
      try telemetry.enqueue(url: url, appId: "app-a", body: body, now: 0)
    }
    let eventBody = try JSONSerialization.data(withJSONObject: ["eventId": "event-1", "action": "applied"])
    try events.enqueue(url: url, appId: "app-a", body: eventBody, now: 0)

    // The oldest batch was evicted; OTA events live in their own file.
    let reopened = try EventOutbox(directory: directory, limits: .appTelemetry)
    let first = try XCTUnwrap(try reopened.ready(now: 0))
    XCTAssertEqual(first.id, "batch-1")
    XCTAssertEqual(try EventOutbox(directory: directory).ready(now: 0)?.id, "event-1")
    // Kept three days, then dropped without delivery.
    XCTAssertNil(try reopened.ready(now: EventOutbox.Limits.appTelemetry.ttl))

    let tooLarge = Data(repeating: 0x20, count: 64 * 1024 + 1)
    XCTAssertThrowsError(try telemetry.enqueue(url: url, appId: "app-a", body: tooLarge, now: 0))
  }

  private func event(_ index: Int) -> [String: Any] {
    ["kind": "event", "eventId": UUID().uuidString.lowercased(), "name": "tap_\(index)", "properties": [:]]
  }

  func testErrorsAndEventsGoInSeparateBatches() {
    let result = AppTelemetryClient.batches(
      items: [item(1), event(1), event(2), item(2)], context: context)
    XCTAssertEqual(result.itemCounts, [1, 2, 1])
    XCTAssertEqual(result.lanes, [.error, .event, .error])
  }

  private func batchItems(_ entry: EventOutbox.Entry?) throws -> [[String: Any]] {
    let body = try XCTUnwrap(entry?.body)
    let batch = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
    return try XCTUnwrap(batch["items"] as? [[String: Any]])
  }

  func testPendingBatchesTakeInItemsOfTheSameKindAndContext() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let outbox = try EventOutbox(directory: directory, limits: .appTelemetry)
    let url = URL(string: "https://ingest.example/v1/app-telemetry")!
    func add(_ items: [Any], context: [String: Any]? = nil, now: TimeInterval = 0) throws {
      let ctx = context ?? self.context
      let batches = AppTelemetryClient.batches(items: items, context: ctx)
      for index in batches.bodies.indices {
        let lane = batches.lanes[index]
        try outbox.enqueue(
          url: url, appId: "app-a", body: batches.bodies[index], now: now, priority: lane.priority,
          mergeKey: AppTelemetryClient.mergeKey(lane: lane, context: ctx),
          merge: AppTelemetryClient.mergeBatches)
      }
    }
    try add([event(1)])
    try add([event(2), event(3)], now: 10)
    let first = try XCTUnwrap(outbox.ready(now: 10))
    XCTAssertEqual(try batchItems(first).map { $0["name"] as? String }, ["tap_1", "tap_2", "tap_3"])
    // The batch being delivered keeps its body; new items start a new batch.
    try add([event(4)], now: 11)
    try outbox.complete(id: first.id, status: 202, retryAfter: nil, now: 12, random: 0.5)
    let second = try XCTUnwrap(outbox.ready(now: 12))
    XCTAssertEqual(try batchItems(second).map { $0["name"] as? String }, ["tap_4"])
    try outbox.complete(id: second.id, status: 500, retryAfter: nil, now: 12, random: 0.5)
    // A batch waiting for a retry takes in new items; errors and other contexts do not join it.
    try add([event(5)], now: 13)
    try add([item(1)], now: 14)
    var otherContext = context
    otherContext["sessionId"] = "another-launch"
    try add([event(6)], context: otherContext, now: 15)
    // Over an hour later, or over 50 items, a new batch starts.
    try add([event(7)], context: otherContext, now: 15 + EventOutbox.mergeWindow)
    try add((0..<50).map { event(100 + $0) }, context: otherContext, now: 16 + EventOutbox.mergeWindow)
    let reopened = try EventOutbox(directory: directory, limits: .appTelemetry)
    var names: [[String]] = []
    var now: TimeInterval = 10_000
    while let entry = try reopened.ready(now: now) {
      names.append(try batchItems(entry).map { ($0["name"] as? String) ?? "" })
      try reopened.complete(id: entry.id, status: 202, retryAfter: nil, now: now, random: 0.5)
      now += 1
    }
    XCTAssertEqual(names.map { $0.count }, [2, 1, 1, 1, 50])
    XCTAssertEqual(names[0], ["tap_4", "tap_5"])
    XCTAssertEqual(names[1], ["TypeError"])
    XCTAssertEqual(names[2], ["tap_6"])
    XCTAssertEqual(names[3], ["tap_7"])
  }

  func testFullOutboxEvictsEventsBeforeErrors() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let outbox = try EventOutbox(directory: directory, limits: .appTelemetry)
    let url = URL(string: "https://ingest.example/v1/app-telemetry")!
    func add(_ id: String, priority: Int) throws {
      let body = try JSONSerialization.data(withJSONObject: ["batchId": id, "items": []])
      try outbox.enqueue(url: url, appId: "app-a", body: body, now: 0, priority: priority)
    }
    let count = EventOutbox.Limits.appTelemetry.count
    try add("error-0", priority: 1)
    for index in 1..<count { try add("event-\(index)", priority: 0) }
    // Full: a new error evicts the oldest event, not the older error.
    try add("error-1", priority: 1)
    XCTAssertEqual(try outbox.ready(now: 0)?.id, "error-0")
    try outbox.complete(id: "error-0", status: 202, retryAfter: nil, now: 0, random: 0.5)
    XCTAssertEqual(try outbox.ready(now: 0)?.id, "event-2")
    // Full of errors: events are refused, errors still replace the oldest error.
    let errors = try EventOutbox(
      directory: directory.appendingPathComponent("errors"), limits: .appTelemetry)
    for index in 0..<count {
      let body = try JSONSerialization.data(withJSONObject: ["batchId": "e-\(index)", "items": []])
      try errors.enqueue(url: url, appId: "app-a", body: body, now: 0, priority: 1)
    }
    let late = try JSONSerialization.data(withJSONObject: ["batchId": "late-event", "items": []])
    XCTAssertThrowsError(try errors.enqueue(url: url, appId: "app-a", body: late, now: 0, priority: 0))
    let newest = try JSONSerialization.data(withJSONObject: ["batchId": "e-new", "items": []])
    try errors.enqueue(url: url, appId: "app-a", body: newest, now: 0, priority: 1)
    XCTAssertEqual(try errors.ready(now: 0)?.id, "e-1")
  }

  func testEntriesWithoutPriorityStillLoad() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let body = try JSONSerialization.data(withJSONObject: ["eventId": "old", "action": "applied"])
    let stored: [[String: Any]] = [[
      "id": "old", "url": "https://ingest.example/events", "appId": "app-a",
      "body": body.base64EncodedString(), "createdAt": 0, "attempts": 0, "nextAt": 0,
    ]]
    try JSONSerialization.data(withJSONObject: stored).write(to: directory.appendingPathComponent("events.json"))
    XCTAssertEqual(try EventOutbox(directory: directory).ready(now: 0)?.id, "old")
  }
}
