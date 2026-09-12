import Foundation

/// The durable outbox owns event identity; telemetry never owns launch or activation decisions.
public actor EventDelivery {
  public typealias Sender = (URL, String, Data) async throws -> Int
  private let store: LaunchStore
  private let endpoint: URL
  private let appId: String
  private let platform: String
  private let nativeBuild: String
  private let sender: Sender
  private var failures = 0
  private var busy = false

  public init(
    store: LaunchStore, base: URL, appId: String, platform: String, nativeBuild: String,
    allowLocalhost: Bool = false, sender: Sender? = nil
  ) throws {
    guard let host = base.host, !host.isEmpty,
      base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
      base.scheme == "https"
        || (allowLocalhost && base.scheme == "http"
          && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(base.host ?? ""))
    else { throw LaunchError.incompatibleArtifact }
    self.store = store
    endpoint = base.appendingPathComponent("events")
    self.appId = appId
    self.platform = platform
    self.nativeBuild = nativeBuild
    self.sender = sender ?? EventRequest.post
  }

  public func flushOnce() async -> UInt64 {
    guard !busy else { return 5 }
    busy = true
    defer { busy = false }
    do {
      guard let event = try store.eventForDelivery() else {
        failures = 0
        return 5
      }
      let artifact = event.artifact
      guard artifact.appId == appId, artifact.platform == platform,
        ["downloaded", "applied", "download_error", "rollback"].contains(event.type),
        let release = artifact.releaseId, !release.isEmpty, let created = event.createdAt
      else {
        try store.discardEvent(event.id, reason: "Invalid event payload or attribution")
        return 0
      }
      var payload: [String: Any] = [
        "eventId": event.id,
        "sentAt": ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: created)),
        "platform": platform, "action": event.type, "bundleVersion": artifact.version,
        "runtimeVersion": artifact.runtimeVersion,
        "releaseId": release, "nativeBuild": nativeBuild,
      ]
      payload["channel"] = artifact.channel.map { $0 as Any } ?? NSNull()
      payload["detail"] = event.detail.map { $0 as Any } ?? NSNull()
      let body = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
      guard body.count <= 8192 else {
        try store.discardEvent(event.id, reason: "Oversized event payload")
        return 0
      }
      let status = try await sender(endpoint, appId, body)
      if status == 202 {
        try store.acknowledgeEvents([event.id])
        failures = 0
        return 0
      }
      if status >= 300 && status < 500 && status != 408 && status != 429 {
        try store.discardEvent(event.id, reason: "Event delivery HTTP \(status)")
        failures = 0
        return 0
      }
    } catch {
      // Preserve the event and its ID after network or durable-ack failure.
    }
    failures = min(failures + 1, 7)
    return min(300, UInt64(5 << (failures - 1)))
  }
}

/// Read only response headers. Never follow a redirect or buffer the ingest response body.
private final class EventRequest: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private var continuation: CheckedContinuation<Int, Error>?
  static func post(_ url: URL, appId: String, body: Data) async throws -> Int {
    let delegate = EventRequest()
    return try await withCheckedThrowingContinuation { continuation in
      delegate.continuation = continuation
      let config = URLSessionConfiguration.ephemeral
      config.httpCookieStorage = nil
      config.urlCredentialStorage = nil
      config.timeoutIntervalForRequest = 10
      config.timeoutIntervalForResource = 15
      let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(appId, forHTTPHeaderField: "X-App-Id")
      session.dataTask(with: request).resume()
    }
  }
  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    if let status = (response as? HTTPURLResponse)?.statusCode {
      continuation?.resume(returning: status)
      continuation = nil
    }
    completionHandler(.cancel)
    session.invalidateAndCancel()
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    continuation?.resume(throwing: error ?? LaunchError.storageUnavailable)
    continuation = nil
    session.finishTasksAndInvalidate()
  }
}
