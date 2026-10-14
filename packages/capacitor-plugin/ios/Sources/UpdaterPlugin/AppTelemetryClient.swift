import Foundation

/// App telemetry (error tracking and custom events, plugin 3.4+): items from
/// JavaScript, wrapped in batches with the device context and delivered from
/// their own outbox, so they never delay or evict OTA update events. Errors and
/// events go in separate batches; while a batch waits (offline), new items of
/// the same kind and context join it, and a full outbox evicts events first.
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

  /// Errors are kept over events when the outbox is full.
  enum Lane: String {
    case error, event

    var priority: Int { self == .error ? 1 : 0 }
  }

  struct Batches {
    let bodies: [Data]
    let itemCounts: [Int]
    let lanes: [Lane]
    let dropped: Int
  }

  /// Wraps valid items (JSON objects with a string `kind`, at most 16 KiB) in
  /// batches of one lane and at most 50 items that fit the outbox.
  static func batches(
    items: [Any], context: [String: Any], now: Date = Date(),
    makeId: () -> String = { UUID().uuidString.lowercased() }
  ) -> Batches {
    var dropped = 0
    var groups: [(lane: Lane, items: [Any])] = []
    var current: [Any] = []
    var currentLane = Lane.event
    var currentBytes = 0
    for item in items {
      guard let object = item as? [String: Any], let kind = object["kind"] as? String,
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            data.count <= maxItemBytes else {
        dropped += 1
        continue
      }
      let lane: Lane = kind == "error" ? .error : .event
      if !current.isEmpty && (lane != currentLane || current.count >= maxBatchItems ||
          currentBytes + data.count > maxBatchItemBytes) {
        groups.append((currentLane, current))
        current = []
        currentBytes = 0
      }
      currentLane = lane
      current.append(object)
      currentBytes += data.count + 1
    }
    if !current.isEmpty { groups.append((currentLane, current)) }

    let sentAt = ISO8601DateFormatter.withFractionalSeconds.string(from: now)
    var bodies: [Data] = []
    var counts: [Int] = []
    var lanes: [Lane] = []
    for group in groups {
      let batch: [String: Any] = ["batchId": makeId(), "sentAt": sentAt, "context": context, "items": group.items]
      guard let body = try? JSONSerialization.data(withJSONObject: batch),
            body.count <= EventOutbox.Limits.appTelemetry.maxBody else {
        dropped += group.items.count
        continue
      }
      bodies.append(body)
      counts.append(group.items.count)
      lanes.append(group.lane)
    }
    return Batches(bodies: bodies, itemCounts: counts, lanes: lanes, dropped: dropped)
  }

  /// Items of both batches in the first one (its ID, time and context), or nil
  /// when they would be over 50 items.
  static func mergeBatches(_ existing: Data, _ incoming: Data) -> Data? {
    guard var batch = (try? JSONSerialization.jsonObject(with: existing)) as? [String: Any],
          let current = batch["items"] as? [Any],
          let added = ((try? JSONSerialization.jsonObject(with: incoming)) as? [String: Any])?["items"] as? [Any],
          current.count + added.count <= maxBatchItems else { return nil }
    batch["items"] = current + added
    return try? JSONSerialization.data(withJSONObject: batch)
  }

  /// Batches only take in items of the same lane and device context.
  static func mergeKey(lane: Lane, context: [String: Any]) -> String? {
    guard let data = try? JSONSerialization.data(withJSONObject: context, options: .sortedKeys) else {
      return nil
    }
    return "\(lane.rawValue)|\(String(decoding: data, as: UTF8.self))"
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
    for index in batches.bodies.indices {
      let body = batches.bodies[index]
      let count = batches.itemCounts[index]
      let lane = batches.lanes[index]
      if delivery.enqueue(
        url: url, appId: appId, body: body, priority: lane.priority,
        mergeKey: mergeKey(lane: lane, context: context), merge: mergeBatches) {
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
