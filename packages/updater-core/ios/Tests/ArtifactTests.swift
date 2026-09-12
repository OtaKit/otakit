import XCTest

@testable import OtaKitUpdaterCore

final class ArtifactTests: XCTestCase {
  var root: URL!
  var fixture: [String: Any]!
  var installer: ArtifactInstaller!
  let builtin = Artifact(
    appId: "app-1", platform: "ios", runtimeVersion: String(repeating: "A", count: 43),
    contentHash: String(repeating: "0", count: 64), version: "builtin",
    bundlePath: "/embedded/index.bundle", embedded: true)
  override func setUpWithError() throws {
    let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    fixture =
      try JSONSerialization.jsonObject(
        with: Data(contentsOf: package.appendingPathComponent("fixtures/artifacts-v3.json")))
      as? [String: Any]
    installer = try ArtifactInstaller(
      caseFoldingData: Data(
        contentsOf: package.deletingLastPathComponent().appendingPathComponent(
          "rn-protocol/src/unicode/case-folding-15.0.0.json")))
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
  var keys: [String: Data] { ["fixture": Data(base64Encoded: fixture["publicKey"] as! String)!] }

  func testCollectionRetainsEveryLaunchPointerAndDoesNotFollowLinks() throws {
    let cache = ArtifactCache(
      root: root, builtin: builtin, installer: installer, keys: keys,
      rnVersion: "0.86.3", bytecodeVersion: 96)
    func pointer(_ digit: String) throws -> Artifact {
      let hash = String(repeating: digit, count: 64)
      let directory = try cache.directory(hash)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try Data(digit.utf8).write(to: directory.appendingPathComponent("index.bundle"))
      return Artifact(
        appId: builtin.appId, platform: builtin.platform, runtimeVersion: builtin.runtimeVersion,
        contentHash: hash, version: digit,
        bundlePath: directory.appendingPathComponent("index.bundle").path)
    }
    let current = try pointer("1")
    let fallback = try pointer("2")
    let previous = try pointer("3")
    let staged = try pointer("4")
    let orphan = try pointer("5")
    let receipts = root.appendingPathComponent("receipts")
    try FileManager.default.createDirectory(at: receipts, withIntermediateDirectories: true)
    for artifact in [current, fallback, previous, staged, orphan] {
      for suffix in ["paths", String(repeating: "a", count: 64), String(repeating: "b", count: 64)]
      {
        try Data("receipt".utf8).write(
          to: receipts.appendingPathComponent("\(artifact.contentHash)-\(suffix).json"))
      }
    }
    let outside = root.appendingPathComponent("keep-outside")
    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
    let marker = outside.appendingPathComponent("marker")
    try Data("keep".utf8).write(to: marker)
    let link = root.appendingPathComponent("artifacts/\(String(repeating: "6", count: 64))")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside)
    try FileManager.default.createSymbolicLink(
      at: try cache.directory(orphan.contentHash).appendingPathComponent("nested"),
      withDestinationURL: outside)
    let partial = root.appendingPathComponent("staging/\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: partial, withIntermediateDirectories: true)
    try Data("partial".utf8).write(to: partial.appendingPathComponent("payload"))
    let stateFile = root.appendingPathComponent("launch.json")
    var state = LaunchSnapshot(buildId: "build", current: current, lastGood: fallback)
    state.previousGood = previous
    state.staged = staged
    state.events = [TrialEvent(id: "outbox", type: "rollback", artifact: orphan)]
    try JSONEncoder().encode(state).write(to: stateFile)
    let original = try Data(contentsOf: stateFile)
    try cache.collect(state)
    try cache.collect(state)
    XCTAssertEqual(try Data(contentsOf: stateFile), original)
    XCTAssertEqual(try Data(contentsOf: marker), Data("keep".utf8))
    for artifact in [current, fallback, previous, staged] {
      XCTAssertTrue(FileManager.default.fileExists(atPath: artifact.bundlePath))
      XCTAssertTrue(
        FileManager.default.fileExists(
          atPath: receipts.appendingPathComponent("\(artifact.contentHash)-paths.json").path))
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.bundlePath))
    XCTAssertFalse(FileManager.default.fileExists(atPath: link.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: partial.path))
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: receipts.path).count, 12)
  }

  func testCollectionRejectsLinkedNamespacesAndKeepsOutsideFiles() throws {
    let cache = ArtifactCache(
      root: root, builtin: builtin, installer: installer, keys: keys,
      rnVersion: "0.86.3", bytecodeVersion: 96)
    let outside = root.appendingPathComponent("outside")
    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
    let marker = outside.appendingPathComponent(String(repeating: "a", count: 64))
    try Data("keep".utf8).write(to: marker)
    try FileManager.default.createSymbolicLink(
      at: root.appendingPathComponent("artifacts"), withDestinationURL: outside)
    XCTAssertThrowsError(
      try cache.collect(LaunchSnapshot(buildId: "build", current: builtin, lastGood: builtin)))
    XCTAssertEqual(try Data(contentsOf: marker), Data("keep".utf8))
  }
  func manifest(_ index: Int) throws -> (RNManifest, Data) {
    let value = (fixture["cases"] as! [[String: Any]])[index]
    let data = try JSONSerialization.data(withJSONObject: value["manifest"]!)
    let parsed = try RNManifest.verify(
      data: data, builtin: builtin, channel: nil, keys: keys, now: 1001)
    XCTAssertEqual(
      String(data: try parsed.canonicalPayload(), encoding: .utf8), value["canonical"] as? String)
    return (parsed, data)
  }
  func testPlainAndEncryptedZipVerifyActualInventoryAndRejectWrongKeys() throws {
    for index in 0...1 {
      let (manifest, _) = try manifest(index)
      let archive = root.appendingPathComponent("archive-\(index)")
      try Data(base64Encoded: fixture[index == 0 ? "archive" : "encryptedArchive"] as! String)!
        .write(to: archive)
      let output = root.appendingPathComponent("output-\(index)")
      try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
      let bundleKeys =
        manifest.encryption.map { [$0.kid: Data(base64Encoded: fixture["bundleKey"] as! String)!] }
        ?? [:]
      if index == 1 {
        XCTAssertThrowsError(
          try installer.installZip(
            archiveURL: archive, into: output, manifest: manifest, bundleKeys: [:],
            rnVersion: "0.86.3", bytecodeVersion: 96))
      }
      let files = try installer.installZip(
        archiveURL: archive, into: output, manifest: manifest, bundleKeys: bundleKeys,
        rnVersion: "0.86.3", bytecodeVersion: 96)
      XCTAssertEqual(files.count, 5)
      XCTAssertTrue(files.contains { $0.path == "assets/café #1%.txt" })
      try Data("tampered".utf8).write(to: output.appendingPathComponent("index.bundle"))
      XCTAssertThrowsError(
        try installer.verifyDirectory(
          output, manifest: manifest, rnVersion: "0.86.3", bytecodeVersion: 96))
    }
  }
  func testPathAliasesAndSignedDeltaSizesAreCheckedBeforeInstallation() throws {
    let required = ["index.bundle", "otakit-bundle.json"]
    for paths in [
      ["Images/a", "images/b"], ["café/a", "cafe\u{301}/b"], ["Straße/a", "STRASSE/b"],
      ["../escape"], ["BUNDLE.JSON/x"],
    ] {
      XCTAssertThrowsError(try installer.validatePaths(required + paths))
    }
    let (manifest, data) = try manifest(2)
    try installer.validateDeltaInventory(manifest)
    var raw = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    var files = raw["files"] as! [[String: Any]]
    files[0]["size"] = (files[0]["size"] as! Int) + 1
    raw["files"] = files
    // File sizes are transport declarations; the signed total and actual byte checks must reject tampering.
    let tampered = try RNManifest.verify(
      data: JSONSerialization.data(withJSONObject: raw), builtin: builtin, channel: nil, keys: keys,
      now: 1001)
    XCTAssertThrowsError(try installer.validateDeltaInventory(tampered))
  }
  func testColdCacheReverifiesExpiredSignedBytesAndRejectsMissingOrChangedArtifacts() throws {
    let (manifest, receipt) = try manifest(0)
    let archive = root.appendingPathComponent("archive")
    try Data(base64Encoded: fixture["archive"] as! String)!.write(to: archive)
    let staging = root.appendingPathComponent("staging")
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
    let files = try installer.installZip(
      archiveURL: archive, into: staging, manifest: manifest, bundleKeys: [:], rnVersion: "0.86.3",
      bytecodeVersion: 96)
    let cache = ArtifactCache(
      root: root, builtin: builtin, installer: installer, keys: keys, rnVersion: "0.86.3",
      bytecodeVersion: 96)
    try cache.commit(staging: staging, manifest: manifest, receipt: receipt, files: files)
    let directory = try cache.directory(manifest.contentHash)
    let artifact = Artifact(
      appId: builtin.appId, platform: builtin.platform, runtimeVersion: builtin.runtimeVersion,
      contentHash: manifest.contentHash,
      version: manifest.version, releaseId: manifest.releaseId,
      bundlePath: directory.appendingPathComponent("index.bundle").path)
    XCTAssertTrue(try cache.verify(artifact))
    XCTAssertThrowsError(
      try RNManifest.verify(
        data: receipt, builtin: builtin, channel: nil, keys: keys, now: 40_000_000))
    try FileManager.default.removeItem(at: directory.appendingPathComponent("index.bundle"))
    XCTAssertFalse(try cache.verify(artifact))
    let stateFile = root.appendingPathComponent("state.json")
    let first = try LaunchStore(file: stateFile, buildId: "build", builtin: builtin)
    try first.stage(artifact)
    let recovered = try LaunchStore(
      file: stateFile, buildId: "build", builtin: builtin,
      validateCachedArtifact: { try cache.verify($0) })
    XCTAssertNil(recovered.state().staged)
    XCTAssertEqual(recovered.state().current, builtin)
    try cache.collect(recovered.state())
    XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
    let repairedFiles = try installer.installZip(
      archiveURL: archive, into: staging, manifest: manifest,
      bundleKeys: [:], rnVersion: "0.86.3", bytecodeVersion: 96)
    try cache.commit(staging: staging, manifest: manifest, receipt: receipt, files: repairedFiles)
    XCTAssertTrue(try cache.verify(artifact))
  }
}
