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
}
