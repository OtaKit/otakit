import CryptoKit
import Foundation
import ZIPFoundation

public struct RNFileIdentity {
  public let path: String
  public let hash: String
  public let size: Int64
}

public final class ArtifactInstaller {
  private let folding: [String: String]
  private let maxBytes: Int64 = 100 * 1024 * 1024

  public init(caseFoldingData: Data) throws {
    folding = try JSONDecoder().decode([String: String].self, from: caseFoldingData)
  }

  public func validatePaths(_ paths: [String]) throws {
    var nodes: [String: (String, Bool)] = [:]
    guard paths.count <= 5000 else { throw LaunchError.incompatibleArtifact }
    for path in paths {
      guard
        !path.isEmpty && path.utf8.count <= 512 && !path.contains("\\")
          && !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
      else { throw LaunchError.incompatibleArtifact }
      let components = path.components(separatedBy: "/")
      var spelling = ""
      for (index, part) in components.enumerated() {
        guard !part.isEmpty && part != "." && part != ".." && part.utf8.count <= 255 else {
          throw LaunchError.incompatibleArtifact
        }
        spelling += (index == 0 ? "" : "/") + part
        let folded = spelling.decomposedStringWithCanonicalMapping.unicodeScalars.map {
          folding[String($0)] ?? String($0)
        }.joined().decomposedStringWithCanonicalMapping
        guard
          !(index == 0
            && ["bundle.json", "otakit_files.json", "otakit-embedded.json"].contains(folded))
        else { throw LaunchError.incompatibleArtifact }
        let directory = index < components.count - 1
        if let prior = nodes[folded] {
          guard Array(prior.0.utf8) == Array(spelling.utf8) && prior.1 == directory && directory
          else { throw LaunchError.incompatibleArtifact }
        }
        nodes[folded] = (spelling, directory)
      }
    }
    guard paths.contains("index.bundle") && paths.contains("otakit-bundle.json") else {
      throw LaunchError.incompatibleArtifact
    }
  }

  public func installZip(
    archiveURL: URL, into root: URL, manifest: RNManifest, bundleKeys: [String: Data],
    rnVersion: String, bytecodeVersion: UInt32
  ) throws -> [RNFileIdentity] {
    guard let archiveSize = try archiveURL.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      archiveSize == manifest.size
    else { throw LaunchError.incompatibleArtifact }
    var bytes = try Data(contentsOf: archiveURL)
    guard bytes.count == manifest.size && Self.hash(bytes) == manifest.sha256 else {
      throw LaunchError.incompatibleArtifact
    }
    if let encryption = manifest.encryption {
      guard let key = bundleKeys[encryption.kid], key.count == 32,
        String(Self.hash(key).prefix(16)) == encryption.kid,
        let wrapNonce = Data(base64Encoded: encryption.wrapNonce),
        let wrapped = Data(base64Encoded: encryption.wrappedDek),
        let nonce = Data(base64Encoded: encryption.nonce)
      else { throw LaunchError.incompatibleArtifact }
      let dek = try AES.GCM.open(
        AES.GCM.SealedBox(
          nonce: AES.GCM.Nonce(data: wrapNonce), ciphertext: wrapped.prefix(32),
          tag: wrapped.suffix(16)), using: SymmetricKey(data: key))
      guard bytes.count >= 16 else { throw LaunchError.incompatibleArtifact }
      bytes = try AES.GCM.open(
        AES.GCM.SealedBox(
          nonce: AES.GCM.Nonce(data: nonce), ciphertext: bytes.dropLast(16), tag: bytes.suffix(16)),
        using: SymmetricKey(data: dek))
    }
    let archive = try Archive(data: bytes, accessMode: .read)
    let entries = Array(archive)
    // RN exporter emits files only. Reject link/alias/extra directory entries before extraction.
    guard entries.count <= 5000 else { throw LaunchError.incompatibleArtifact }
    var extractedSize: UInt64 = 0
    for entry in entries {
      guard entry.type == .file && entry.uncompressedSize <= UInt64(maxBytes) - extractedSize else {
        throw LaunchError.incompatibleArtifact
      }
      extractedSize += entry.uncompressedSize
    }
    try validatePaths(entries.map(\.path))
    // The caller owns a newly-created empty root. Resolve its filesystem aliases once.
    let canonicalRoot = root.resolvingSymlinksInPath()
    guard try FileManager.default.contentsOfDirectory(atPath: canonicalRoot.path).isEmpty else {
      throw LaunchError.incompatibleArtifact
    }
    for entry in entries {
      let destination = canonicalRoot.appendingPathComponent(entry.path)
      guard destination.path.utf8.count + 1 <= 1024 else { throw LaunchError.incompatibleArtifact }
      try FileManager.default.createDirectory(
        at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      _ = try archive.extract(entry, to: destination)
    }
    return try verifyDirectory(
      canonicalRoot, manifest: manifest, rnVersion: rnVersion, bytecodeVersion: bytecodeVersion,
      expectedPaths: entries.map(\.path))
  }

  public func verifyDirectory(
    _ root: URL, manifest: RNManifest, rnVersion: String, bytecodeVersion: UInt32,
    expectedPaths: [String]? = nil
  ) throws -> [RNFileIdentity] {
    let canonicalRoot = root.resolvingSymlinksInPath()
    let paths = expectedPaths ?? manifest.files?.map(\.path)
    var originalPaths: [String: String] = [:]
    if let paths = paths {
      try validatePaths(paths)
      for path in paths { originalPaths[path.decomposedStringWithCanonicalMapping] = path }
    }
    var enumerationError: Error?
    guard
      let enumerator = FileManager.default.enumerator(
        at: canonicalRoot,
        includingPropertiesForKeys: [
          .isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey, .fileSizeKey,
        ],
        errorHandler: { _, error in
          enumerationError = error
          return false
        })
    else { throw LaunchError.incompatibleArtifact }
    var files: [RNFileIdentity] = []
    var size: Int64 = 0
    for case let url as URL in enumerator {
      let properties = try url.resourceValues(forKeys: [
        .isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey, .fileSizeKey,
      ])
      guard
        properties.isSymbolicLink != true
          && (properties.isRegularFile == true || properties.isDirectory == true)
      else { throw LaunchError.incompatibleArtifact }
      if properties.isRegularFile == true {
        guard let fileSize = properties.fileSize,
          fileSize >= 0 && fileSize <= maxBytes - size && files.count < 5000
        else { throw LaunchError.incompatibleArtifact }
        size += Int64(fileSize)
        let components = url.resolvingSymlinksInPath().pathComponents
        let rootComponents = canonicalRoot.pathComponents
        guard Array(components.prefix(rootComponents.count)) == rootComponents else {
          throw LaunchError.incompatibleArtifact
        }
        let diskPath = components.dropFirst(rootComponents.count).joined(separator: "/")
        // Apple filesystems may return decomposed spelling. Hash the validated original spelling.
        let path: String
        if paths != nil {
          guard let original = originalPaths[diskPath.decomposedStringWithCanonicalMapping] else {
            throw LaunchError.incompatibleArtifact
          }
          path = original
        } else {
          path = diskPath
        }
        let data = try Data(contentsOf: url)
        guard data.count == fileSize else { throw LaunchError.incompatibleArtifact }
        files.append(RNFileIdentity(path: path, hash: Self.hash(data), size: Int64(fileSize)))
      }
    }
    if let error = enumerationError { throw error }
    if let paths = paths, files.count != paths.count { throw LaunchError.incompatibleArtifact }
    try validatePaths(files.map(\.path))
    let canonical = files.sorted {
      Array($0.path.utf8).lexicographicallyPrecedes(Array($1.path.utf8))
    }.map { "\($0.path):\($0.hash)" }.joined(separator: "\n")
    guard Self.hash(Data(canonical.utf8)) == manifest.contentHash else {
      throw LaunchError.incompatibleArtifact
    }
    if manifest.strategy == "deltas" {
      try validateDeltaInventory(manifest)
      let declared = Dictionary(uniqueKeysWithValues: manifest.files!.map { ($0.path, $0) })
      guard
        size == manifest.size && files.count == declared.count
          && files.allSatisfy({ file in
            declared[file.path]?.size == file.size && declared[file.path]?.sha256 == file.hash
          })
      else { throw LaunchError.incompatibleArtifact }
    }
    let descriptorData = try Data(
      contentsOf: canonicalRoot.appendingPathComponent("otakit-bundle.json"))
    guard descriptorData.count > 0 && descriptorData.count <= 256 * 1024,
      let descriptor = try JSONSerialization.jsonObject(with: descriptorData) as? [String: Any],
      descriptor["format"] as? String == "otakit-rn", descriptor["formatVersion"] as? Int == 1,
      descriptor["framework"] as? String == "react-native",
      descriptor["platform"] as? String == manifest.platform,
      descriptor["runtimeVersion"] as? String == manifest.runtimeVersion,
      descriptor["version"] as? String == manifest.version,
      descriptor["entryPoint"] as? String == "index.bundle",
      descriptor["engine"] as? String == "hermes",
      descriptor["bundleFormat"] as? String == "hermes-bytecode",
      descriptor["reactNativeVersion"] as? String == rnVersion
    else { throw LaunchError.incompatibleArtifact }
    let bytecode = try Data(contentsOf: canonicalRoot.appendingPathComponent("index.bundle"))
    guard
      bytecode.count >= 12
        && bytecode.prefix(8).map({ String(format: "%02x", $0) }).joined() == "c61fbc03c103191f"
    else { throw LaunchError.incompatibleArtifact }
    let version = bytecode[8..<12].enumerated().reduce(UInt32(0)) {
      $0 | UInt32($1.element) << ($1.offset * 8)
    }
    guard version == bytecodeVersion else { throw LaunchError.incompatibleArtifact }
    if descriptor.keys.contains("expo") {
      guard let expo = descriptor["expo"] as? [String: Any] else {
        throw LaunchError.incompatibleArtifact
      }
      guard expo["configFile"] as? String == "expo-config.json" else {
        throw LaunchError.incompatibleArtifact
      }
      let data = try Data(contentsOf: canonicalRoot.appendingPathComponent("expo-config.json"))
      guard data.count <= 256 * 1024 else { throw LaunchError.incompatibleArtifact }
      guard (try JSONSerialization.jsonObject(with: data)) is [String: Any] else {
        throw LaunchError.incompatibleArtifact
      }
      if let dom = expo["domRoot"] {
        guard
          dom as? String == "www.bundle"
            && files.contains(where: {
              $0.path.hasPrefix("www.bundle/") && $0.path.hasSuffix(".html")
            })
        else { throw LaunchError.incompatibleArtifact }
      }
    }
    return files
  }

  /// Delta URLs are transport hints; path/hash pairs must reproduce the signed content identity.
  public func validateDeltaInventory(_ manifest: RNManifest) throws {
    guard manifest.strategy == "deltas", let files = manifest.files else {
      throw LaunchError.incompatibleArtifact
    }
    try validatePaths(files.map(\.path))
    var total: Int64 = 0
    var sizes: [String: Int64] = [:]
    for file in files {
      guard
        file.size >= 0 && file.size <= maxBytes - total
          && file.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
          && (sizes[file.sha256] == nil || sizes[file.sha256] == file.size)
      else { throw LaunchError.incompatibleArtifact }
      if ["index.bundle", "otakit-bundle.json"].contains(file.path) && file.size == 0 {
        throw LaunchError.incompatibleArtifact
      }
      total += file.size
      sizes[file.sha256] = file.size
    }
    let canonical = files.sorted {
      Array($0.path.utf8).lexicographicallyPrecedes(Array($1.path.utf8))
    }.map { "\($0.path):\($0.sha256)" }.joined(separator: "\n")
    guard total == manifest.size && Self.hash(Data(canonical.utf8)) == manifest.contentHash else {
      throw LaunchError.incompatibleArtifact
    }
  }

  private static func hash(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
