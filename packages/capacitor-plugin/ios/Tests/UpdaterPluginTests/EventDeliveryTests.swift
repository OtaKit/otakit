import Foundation
import XCTest
@testable import UpdaterPlugin

final class EventDeliveryTests: XCTestCase {
  func testURLSessionRetryPreservesBodyAndDeletesOnlyAfterAcceptance() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let outbox = try EventOutbox(directory: directory)
    let body = try JSONSerialization.data(withJSONObject: ["eventId": UUID().uuidString, "action": "applied"])
    let accepted = expectation(description: "HTTP retry accepted")
    let lock = NSLock()
    var requests: [Data] = []
    EventHTTPProtocol.respond = { request in
      var bytes = request.httpBody ?? Data()
      if let stream = request.httpBodyStream {
        stream.open(); defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
          let count = stream.read(&buffer, maxLength: buffer.count)
          if count <= 0 { break }
          bytes.append(contentsOf: buffer.prefix(count))
        }
      }
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-App-Id"), "app-a")
      lock.lock(); requests.append(bytes); let count = requests.count; lock.unlock()
      if count == 2 { accepted.fulfill() }
      return count == 1 ? 503 : 202
    }
    defer { EventHTTPProtocol.respond = nil }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [EventHTTPProtocol.self]
    let delivery = EventDelivery(outbox: outbox, configuration: configuration)
    delivery.enqueue(url: URL(string: "https://ingest.example/events")!, appId: "app-a", body: body)
    await fulfillment(of: [accepted], timeout: 15)
    let deadline = Date().addingTimeInterval(3)
    while outbox.wait(now: Date().timeIntervalSince1970) != nil && Date() < deadline {
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    XCTAssertNil(try EventOutbox(directory: directory).wait(now: Date().timeIntervalSince1970))
    XCTAssertEqual(requests, [body, body])
  }
}

private final class EventHTTPProtocol: URLProtocol {
  static var respond: ((URLRequest) -> Int)?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let status = Self.respond?(request) ?? 500
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
