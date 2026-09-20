import Foundation
import XCTest
@testable import UpdaterPlugin

final class BundleCryptoTests: XCTestCase {
  private var directory: URL!
  private let ciphertext = "7b6aa276a9dba36ef929f2e5c5801b0cf7b3e314bf2f1e5c5e0e9df1681b658e2e78da91c3ffffb9dfebd748620c76d3e455d9b60791"
  private var key: Data { Data(0..<32) }
  private var nonce: String { Data(0..<12).base64EncodedString() }
  private func hex(_ value: String) -> Data {
    var result = Data()
    var start = value.startIndex
    while start < value.endIndex {
      let end = value.index(start, offsetBy: 2)
      result.append(UInt8(value[start..<end], radix: 16)!)
      start = end
    }
    return result
  }
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }
  func testDecryptsCLICompatibleCiphertextAfterAuthentication() throws {
    let input = directory.appendingPathComponent("encrypted")
    let output = directory.appendingPathComponent("plain")
    try hex(ciphertext).write(to: input)
    try BundleCrypto.decryptFile(dek: key, nonceB64: nonce, input: input, output: output, availableBytes: 1024 * 1024 * 1024)
    XCTAssertEqual(try String(contentsOf: output, encoding: .utf8), "<html>authenticated OTA fixture</html>")
  }
  #if targetEnvironment(simulator)
  func testSimulatorDecryptsWithDefaultMemoryEstimate() throws {
    let input = directory.appendingPathComponent("encrypted")
    let output = directory.appendingPathComponent("plain")
    try hex(ciphertext).write(to: input)
    try BundleCrypto.decryptFile(dek: key, nonceB64: nonce, input: input, output: output)
    XCTAssertEqual(try String(contentsOf: output, encoding: .utf8), "<html>authenticated OTA fixture</html>")
  }
  #endif
  func testTamperedBodyTagAndWrongKeyCannotPublishPlaintext() throws {
    let input = directory.appendingPathComponent("encrypted")
    let output = directory.appendingPathComponent("plain")
    for index in [0, hex(ciphertext).count - 1, -1] {
      var bytes = hex(ciphertext)
      var key = key
      if index >= 0 { bytes[index] ^= 1 } else { key[0] ^= 1 }
      try bytes.write(to: input)
      try Data([42]).write(to: output)
      XCTAssertThrowsError(try BundleCrypto.decryptFile(dek: key, nonceB64: nonce, input: input, output: output, availableBytes: 1024 * 1024 * 1024))
      XCTAssertEqual(try Data(contentsOf: output), Data([42]))
    }
  }
  func testLargeSparseFileIsRejectedBeforeAllocatingOrWriting() throws {
    let input = directory.appendingPathComponent("encrypted")
    let output = directory.appendingPathComponent("absent.zip")
    try Data().write(to: input)
    let file = try FileHandle(forWritingTo: input)
    try file.truncate(atOffset: 200 * 1024 * 1024)
    try file.close()
    XCTAssertThrowsError(try BundleCrypto.decryptFile(dek: key, nonceB64: nonce, input: input, output: output, availableBytes: 80 * 1024 * 1024)) { error in
      XCTAssertTrue(error.localizedDescription.hasPrefix("insufficient_memory_for_encrypted_bundle"))
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
  }
  func testBudgetIncludesReserveAndAvoidsOverflow() throws {
    let reserve: Int64 = 32 * 1024 * 1024
    try BundleCrypto.requireMemoryBudget(encryptedBytes: 100, availableBytes: reserve + 400)
    XCTAssertThrowsError(try BundleCrypto.requireMemoryBudget(encryptedBytes: 101, availableBytes: reserve + 400))
    XCTAssertThrowsError(try BundleCrypto.requireMemoryBudget(encryptedBytes: 100, availableBytes: .min))
    XCTAssertThrowsError(try BundleCrypto.requireMemoryBudget(encryptedBytes: 129 * 1024 * 1024, availableBytes: .max))
  }
  func testTruncatedInputCannotCreateOutput() throws {
    let input = directory.appendingPathComponent("encrypted")
    let output = directory.appendingPathComponent("absent.zip")
    try Data(repeating: 0, count: 16).write(to: input)
    XCTAssertThrowsError(try BundleCrypto.decryptFile(dek: key, nonceB64: nonce, input: input, output: output, availableBytes: .max))
    XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
  }
}
