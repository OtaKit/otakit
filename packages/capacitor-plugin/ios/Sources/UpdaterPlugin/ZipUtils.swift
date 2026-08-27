import Foundation
import ZIPFoundation

enum ZipUtilsError: LocalizedError {
  case invalidZip
  case pathTraversal(String)
  case absolutePath(String)
  case symlinkNotAllowed(String)
  case unsupportedEntry(String)
  case fileCountExceeded(Int)
  case totalSizeExceeded(UInt64)

  var errorDescription: String? {
    switch self {
    case .invalidZip:
      return "Downloaded bundle is not a readable ZIP archive"
    case let .pathTraversal(path):
      return "ZIP entry contains a parent-directory path component: \(path)"
    case let .absolutePath(path):
      return "ZIP entry uses an absolute path: \(path)"
    case let .symlinkNotAllowed(path):
      return "ZIP entry is a symbolic link: \(path)"
    case let .unsupportedEntry(path):
      return "ZIP entry has an unsupported type: \(path)"
    case let .fileCountExceeded(count):
      return "ZIP archive contains too many files: \(count)"
    case let .totalSizeExceeded(size):
      return "ZIP archive expands beyond the size limit: \(size) bytes"
    }
  }
}

final class ZipUtils {
  private let maxFiles = 10_000
  private let maxTotalSize: UInt64 = 500_000_000 // 500 MB

  func extractSecurely(zipURL: URL, to destination: URL) throws {
    let archive: Archive
    do {
      archive = try Archive(url: zipURL, accessMode: .read, pathEncoding: nil)
    } catch {
      throw ZipUtilsError.invalidZip
    }

    try validateEntries(in: archive, destination: destination)

    try FileManager.default.createDirectory(
      at: destination,
      withIntermediateDirectories: true
    )

    for entry in archive {
      let outputURL = destination.appendingPathComponent(entry.path)
      switch entry.type {
      case .directory:
        try FileManager.default.createDirectory(
          at: outputURL,
          withIntermediateDirectories: true
        )
      case .file:
        let parent = outputURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
          at: parent,
          withIntermediateDirectories: true
        )
        _ = try archive.extract(entry, to: outputURL)
      default:
        throw ZipUtilsError.unsupportedEntry(entry.path)
      }
    }
  }

  private func validateEntries(in archive: Archive, destination: URL) throws {
    let destinationPath = destination.standardizedFileURL.path
    let destinationPrefix =
      destinationPath.hasSuffix("/") ? destinationPath : "\(destinationPath)/"
    var fileCount = 0
    var totalSize: UInt64 = 0

    for entry in archive {
      try validateEntry(
        entry,
        destination: destination,
        destinationPath: destinationPath,
        destinationPrefix: destinationPrefix
      )
      guard entry.type == .file else { continue }

      fileCount += 1
      if fileCount > maxFiles {
        throw ZipUtilsError.fileCountExceeded(fileCount)
      }
      totalSize += entry.uncompressedSize
      if totalSize > maxTotalSize {
        throw ZipUtilsError.totalSizeExceeded(totalSize)
      }
    }
  }

  private func validateEntry(
    _ entry: Entry,
    destination: URL,
    destinationPath: String,
    destinationPrefix: String
  ) throws {
    if entry.path.hasPrefix("/") {
      throw ZipUtilsError.absolutePath(entry.path)
    }
    if Self.containsParentDirectoryComponent(in: entry.path) {
      throw ZipUtilsError.pathTraversal(entry.path)
    }
    if entry.type == .symlink {
      throw ZipUtilsError.symlinkNotAllowed(entry.path)
    }
    if entry.type != .directory && entry.type != .file {
      throw ZipUtilsError.unsupportedEntry(entry.path)
    }

    let outputPath = destination
      .appendingPathComponent(entry.path)
      .standardizedFileURL.path
    if !(outputPath == destinationPath || outputPath.hasPrefix(destinationPrefix)) {
      throw ZipUtilsError.pathTraversal(entry.path)
    }
  }

  static func containsParentDirectoryComponent(in path: String) -> Bool {
    path.split(separator: "/", omittingEmptySubsequences: false).contains("..")
  }
}
