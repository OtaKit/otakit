import CryptoKit
import Foundation

enum HashUtilsError: Error {
  case couldNotOpenFile
}

enum HashUtils {
  static func sha256(fileURL: URL) throws -> String {
    guard let handle = try? FileHandle(forReadingFrom: fileURL) else {
      throw HashUtilsError.couldNotOpenFile
    }
    defer { try? handle.close() }

    var hasher = SHA256()

    while autoreleasepool(invoking: {
      let data = handle.readData(ofLength: 1024 * 1024)
      if data.isEmpty {
        return false
      }
      hasher.update(data: data)
      return true
    }) {}

    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  static func verify(fileURL: URL, expectedSha256: String) throws -> Bool {
    let actual = try sha256(fileURL: fileURL)
    return actual.lowercased() == expectedSha256.lowercased()
  }

  static func verifyDownload(fileURL: URL, expectedSha256: String, expectedBytes: Int?, kind: String) throws {
    let actual = try sha256(fileURL: fileURL)
    let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
    guard let size = attributes[.size] as? NSNumber else { throw HashUtilsError.couldNotOpenFile }
    let received = size.int64Value
    let hashMatches = actual.caseInsensitiveCompare(expectedSha256) == .orderedSame
    let sizeMatches = expectedBytes.map { Int64($0) == received } ?? true
    guard hashMatches && sizeMatches else {
      let safeExpected = expectedSha256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil
        ? expectedSha256.lowercased() : "invalid"
      let reason = hashMatches ? "size mismatch" : "hash mismatch"
      throw NSError(domain: "OtaKit", code: 1, userInfo: [NSLocalizedDescriptionKey:
        "Downloaded \(kind) \(reason); expectedSha256=\(safeExpected); actualSha256=\(actual); expectedBytes=\(expectedBytes ?? -1); receivedBytes=\(received)"])
    }
  }
}
