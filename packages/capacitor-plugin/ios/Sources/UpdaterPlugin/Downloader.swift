import Foundation

final class Downloader {
  private let allowInsecureUrls: Bool
  private let retry: DownloadRetry
  private let sleep: (TimeInterval) async throws -> Void

  init(
    allowInsecureUrls: Bool = false,
    retry: DownloadRetry = DownloadRetry(),
    sleep: @escaping (TimeInterval) async throws -> Void = {
      try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000))
    }
  ) {
    self.allowInsecureUrls = allowInsecureUrls
    self.retry = retry
    self.sleep = sleep
  }

  func download(
    from url: URL,
    progress: @escaping (Double, Int64, Int64) -> Void = { _, _, _ in }
  ) async throws -> URL {
    try ManifestClient.requireHTTPS(url: url, allowInsecure: allowInsecureUrls)
    var attempt = 1
    while true {
      try Task.checkCancellation()
      let delegate = DownloadDelegate(allowInsecureUrls: allowInsecureUrls, progressHandler: progress)
      do {
        let downloaded = try await delegate.start(from: url)
        do { try Task.checkCancellation() }
        catch { try? FileManager.default.removeItem(at: downloaded); throw error }
        return downloaded
      } catch {
        guard let delay = retry.delay(for: error, attempt: attempt) else { throw error }
        try await sleep(delay)
        attempt += 1
      }
    }
  }
}

private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
  private var continuation: CheckedContinuation<URL, Error>?
  private var session: URLSession?
  private let allowInsecureUrls: Bool
  private let progressHandler: (Double, Int64, Int64) -> Void
  private let stateLock = NSLock()
  private var isResolved = false
  private var cancelled = false

  init(allowInsecureUrls: Bool, progressHandler: @escaping (Double, Int64, Int64) -> Void) {
    self.allowInsecureUrls = allowInsecureUrls
    self.progressHandler = progressHandler
    super.init()
  }

  func start(from url: URL) async throws -> URL {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        stateLock.lock()
        if cancelled {
          stateLock.unlock()
          continuation.resume(throwing: CancellationError())
          return
        }
        self.continuation = continuation
        let configuration = URLSessionConfiguration.default
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 60)
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let task = session.downloadTask(with: request)
        stateLock.unlock()
        task.resume()
      }
    } onCancel: {
      self.cancel()
    }
  }

  private func cancel() {
    stateLock.lock()
    cancelled = true
    stateLock.unlock()
    resolve(.failure(CancellationError()))
  }

  @discardableResult
  private func resolve(_ result: Result<URL, Error>) -> Bool {
    stateLock.lock()
    guard !isResolved, let continuation else {
      stateLock.unlock()
      return false
    }
    isResolved = true
    self.continuation = nil
    let session = self.session
    self.session = nil
    stateLock.unlock()
    session?.invalidateAndCancel()
    continuation.resume(with: result)
    return true
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let response = downloadTask.response as? HTTPURLResponse else {
      resolve(.failure(URLError(.badServerResponse)))
      return
    }
    if !(200..<300).contains(response.statusCode) {
      resolve(.failure(DownloadHTTPError(status: response.statusCode, retryAfter: response.value(forHTTPHeaderField: "Retry-After"))))
      return
    }

    let temporaryZip = FileManager.default.temporaryDirectory
      .appendingPathComponent("otakit-\(UUID().uuidString).zip")

    do {
      try FileManager.default.moveItem(at: location, to: temporaryZip)
      // Cancellation can win while the delegate moves the completed download.
      if !resolve(.success(temporaryZip)) { try? FileManager.default.removeItem(at: temporaryZip) }
    } catch {
      resolve(.failure(error))
    }
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    do {
      guard let url = request.url else { throw URLError(.badURL) }
      try ManifestClient.requireHTTPS(url: url, allowInsecure: allowInsecureUrls)
      completionHandler(request)
    } catch {
      completionHandler(nil)
      resolve(.failure(error))
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    guard totalBytesExpectedToWrite > 0 else {
      return
    }
    let percent = (Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) * 100
    progressHandler(percent, totalBytesWritten, totalBytesExpectedToWrite)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    if let error {
      let failure = error as NSError
      if failure.domain == NSURLErrorDomain, failure.code == NSURLErrorCancelled {
        resolve(.failure(CancellationError()))
      } else {
        resolve(.failure(error))
      }
    } else {
      // A successful download normally resolves in didFinishDownloadingTo.
      resolve(.failure(URLError(.badServerResponse)))
    }
  }
}
