import Foundation

/// Streams into an owned file, enforcing the byte budget before each write.
public final class BoundedDownload: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let limit: Int64
  private let lock = NSLock()
  private var cancelled = false
  private var task: URLSessionDataTask?
  private var session: URLSession?
  private var continuation: CheckedContinuation<URL, Error>?
  private var file: FileHandle?
  private var destination: URL?
  private var count: Int64 = 0
  private var failure: Error?

  private init(limit: Int64) { self.limit = limit }

  public static func fetch(_ url: URL, limit: Int64, allowLocalhost: Bool = false) async throws
    -> URL
  {
    guard limit >= 0 && limit <= 100 * 1024 * 1024, url.user == nil && url.password == nil,
      url.scheme == "https"
        || (allowLocalhost && url.scheme == "http"
          && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(url.host ?? ""))
    else {
      throw LaunchError.incompatibleArtifact
    }
    let transfer = BoundedDownload(limit: limit)
    return try await withTaskCancellationHandler(
      operation: {
        try await withCheckedThrowingContinuation { transfer.start(url, continuation: $0) }
      }, onCancel: { transfer.cancel() })
  }

  private func start(_ url: URL, continuation: CheckedContinuation<URL, Error>) {
    lock.lock()
    defer { lock.unlock() }
    guard !cancelled else {
      continuation.resume(throwing: CancellationError())
      return
    }
    do {
      let destination = FileManager.default.temporaryDirectory.appendingPathComponent(
        "otakit-\(UUID().uuidString)")
      try Data().write(to: destination, options: [.withoutOverwriting])
      self.destination = destination
      file = try FileHandle(forWritingTo: destination)
      self.continuation = continuation
      let configuration = URLSessionConfiguration.ephemeral
      configuration.timeoutIntervalForRequest = 30
      configuration.timeoutIntervalForResource = 120
      configuration.httpCookieStorage = nil
      configuration.urlCredentialStorage = nil
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
      self.session = session
      let task = session.dataTask(with: url)
      self.task = task
      task.resume()
    } catch {
      if let destination = destination { try? FileManager.default.removeItem(at: destination) }
      continuation.resume(throwing: error)
    }
  }
  private func cancel() {
    lock.lock()
    defer { lock.unlock() }
    cancelled = true
    task?.cancel()
  }

  public func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let http = response as? HTTPURLResponse, http.statusCode == 200,
      response.expectedContentLength <= limit
    else {
      failure = LaunchError.incompatibleArtifact
      completionHandler(.cancel)
      return
    }
    completionHandler(.allow)
  }
  public func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    failure = LaunchError.incompatibleArtifact
    completionHandler(nil)
  }
  public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data)
  {
    guard failure == nil else { return }
    do {
      guard data.count <= limit - count, let file = file else {
        throw LaunchError.incompatibleArtifact
      }
      try file.write(contentsOf: data)
      count += Int64(data.count)
    } catch {
      failure = error
      dataTask.cancel()
    }
  }
  public func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?
  ) {
    do { try file?.close() } catch { failure = failure ?? error }
    file = nil
    session.finishTasksAndInvalidate()
    if let failure = failure ?? error {
      if let destination = destination { try? FileManager.default.removeItem(at: destination) }
      continuation?.resume(throwing: failure)
    } else if let destination = destination {
      continuation?.resume(returning: destination)
    } else {
      continuation?.resume(throwing: LaunchError.storageUnavailable)
    }
    continuation = nil
    self.session = nil
  }
}
