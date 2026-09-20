import Foundation

struct DownloadHTTPError: Error, LocalizedError {
  let status: Int
  let retryAfter: String?
  var errorDescription: String? { "Download failed with HTTP \(status)" }
}

/// Bounded retries for GET transport failures. Integrity and disk failures stay terminal.
struct DownloadRetry {
  var now: () -> Date = { Date() }
  var random: () -> Double = { Double.random(in: 0..<1) }

  func delay(for error: Error, attempt: Int) -> TimeInterval? {
    guard attempt >= 1, attempt < 3, !Task.isCancelled else { return nil }
    var serverDelay: TimeInterval?
    if let http = error as? DownloadHTTPError {
      guard [408, 425, 429, 500, 502, 503, 504].contains(http.status) else { return nil }
      serverDelay = Self.retryAfter(http.retryAfter, now: now())
      // Do not sleep indefinitely or retry earlier than a long server-requested delay.
      if let serverDelay, serverDelay > 30 { return nil }
    } else {
      let failure = error as NSError
      guard failure.domain == NSURLErrorDomain,
            [NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost,
             NSURLErrorNetworkConnectionLost, NSURLErrorDNSLookupFailed,
             NSURLErrorNotConnectedToInternet].contains(failure.code) else { return nil }
    }
    let backoff = pow(2, Double(attempt - 1)) * (0.5 + random())
    return max(backoff, serverDelay ?? 0)
  }

  static func retryAfter(_ value: String?, now: Date) -> TimeInterval? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty, trimmed.allSatisfy({ $0 >= "0" && $0 <= "9" }) {
      return Double(trimmed) ?? .infinity
    }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    formatter.isLenient = false
    guard let date = formatter.date(from: trimmed) else { return nil }
    return max(0, date.timeIntervalSince(now))
  }
}
