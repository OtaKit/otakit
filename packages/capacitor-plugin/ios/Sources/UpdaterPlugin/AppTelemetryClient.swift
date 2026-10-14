import Foundation

/// App telemetry (error tracking, plugin 3.4+): items from JavaScript, wrapped
/// in batches with the device context and delivered from their own outbox, so
/// app errors never delay or evict OTA update events.
enum AppTelemetryClient {
  static let maxItemBytes = 16 * 1024
  static let maxBatchItems = 50
  /// Room for the items of one batch; the envelope fits in the rest of the outbox's 64 KiB.
  static let maxBatchItemBytes = 56 * 1024

  /// Random per process start, so the dashboard can count app launches with an
  /// error. Not persisted and not a device identifier.
  static let sessionId = UUID().uuidString.lowercased()

  private static let delivery = EventDelivery(
    directoryName: "OtaKitAppTelemetry", limits: .appTelemetry, label: "OtaKit.appTelemetry")

  static func resume() { delivery.resume() }

  struct Batches {
    let bodies: [Data]
    let itemCounts: [Int]
    let dropped: Int
  }

  /// Wraps valid items (JSON objects with a string `kind`, at most 16 KiB) in
  /// batches of at most 50 items that fit the outbox.
  static func batches(
    items: [Any], context: [String: Any], now: Date = Date(),
    makeId: () -> String = { UUID().uuidString.lowercased() }
  ) -> Batches {
    var dropped = 0
    var groups: [[Any]] = []
    var current: [Any] = []
    var currentBytes = 0
    for item in items {
      guard let object = item as? [String: Any], object["kind"] is String,
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            data.count <= maxItemBytes else {
        dropped += 1
        continue
      }
      if !current.isEmpty && (current.count >= maxBatchItems || currentBytes + data.count > maxBatchItemBytes) {
        groups.append(current)
        current = []
        currentBytes = 0
      }
      current.append(object)
      currentBytes += data.count + 1
    }
    if !current.isEmpty { groups.append(current) }

    let sentAt = ISO8601DateFormatter.withFractionalSeconds.string(from: now)
    var bodies: [Data] = []
    var counts: [Int] = []
    for group in groups {
      let batch: [String: Any] = ["batchId": makeId(), "sentAt": sentAt, "context": context, "items": group]
      guard let body = try? JSONSerialization.data(withJSONObject: batch),
            body.count <= EventOutbox.Limits.appTelemetry.maxBody else {
        dropped += group.count
        continue
      }
      bodies.append(body)
      counts.append(group.count)
    }
    return Batches(bodies: bodies, itemCounts: counts, dropped: dropped)
  }

  /// Persists the items for delivery to `{ingestUrl}/app-telemetry`.
  static func enqueue(
    ingestUrl: String, appId: String, context: [String: Any], items: [Any]
  ) -> (accepted: Int, dropped: Int) {
    let base = ingestUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    guard let url = URL(string: "\(base)/app-telemetry"), url.scheme != nil else {
      return (0, items.count)
    }
    let batches = batches(items: items, context: context)
    var accepted = 0
    var dropped = batches.dropped
    for (body, count) in zip(batches.bodies, batches.itemCounts) {
      if delivery.enqueue(url: url, appId: appId, body: body) {
        accepted += count
      } else {
        dropped += count
      }
    }
    return (accepted, dropped)
  }
}

extension ISO8601DateFormatter {
  static let withFractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
}
