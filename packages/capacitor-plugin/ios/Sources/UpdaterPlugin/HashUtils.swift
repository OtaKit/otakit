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
}
