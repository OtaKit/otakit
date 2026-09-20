import Foundation
import Network
import XCTest
@testable import UpdaterPlugin

final class DownloadRetryTests: XCTestCase {
  func testOnlyActualHTTP403And410RefreshTheManifest() {
    XCTAssertTrue(DownloadRetry.isExpiredURLFailure(DownloadHTTPError(status: 403, retryAfter: nil)))
    XCTAssertTrue(DownloadRetry.isExpiredURLFailure(DownloadHTTPError(status: 410, retryAfter: nil)))
    XCTAssertFalse(DownloadRetry.isExpiredURLFailure(DownloadHTTPError(status: 503, retryAfter: nil)))
    XCTAssertFalse(DownloadRetry.isExpiredURLFailure(NSError(domain: "OtaKit", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "hash mismatch; actualSha256=abc403def410; receivedBytes=40300"])))
    XCTAssertFalse(DownloadRetry.isExpiredURLFailure(NSError(domain: "OtaKit", code: 403,
      userInfo: [NSLocalizedDescriptionKey: "forbidden local path or expired key"])))
  }
  func testTransientHTTPAndDisconnectedBodyRetryFreshDownloads() async throws {
    let server = try DownloadHTTPServer(responses: [
      .http(status: 503), .truncated, .success
    ])
    let url = try await server.start()
    defer { server.stop() }
    var delays: [TimeInterval] = []
    let downloader = Downloader(allowInsecureUrls: true,
      retry: DownloadRetry(random: { 0.5 }), sleep: { delays.append($0) })
    let downloaded = try await downloader.download(from: url)
    defer { try? FileManager.default.removeItem(at: downloaded) }
    XCTAssertEqual(try Data(contentsOf: downloaded), Data([1, 2, 3]))
    XCTAssertEqual(server.requestCount, 3)
    XCTAssertEqual(delays, [1, 2])
  }

  func testRetryAfterIsHonoredAndLongDelayIsNotRetriedEarly() async throws {
    let server = try DownloadHTTPServer(responses: [.http(status: 429, retryAfter: "12"), .success])
    let url = try await server.start()
    defer { server.stop() }
    var delays: [TimeInterval] = []
    let downloader = Downloader(allowInsecureUrls: true,
      retry: DownloadRetry(random: { 0.5 }), sleep: { delays.append($0) })
    let downloaded = try await downloader.download(from: url)
    try FileManager.default.removeItem(at: downloaded)
    XCTAssertEqual(delays, [12])
    XCTAssertNil(DownloadRetry().delay(for: DownloadHTTPError(status: 503, retryAfter: "120"), attempt: 1))
  }

  func testExhaustionStopsAfterThreeRequests() async throws {
    let server = try DownloadHTTPServer(responses: [.http(status: 504)])
    let url = try await server.start()
    defer { server.stop() }
    var delays: [TimeInterval] = []
    let downloader = Downloader(allowInsecureUrls: true, sleep: { delays.append($0) })
    do {
      _ = try await downloader.download(from: url)
      XCTFail("Expected terminal HTTP error")
    } catch let error as DownloadHTTPError { XCTAssertEqual(error.status, 504) }
    XCTAssertEqual(server.requestCount, 3)
    XCTAssertEqual(delays.count, 2)
  }

  func testPermanentHTTPDoesNotRetry() async throws {
    let server = try DownloadHTTPServer(responses: [.http(status: 403)])
    let url = try await server.start()
    defer { server.stop() }
    let downloader = Downloader(allowInsecureUrls: true, sleep: { _ in XCTFail("Unexpected retry") })
    do { _ = try await downloader.download(from: url); XCTFail("Expected HTTP 403") }
    catch let error as DownloadHTTPError { XCTAssertEqual(error.status, 403) }
    XCTAssertEqual(server.requestCount, 1)
  }

  func testUnsolicitedPartialResponseIsRejected() async throws {
    let server = try DownloadHTTPServer(responses: [.http(status: 206)])
    let url = try await server.start()
    defer { server.stop() }
    do {
      _ = try await Downloader(allowInsecureUrls: true).download(from: url)
      XCTFail("A whole-object request must not accept a partial response")
    } catch let error as DownloadHTTPError { XCTAssertEqual(error.status, 206) }
    XCTAssertEqual(server.requestCount, 1)
  }

  func testCancellationDuringBackoffStopsFurtherRequests() async throws {
    let server = try DownloadHTTPServer(responses: [.http(status: 503)])
    let url = try await server.start()
    defer { server.stop() }
    let waiting = expectation(description: "Retry backoff begins")
    let downloader = Downloader(allowInsecureUrls: true, sleep: { _ in
      waiting.fulfill()
      try await Task.sleep(nanoseconds: 30_000_000_000)
    })
    let download = Task { try await downloader.download(from: url) }
    await fulfillment(of: [waiting], timeout: 10)
    download.cancel()
    do { _ = try await download.value; XCTFail("Expected cancellation") }
    catch { XCTAssertTrue(error is CancellationError) }
    XCTAssertEqual(server.requestCount, 1)
  }

  func testPolicyRejectsCertificateDiskIntegrityAndCancelledErrors() {
    let retry = DownloadRetry()
    for code in [NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
                 NSURLErrorCancelled, NSURLErrorCannotWriteToFile] {
      XCTAssertNil(retry.delay(for: NSError(domain: NSURLErrorDomain, code: code), attempt: 1))
    }
    XCTAssertNil(retry.delay(for: CocoaError(.fileWriteOutOfSpace), attempt: 1))
    XCTAssertNil(retry.delay(for: NSError(domain: "OtaKit", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "hash mismatch"]), attempt: 1))
    for status in [400, 401, 403, 404, 410] {
      XCTAssertNil(retry.delay(for: DownloadHTTPError(status: status, retryAfter: nil), attempt: 1))
    }
  }

  func testRetryAfterDateAndOverflow() {
    XCTAssertEqual(DownloadRetry.retryAfter("Thu, 01 Jan 1970 00:00:12 GMT", now: Date(timeIntervalSince1970: 0)), 12)
    XCTAssertEqual(DownloadRetry.retryAfter("Thu, 01 Jan 1970 00:00:12 GMT", now: Date(timeIntervalSince1970: 20)), 0)
    XCTAssertNil(DownloadRetry.retryAfter("invalid", now: Date()))
    XCTAssertNil(DownloadRetry.retryAfter("-1", now: Date()))
    let huge = String(repeating: "9", count: 500)
    XCTAssertNil(DownloadRetry().delay(for: DownloadHTTPError(status: 429, retryAfter: huge), attempt: 1))
  }
}

/// Real loopback HTTP responses, including a body disconnected before Content-Length.
final class DownloadHTTPServer {
  struct Response {
    let status: Int
    let retryAfter: String?
    let body: Data
    let advertisedLength: Int
    static func http(status: Int, retryAfter: String? = nil) -> Response {
      Response(status: status, retryAfter: retryAfter, body: Data(), advertisedLength: 0)
    }
    static let success = Response(status: 200, retryAfter: nil, body: Data([1, 2, 3]), advertisedLength: 3)
    static let truncated = Response(status: 200, retryAfter: nil, body: Data([9, 9]), advertisedLength: 100)
  }
  private let listener: NWListener
  private let responses: [Response]
  private let lock = NSLock()
  private var requests = 0
  var requestCount: Int { lock.lock(); defer { lock.unlock() }; return requests }
  init(responses: [Response]) throws {
    self.responses = responses
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }
  func start() async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      listener.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready:
          self.listener.stateUpdateHandler = nil
          continuation.resume(returning: URL(string: "http://127.0.0.1:\(self.listener.port!.rawValue)/object")!)
        case .failed(let error):
          self.listener.stateUpdateHandler = nil
          continuation.resume(throwing: error)
        default: break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        connection.start(queue: .global())
        self?.receive(connection, previous: Data())
      }
      listener.start(queue: .global())
    }
  }
  func stop() { listener.cancel() }
  private func receive(_ connection: NWConnection, previous: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { connection.cancel(); return }
      var request = previous
      if let data { request.append(data) }
      guard request.range(of: Data("\r\n\r\n".utf8)) != nil else {
        if complete || error != nil { connection.cancel() }
        else { self.receive(connection, previous: request) }
        return
      }
      self.lock.lock()
      let response = self.responses[min(self.requests, self.responses.count - 1)]
      self.requests += 1
      self.lock.unlock()
      var header = "HTTP/1.1 \(response.status) Test\r\nContent-Length: \(response.advertisedLength)\r\nConnection: close\r\nCache-Control: no-store\r\n"
      if let retryAfter = response.retryAfter { header += "Retry-After: \(retryAfter)\r\n" }
      var bytes = Data((header + "\r\n").utf8)
      bytes.append(response.body)
      connection.send(content: bytes, contentContext: .finalMessage, isComplete: true,
        completion: .contentProcessed { _ in connection.cancel() })
    }
  }
}
