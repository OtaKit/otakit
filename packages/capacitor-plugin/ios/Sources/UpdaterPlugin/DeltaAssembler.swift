import CryptoKit
import Foundation

enum DeltaAssemblerError: Error, LocalizedError {
  case missingFiles
  case invalidPath(String)
  case duplicatePath(String)
  case fileCountExceeded(Int)
  case totalSizeExceeded(UInt64)
  case filesHashMismatch
  case fileHashMismatch(String)
  case missingIndexHtml
  case invalidFileURL(String)

  var errorDescription: String? {
    switch self {
    case .missingFiles:
      return "Delta manifest has no files"
    case let .invalidPath(path):
      return "Invalid file path in delta manifest: \(path)"
    case let .duplicatePath(path):
      return "Duplicate file path in delta manifest: \(path)"
    case let .fileCountExceeded(count):
      return "Delta manifest exceeds file count limit: \(count)"
    case let .totalSizeExceeded(size):
      return "Delta manifest exceeds total size limit: \(size)"
    case .filesHashMismatch:
      return "Delta file list does not match the signed filesHash"
    case let .fileHashMismatch(path):
      return "Downloaded file hash mismatch: \(path)"
    case .missingIndexHtml:
      return "Delta bundle does not contain index.html"
    case let .invalidFileURL(url):
      return "Invalid file download URL: \(url)"
    }
  }
}

/// Assembles a delta-strategy bundle from per-file content-addressed objects.
///
/// The content cache (`otakit_files/<sha256>`) is the device-side state:
/// previous bundles and the builtin seed populate it, and assembling a new
/// bundle downloads only the cache misses.
final class DeltaAssembler {
  // Mirror ZipUtils' extraction limits.
  private let maxFiles = 10_000
  private let maxTotalSize: UInt64 = 500_000_000 // 500 MB

  private let cacheDirectory: URL
  private let downloader: Downloader
  private let fileManager = FileManager.default

  private static let builtinSeedMarkerName = "builtin_seed.json"

  init(cacheDirectory: URL, downloader: Downloader) {
    self.cacheDirectory = cacheDirectory
    self.downloader = downloader
  }

  // MARK: - Canonical file list

  /// Canonical file list hash — must match the server's computeFilesHash
  /// (console/lib/delta-files.ts) and the Android mirror byte-for-byte:
  /// entries sorted by UTF-8 bytes of path, lines "<path>:<sha256 lowercase>",
  /// joined with "\n", hashed with SHA-256 (hex).
  static func computeFilesHash(_ entries: [ManifestFileEntry]) -> String {
    let sorted = entries.sorted { lhs, rhs in
      let lhsBytes = Array(lhs.path.utf8)
      let rhsBytes = Array(rhs.path.utf8)
      for index in 0..<min(lhsBytes.count, rhsBytes.count) {
        if lhsBytes[index] != rhsBytes[index] {
          return lhsBytes[index] < rhsBytes[index]
        }
      }
      return lhsBytes.count < rhsBytes.count
    }
    let canonical = sorted
      .map { "\($0.path):\($0.sha256.lowercased())" }
      .joined(separator: "\n")
    let digest = SHA256.hash(data: Data(canonical.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }

  // MARK: - Validation

  private func isValidEntryPath(_ path: String) -> Bool {
    if path.isEmpty || path.count > 512 {
      return false
    }
    if path.hasPrefix("/") || path.contains("\\") {
      return false
    }
    for segment in path.split(separator: "/", omittingEmptySubsequences: false) {
      if segment.isEmpty || segment == "." || segment == ".." {
        return false
      }
    }
    for scalar in path.unicodeScalars {
      if scalar.value < 0x20 || scalar.value == 0x7f {
        return false
      }
    }
    // Metadata files the plugin writes into the bundle directory; an app
    // file with the same root-level name would be overwritten.
    if path == "bundle.json" || path == "otakit_files.json" {
      return false
    }
    return true
  }

  func validate(_ entries: [ManifestFileEntry], expectedFilesHash: String) throws {
    guard !entries.isEmpty else {
      throw DeltaAssemblerError.missingFiles
    }
    guard entries.count <= maxFiles else {
      throw DeltaAssemblerError.fileCountExceeded(entries.count)
    }

    // Key on UTF-8 bytes, not String: Swift compares canonically-equivalent
    // strings (NFC vs NFD) as equal, which would reject a manifest the
    // server and Android both accept.
    var seenPaths = Set<Data>()
    var totalSize: UInt64 = 0
    for entry in entries {
      guard isValidEntryPath(entry.path) else {
        throw DeltaAssemblerError.invalidPath(entry.path)
      }
      guard seenPaths.insert(Data(entry.path.utf8)).inserted else {
        throw DeltaAssemblerError.duplicatePath(entry.path)
      }
      if let size = entry.size, size > 0 {
        totalSize += UInt64(size)
        if totalSize > maxTotalSize {
          throw DeltaAssemblerError.totalSizeExceeded(totalSize)
        }
      }
    }

    guard seenPaths.contains(Data("index.html".utf8)) else {
      throw DeltaAssemblerError.missingIndexHtml
    }

    // The signed manifest sha256 is the filesHash; recomputing it here is what
    // extends signature coverage to every (path, sha256) pair.
    guard DeltaAssembler.computeFilesHash(entries) == expectedFilesHash.lowercased() else {
      throw DeltaAssemblerError.filesHashMismatch
    }
  }

  // MARK: - Cache

  private func cachePath(for sha256: String) -> URL {
    cacheDirectory.appendingPathComponent(sha256.lowercased(), isDirectory: false)
  }

  private func isCached(_ sha256: String) -> Bool {
    fileManager.fileExists(atPath: cachePath(for: sha256).path)
  }

  private func ensureCached(_ entry: ManifestFileEntry) async throws {
    if isCached(entry.sha256) {
      return
    }

    guard let url = URL(string: entry.url) else {
      throw DeltaAssemblerError.invalidFileURL(entry.url)
    }

    let temporary = try await downloader.download(from: url)
    defer { try? fileManager.removeItem(at: temporary) }

    guard try HashUtils.verify(fileURL: temporary, expectedSha256: entry.sha256) else {
      throw DeltaAssemblerError.fileHashMismatch(entry.path)
    }

    let destination = cachePath(for: entry.sha256)
    if fileManager.fileExists(atPath: destination.path) {
      return
    }
    // Write via temp + rename so a crash mid-copy can never leave a
    // truncated file at a content-addressed path (exists() implies valid).
    let staging = cacheDirectory.appendingPathComponent(
      ".tmp-\(UUID().uuidString)",
      isDirectory: false
    )
    try fileManager.copyItem(at: temporary, to: staging)
    do {
      try fileManager.moveItem(at: staging, to: destination)
    } catch {
      try? fileManager.removeItem(at: staging)
      // A concurrent writer may have won the rename; that's fine.
      if !fileManager.fileExists(atPath: destination.path) {
        throw error
      }
    }
  }

  // MARK: - Assembly

  /// Fill cache misses and lay out the bundle directory from the cache.
  /// `destination` must be an empty/absent directory; entries must be
  /// validated first.
  func assemble(entries: [ManifestFileEntry], into destination: URL) async throws {
    if fileManager.fileExists(atPath: destination.path) {
      try fileManager.removeItem(at: destination)
    }
    try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)

    // Resolve the destination's symlinks ONCE and derive every target from the
    // resolved base. iOS's temp dir is /var/… (a symlink to /private/var/…);
    // standardizedFileURL resolved it inconsistently between the base and the
    // appended path, so the containment check compared /var vs /private/var and
    // rejected every file. Building targets from the already-resolved base makes
    // the prefix check exact (mirrors Android's getCanonicalPath() on both sides).
    let canonicalDestination = destination.resolvingSymlinksInPath()
    let destinationPrefix = canonicalDestination.path.hasSuffix("/")
      ? canonicalDestination.path
      : canonicalDestination.path + "/"

    for entry in entries {
      try await ensureCached(entry)

      let target = canonicalDestination.appendingPathComponent(entry.path, isDirectory: false)
      // Defense in depth alongside isValidEntryPath (mirrors ZipUtils).
      guard target.path.hasPrefix(destinationPrefix) else {
        throw DeltaAssemblerError.invalidPath(entry.path)
      }
      let parent = target.deletingLastPathComponent()
      try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
      try fileManager.copyItem(at: cachePath(for: entry.sha256), to: target)
    }
  }

  // MARK: - Builtin seeding

  private struct BuiltinSeed: Codable {
    let nativeBuild: String
    let hashes: [String]
  }

  private var builtinSeedURL: URL {
    cacheDirectory.appendingPathComponent(DeltaAssembler.builtinSeedMarkerName, isDirectory: false)
  }

  private func readBuiltinSeed() -> BuiltinSeed? {
    guard let data = try? Data(contentsOf: builtinSeedURL) else {
      return nil
    }
    return try? JSONDecoder().decode(BuiltinSeed.self, from: data)
  }

  /// Hash the store-build web assets into the cache once per native build, so
  /// the first OTA only downloads what changed relative to the binary.
  /// Best-effort: failures only cost extra downloads.
  func seedFromBuiltinIfNeeded(builtinDirectory: URL, nativeBuild: String) {
    if let seed = readBuiltinSeed(), seed.nativeBuild == nativeBuild {
      return
    }

    var isDirectory: ObjCBool = false
    guard fileManager.fileExists(atPath: builtinDirectory.path, isDirectory: &isDirectory),
          isDirectory.boolValue else {
      return
    }

    var hashes: [String] = []
    let enumerator = fileManager.enumerator(
      at: builtinDirectory,
      includingPropertiesForKeys: [.isRegularFileKey],
      options: [.skipsHiddenFiles]
    )
    while let item = enumerator?.nextObject() as? URL {
      guard let isRegular = try? item.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile,
            isRegular == true else {
        continue
      }
      guard let sha256 = try? HashUtils.sha256(fileURL: item) else {
        continue
      }
      let destination = cachePath(for: sha256)
      if !fileManager.fileExists(atPath: destination.path) {
        let staging = cacheDirectory.appendingPathComponent(
          ".tmp-\(UUID().uuidString)",
          isDirectory: false
        )
        if (try? fileManager.copyItem(at: item, to: staging)) != nil {
          if (try? fileManager.moveItem(at: staging, to: destination)) == nil {
            try? fileManager.removeItem(at: staging)
          }
        }
      }
      hashes.append(sha256)
    }

    let seed = BuiltinSeed(nativeBuild: nativeBuild, hashes: hashes)
    if let data = try? JSONEncoder().encode(seed) {
      try? data.write(to: builtinSeedURL, options: .atomic)
    }
  }

  // MARK: - Eviction

  /// Remove cache entries not referenced by any live bundle and not part of
  /// the builtin seed. Best-effort.
  func pruneCache(referencedHashes: Set<String>) {
    var keep = Set(referencedHashes.map { $0.lowercased() })
    if let seed = readBuiltinSeed() {
      keep.formUnion(seed.hashes.map { $0.lowercased() })
    }

    guard let items = try? fileManager.contentsOfDirectory(atPath: cacheDirectory.path) else {
      return
    }
    for item in items {
      if item == DeltaAssembler.builtinSeedMarkerName || item.hasPrefix(".tmp-") {
        continue
      }
      if !keep.contains(item.lowercased()) {
        try? fileManager.removeItem(at: cacheDirectory.appendingPathComponent(item))
      }
    }
  }
}
