import Foundation

/// Atomic, bounded persistence; retries preserve the exact original event body.
final class EventOutbox {
  static let limit = 256
  static let ttl: TimeInterval = 7 * 24 * 60 * 60
  struct Entry: Codable {
    let id: String
    let url: URL
    let appId: String
    let body: Data
    let createdAt: TimeInterval
    var attempts: Int
    var nextAt: TimeInterval
  }
  private let file: URL
  private let lock = NSLock()
  private var entries: [Entry] = []

  init(directory: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var directory = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try directory.setResourceValues(values)
    file = directory.appendingPathComponent("events.json")
    if FileManager.default.fileExists(atPath: file.path) {
      let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard size <= 4 * 1024 * 1024 else { throw CocoaError(.fileReadTooLarge) }
      let data = try Data(contentsOf: file)
      do {
        entries = try JSONDecoder().decode([Entry].self, from: data)
        guard entries.count <= Self.limit else { throw CocoaError(.fileReadCorruptFile) }
      } catch {
        print("[OtaKit] Discarding unreadable event outbox")
        try save([])
      }
    }
  }

  func enqueue(url: URL, appId: String, body: Data, now: TimeInterval) throws {
    lock.lock(); defer { lock.unlock() }
    guard body.count <= 8192,
          let payload = try JSONSerialization.jsonObject(with: body) as? [String: Any],
          let id = payload["eventId"] as? String else { throw CocoaError(.fileWriteInvalidFileName) }
    var next = live(now)
    guard !next.contains(where: { $0.id == id }) else { return }
    while next.count >= Self.limit { next.removeFirst() }
    next.append(Entry(id: id, url: url, appId: appId, body: body, createdAt: now, attempts: 0, nextAt: now))
    try save(next)
  }

  func ready(now: TimeInterval) throws -> Entry? {
    lock.lock(); defer { lock.unlock() }
    let next = live(now)
    if next.count != entries.count { try save(next) }
    return entries.first { $0.nextAt <= now }
  }

  func wait(now: TimeInterval) -> TimeInterval? {
    lock.lock(); defer { lock.unlock() }
    return entries.map { max(0, min($0.nextAt, $0.createdAt + Self.ttl) - now) }.min()
  }

  func complete(id: String, status: Int, retryAfter: String?, now: TimeInterval, random: Double) throws {
    lock.lock(); defer { lock.unlock() }
    var next = live(now)
    if let index = next.firstIndex(where: { $0.id == id }) {
      if (200..<300).contains(status) || ((300..<500).contains(status) && ![408, 425, 429].contains(status)) {
        next.remove(at: index)
      } else {
        next[index].attempts = min(next[index].attempts + 1, 20)
        let backoff = min(3600, 5 * pow(2, Double(min(next[index].attempts - 1, 10)))) * (0.5 + random)
        let serverDelay = DownloadRetry.retryAfter(retryAfter, now: Date(timeIntervalSince1970: now)) ?? 0
        // Expiration is the upper bound; never retry before a longer server delay.
        next[index].nextAt = min(now + max(backoff, serverDelay), next[index].createdAt + Self.ttl)
      }
    }
    try save(next)
  }

  private func live(_ now: TimeInterval) -> [Entry] {
    entries.filter { now < $0.createdAt + Self.ttl }
  }

  private func save(_ next: [Entry]) throws {
    try JSONEncoder().encode(next).write(to: file, options: .atomic)
    entries = next
  }
}

/// Owns one serial delivery loop independently of any Capacitor bridge lifetime.
final class EventDelivery: NSObject, URLSessionTaskDelegate {
  private let worker = DispatchQueue(label: "OtaKit.events")
  private let stateLock = NSLock()
  private var outbox: EventOutbox?
  private var scheduled: DispatchWorkItem?
  private var sending = false
  private let configuration: URLSessionConfiguration
  private lazy var session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)

  init(outbox: EventOutbox? = nil, configuration: URLSessionConfiguration = .ephemeral) {
    self.outbox = outbox
    self.configuration = configuration
    super.init()
  }

  func resume() {
    stateLock.lock()
    if outbox == nil {
      do {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
          appropriateFor: nil, create: true)
        outbox = try EventOutbox(directory: support.appendingPathComponent("OtaKitEvents", isDirectory: true))
      } catch { print("[OtaKit] Cannot open device event outbox") }
    }
    stateLock.unlock()
    worker.async { self.schedule() }
  }

  func enqueue(url: URL, appId: String, body: Data) {
    stateLock.lock()
    let outbox = self.outbox
    stateLock.unlock()
    do {
      guard let outbox else { throw CocoaError(.fileWriteUnknown) }
      try outbox.enqueue(url: url, appId: appId, body: body, now: Date().timeIntervalSince1970)
      worker.async { self.schedule() }
    } catch { print("[OtaKit] Cannot persist device event") }
  }

  private func schedule(minimumDelay: TimeInterval = 0) {
    guard !sending else { return }
    scheduled?.cancel()
    stateLock.lock(); let outbox = self.outbox; stateLock.unlock()
    guard let delay = outbox?.wait(now: Date().timeIntervalSince1970) else { scheduled = nil; return }
    let item = DispatchWorkItem { self.drain() }
    scheduled = item
    worker.asyncAfter(deadline: .now() + max(minimumDelay, delay), execute: item)
  }

  private func drain() {
    guard !sending else { return }
    scheduled?.cancel(); scheduled = nil
    stateLock.lock(); let outbox = self.outbox; stateLock.unlock()
    guard let outbox else { return }
    do {
      guard let entry = try outbox.ready(now: Date().timeIntervalSince1970) else { schedule(); return }
      sending = true
      var request = URLRequest(url: entry.url)
      request.httpMethod = "POST"
      request.setValue(entry.appId, forHTTPHeaderField: "X-App-Id")
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = entry.body
      request.timeoutInterval = 10
      session.dataTask(with: request) { _, response, error in
        self.worker.async {
          let http = response as? HTTPURLResponse
          var storageFailed = false
          do {
            try outbox.complete(id: entry.id, status: error == nil ? (http?.statusCode ?? 0) : 0,
              retryAfter: http?.value(forHTTPHeaderField: "Retry-After"),
              now: Date().timeIntervalSince1970, random: Double.random(in: 0..<1))
          } catch {
            storageFailed = true
            print("[OtaKit] Cannot persist device event delivery state")
          }
          self.sending = false
          self.schedule(minimumDelay: storageFailed ? 60 : 0)
        }
      }.resume()
    } catch {
      print("[OtaKit] Cannot read device event outbox")
      schedule(minimumDelay: 60)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}
