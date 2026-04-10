import Foundation

final class Downloader {
  private let allowInsecureUrls: Bool

  init(allowInsecureUrls: Bool = false) {
    self.allowInsecureUrls = allowInsecureUrls
  }

  func download(
    from url: URL,
    progress: @escaping (Double, Int64, Int64) -> Void = { _, _, _ in }
  ) async throws -> URL {
    try ManifestClient.requireHTTPS(url: url, allowInsecure: allowInsecureUrls)
    let delegate = DownloadDelegate(progressHandler: progress)
    return try await delegate.start(from: url)
  }
}

private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
  private var continuation: CheckedContinuation<URL, Error>?
  private var session: URLSession?
  private let progressHandler: (Double, Int64, Int64) -> Void
  private let stateLock = NSLock()
  private var isResolved = false

  init(progressHandler: @escaping (Double, Int64, Int64) -> Void) {
    self.progressHandler = progressHandler
    super.init()
  }

  func start(from url: URL) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation

      let configuration = URLSessionConfiguration.default
      let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
      self.session = session
      let task = session.downloadTask(with: url)
      task.resume()
    }
  }

  private func resolve(_ result: Result<URL, Error>) {
    stateLock.lock()
    guard !isResolved, let continuation else {
      stateLock.unlock()
      return
    }
    isResolved = true
    self.continuation = nil
    stateLock.unlock()

    switch result {
    case let .success(url):
      continuation.resume(returning: url)
    case let .failure(error):
      continuation.resume(throwing: error)
    }
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    // Check HTTP status before treating the file as a valid download
    if let httpResponse = downloadTask.response as? HTTPURLResponse,
       !(200..<300).contains(httpResponse.statusCode) {
      resolve(.failure(NSError(
        domain: "Downloader",
        code: httpResponse.statusCode,
        userInfo: [NSLocalizedDescriptionKey: "Download failed with HTTP \(httpResponse.statusCode)"]
      )))
      session.finishTasksAndInvalidate()
      self.session = nil
      return
    }

    let temporaryZip = FileManager.default.temporaryDirectory
      .appendingPathComponent("updatekit-\(UUID().uuidString).zip")

    do {
      try FileManager.default.moveItem(at: location, to: temporaryZip)
      resolve(.success(temporaryZip))
    } catch {
      resolve(.failure(error))
    }

    session.finishTasksAndInvalidate()
    self.session = nil
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
      resolve(.failure(error))
    }

    session.finishTasksAndInvalidate()
    self.session = nil
  }
}
