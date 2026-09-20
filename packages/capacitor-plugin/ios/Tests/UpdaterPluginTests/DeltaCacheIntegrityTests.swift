import Foundation
import XCTest
@testable import UpdaterPlugin

final class DeltaCacheIntegrityTests: XCTestCase {
  private var directory: URL!
  private var cache: URL!
  private let good = Data([1,2,3])
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    cache = directory.appendingPathComponent("cache")
    try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
  private func entry() throws -> ManifestFileEntry {
    let source = directory.appendingPathComponent("source")
    try good.write(to: source)
    return ManifestFileEntry(path: "index.html", sha256: try HashUtils.sha256(fileURL: source), size: 3, url: "https://example.test/file")
  }
  private func download() throws -> URL {
    let file = directory.appendingPathComponent(UUID().uuidString)
    try good.write(to: file)
    return file
  }
  func testCorruptedCacheIsRepairedBeforeAssembly() async throws {
    let entry = try entry()
    let cached = cache.appendingPathComponent(entry.sha256)
    try Data([9,9,9]).write(to: cached)
    var requests = 0
    let assembler = DeltaAssembler(cacheDirectory: cache, downloader: Downloader(), fetch: { _ in
      requests += 1; return try self.download()
    })
    let output = directory.appendingPathComponent("assembled")
    try assembler.validate([entry], expectedFilesHash: DeltaAssembler.computeFilesHash([entry]))
    try await assembler.assemble(entries: [entry], into: output)
    XCTAssertEqual(try Data(contentsOf: output.appendingPathComponent("index.html")), good)
    XCTAssertEqual(try Data(contentsOf: cached), good)
    XCTAssertEqual(requests, 1)
  }
  func testValidCacheNeedsNoNetwork() async throws {
    let entry = try entry()
    try good.write(to: cache.appendingPathComponent(entry.sha256))
    let assembler = DeltaAssembler(cacheDirectory: cache, downloader: Downloader(), fetch: { _ in
      XCTFail("Network used for valid cache"); throw URLError(.notConnectedToInternet)
    })
    let output = directory.appendingPathComponent("assembled")
    try await assembler.assemble(entries: [entry], into: output)
    XCTAssertEqual(try Data(contentsOf: output.appendingPathComponent("index.html")), good)
  }
  func testDamagedCacheAndOfflineFailureCannotProduceBundle() async throws {
    let entry = try entry()
    try Data([9]).write(to: cache.appendingPathComponent(entry.sha256))
    let assembler = DeltaAssembler(cacheDirectory: cache, downloader: Downloader(), fetch: { _ in throw URLError(.notConnectedToInternet) })
    let output = directory.appendingPathComponent("assembled")
    do { try await assembler.assemble(entries: [entry], into: output); XCTFail("Expected offline failure") }
    catch { XCTAssertEqual((error as NSError).code, NSURLErrorNotConnectedToInternet) }
    XCTAssertFalse(FileManager.default.fileExists(atPath: output.appendingPathComponent("index.html").path))
  }
  func testCorruptConcurrentWriterCannotBypassVerification() async throws {
    let entry = try entry()
    let assembler = DeltaAssembler(cacheDirectory: cache, downloader: Downloader(), fetch: { _ in
      try Data([9]).write(to: self.cache.appendingPathComponent(entry.sha256))
      return try self.download()
    })
    let output = directory.appendingPathComponent("assembled")
    try await assembler.assemble(entries: [entry], into: output)
    XCTAssertEqual(try Data(contentsOf: output.appendingPathComponent("index.html")), good)
  }
}
