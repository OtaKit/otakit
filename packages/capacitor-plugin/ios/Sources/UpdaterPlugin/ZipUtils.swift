import Foundation
import ZIPFoundation

enum ZipUtilsError: Error {
  case invalidZip
  case pathTraversal(String)
  case absolutePath(String)
  case symlinkNotAllowed(String)
  case unsupportedEntry(String)
  case fileCountExceeded(Int)
  case totalSizeExceeded(UInt64)
}

final class ZipUtils {
  private let maxFiles = 10_000
  private let maxTotalSize: UInt64 = 500_000_000 // 500 MB

  func extractSecurely(zipURL: URL, to destination: URL) throws {
    guard let archive = Archive(url: zipURL, accessMode: .read) else {
      throw ZipUtilsError.invalidZip
    }

    let destinationPath = destination.standardizedFileURL.path
    let destinationPrefix =
      destinationPath.hasSuffix("/") ? destinationPath : "\(destinationPath)/"

    var fileCount = 0
    var totalSize: UInt64 = 0

    for entry in archive {
      if entry.path.hasPrefix("/") {
        throw ZipUtilsError.absolutePath(entry.path)
      }
      if entry.path.contains("..") {
        throw ZipUtilsError.pathTraversal(entry.path)
      }
      if entry.type == .symlink {
        throw ZipUtilsError.symlinkNotAllowed(entry.path)
      }
      if entry.type != .directory && entry.type != .file {
        throw ZipUtilsError.unsupportedEntry(entry.path)
      }

      let outputURL = destination
        .appendingPathComponent(entry.path)
        .standardizedFileURL
      let outputPath = outputURL.path
      if !(outputPath == destinationPath || outputPath.hasPrefix(destinationPrefix))
      {
        throw ZipUtilsError.pathTraversal(entry.path)
      }

      if entry.type == .file {
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
}
