import CryptoKit
import Darwin
import Foundation

/// Receipts live outside the hashed payload and are checked again before a cold launch.
public final class ArtifactCache {
  private let root: URL
  private let builtin: Artifact
  private let installer: ArtifactInstaller
  private let keys: [String: Data]
  private let rnVersion: String
  private let bytecodeVersion: UInt32

  public init(
    root: URL, builtin: Artifact, installer: ArtifactInstaller, keys: [String: Data],
    rnVersion: String, bytecodeVersion: UInt32
  ) {
    self.root = root.resolvingSymlinksInPath()
    self.builtin = builtin
    self.installer = installer
    self.keys = keys
    self.rnVersion = rnVersion
    self.bytecodeVersion = bytecodeVersion
  }
  public func directory(_ hash: String) throws -> URL {
    guard hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
      throw LaunchError.incompatibleArtifact
    }
    return root.appendingPathComponent("artifacts/\(hash)")
  }
  public func verify(_ artifact: Artifact) throws -> Bool {
    guard
      artifact.appId == builtin.appId && artifact.platform == builtin.platform
        && artifact.runtimeVersion == builtin.runtimeVersion
    else { return false }
    if artifact.embedded {
      return artifact.contentHash == builtin.contentHash && artifact.version == builtin.version
    }
    do {
      let directory = try directory(artifact.contentHash)
      guard
        artifact.bundlePath == directory.appendingPathComponent("index.bundle").path
          && directory.path == directory.resolvingSymlinksInPath().path
      else { return false }
      let data = try Data(
        contentsOf: root.appendingPathComponent(
          "receipts/\(receiptName(hash: artifact.contentHash, channel: artifact.channel))"))
      // Expiry limits new network offers. A verified installed artifact must continue to boot offline.
      let manifest = try RNManifest.verify(
        data: data, builtin: builtin, channel: artifact.channel, keys: keys,
        now: Int64(Date().timeIntervalSince1970), allowExpiredCache: true)
      guard manifest.contentHash == artifact.contentHash && manifest.version == artifact.version
      else { return false }
      _ = try verifyDirectory(manifest)
      return true
    } catch let error as CocoaError {
      if [.fileReadNoSuchFile, .fileReadCorruptFile].contains(error.code) { return false }
      // Unavailable storage is not evidence that previously valid state should be erased.
      throw error
    } catch { return false }
  }

  public func verifyDirectory(_ manifest: RNManifest) throws -> [RNFileIdentity] {
    let paths = try JSONDecoder().decode(
      [String].self,
      from: Data(
        contentsOf: root.appendingPathComponent("receipts/\(manifest.contentHash)-paths.json")))
    return try installer.verifyDirectory(
      directory(manifest.contentHash), manifest: manifest, rnVersion: rnVersion,
      bytecodeVersion: bytecodeVersion, expectedPaths: paths)
  }

  public func commit(staging: URL?, manifest: RNManifest, receipt: Data, files: [RNFileIdentity])
    throws
  {
    let destination = try directory(manifest.contentHash)
    if let staging = staging {
      try syncTree(staging)
      try FileManager.default.createDirectory(
        at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      try FileManager.default.moveItem(at: staging, to: destination)
      try sync(destination.deletingLastPathComponent())
    }
    let receipts = root.appendingPathComponent("receipts")
    try FileManager.default.createDirectory(at: receipts, withIntermediateDirectories: true)
    try write(
      try JSONEncoder().encode(files.map(\.path)),
      to: receipts.appendingPathComponent("\(manifest.contentHash)-paths.json"))
    try write(
      receipt,
      to: receipts.appendingPathComponent(
        receiptName(hash: manifest.contentHash, channel: manifest.channel)))
    try sync(receipts)
    try sync(root)
  }

  /// Call after recovered state is durable, on the transport owner with no install in flight.
  /// State transitions may continue: they can only select pointers retained by this snapshot.
  public func collect(_ state: LaunchSnapshot) throws {
    let retained = Set(
      [state.current, state.lastGood, state.previousGood, state.staged]
        .compactMap { $0 }.filter { !$0.embedded }.map(\.contentHash))
    for hash in retained { _ = try directory(hash) }
    for name in ["artifacts", "receipts", "staging"] {
      let namespace = root.appendingPathComponent(name)
      let entries: [URL]
      do {
        let values = try namespace.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true && values.isSymbolicLink != true,
          namespace.path == namespace.resolvingSymlinksInPath().path
        else { throw LaunchError.storageUnavailable }
        entries = try FileManager.default.contentsOfDirectory(
          at: namespace, includingPropertiesForKeys: nil)
      } catch let error as CocoaError where error.code == .fileReadNoSuchFile { continue }
      for entry in entries {
        let file = entry.lastPathComponent
        let hash = String(file.prefix(64))
        let obsolete: Bool
        switch name {
        case "artifacts":
          obsolete =
            file.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
            && !retained.contains(file)
        case "receipts":
          let receipt =
            file.range(
              of: "^[a-f0-9]{64}-(paths|[a-f0-9]{64})\\.json$", options: .regularExpression) != nil
          obsolete =
            (receipt && !retained.contains(hash))
            || file.range(of: "^\\.[A-Fa-f0-9-]{36}\\.tmp$", options: .regularExpression) != nil
        default:
          obsolete = UUID(uuidString: file) != nil
        }
        // removeItem unlinks symbolic links; it does not traverse their targets.
        if obsolete { try FileManager.default.removeItem(at: entry) }
      }
    }
  }
  private func write(_ data: Data, to destination: URL) throws {
    let receipts = destination.deletingLastPathComponent()
    let temporary = receipts.appendingPathComponent(".\(UUID().uuidString).tmp")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try data.write(to: temporary, options: [.withoutOverwriting])
    try sync(temporary)
    guard rename(temporary.path, destination.path) == 0 else {
      throw LaunchError.storageUnavailable
    }
  }
  private func receiptName(hash: String, channel: String?) -> String {
    let target = channel.map { "channel:\($0)" } ?? "base"
    let channelHash = SHA256.hash(data: Data(target.utf8)).map { String(format: "%02x", $0) }
      .joined()
    return "\(hash)-\(channelHash).json"
  }
  private func syncTree(_ directory: URL) throws {
    for file in try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: [.isDirectoryKey])
    {
      if try file.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true {
        try syncTree(file)
      } else {
        try sync(file)
      }
    }
    try sync(directory)
  }
  private func sync(_ url: URL) throws {
    let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW)
    guard fd >= 0 else { throw LaunchError.storageUnavailable }
    defer { close(fd) }
    guard fsync(fd) == 0 else { throw LaunchError.storageUnavailable }
  }
}
