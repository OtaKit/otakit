import XCTest

@testable import OtaKitUpdaterCore

final class LaunchStoreTests: XCTestCase {
  var directory: URL!
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
  func artifact(_ content: String, embedded: Bool = false) -> Artifact {
    Artifact(
      appId: "app", platform: "ios", runtimeVersion: "runtime", contentHash: content,
      version: content, bundlePath: "/owned/\(content)/index.bundle", embedded: embedded)
  }
  func store(build: String = "native-build") throws -> LaunchStore {
    try LaunchStore(
      file: directory.appendingPathComponent("state.json"), buildId: build,
      builtin: artifact("builtin", embedded: true))
  }
  func testHeadlessRetainsStagedAndRequiresBootstrapAndForegroundForApply() throws {
    let engine = try store()
    try engine.stage(artifact("candidate"))
    let generation = try engine.beginLaunch(foreground: false, activateStaged: true, now: 0)
    XCTAssertEqual(engine.state().current.contentHash, "builtin")
    XCTAssertNotNil(engine.state().staged)
    XCTAssertThrowsError(try engine.apply(from: generation, now: 0))
    try engine.bindBootstrap(generation: generation)
    engine.hostReady(generation: generation)
    XCTAssertThrowsError(try engine.apply(from: generation, now: 0))
    engine.setForeground(true, now: 1)
    XCTAssertThrowsError(try engine.apply(from: generation, now: 1))
    XCTAssertNotNil(engine.state().staged)
    let fresh = try store()
    let next = try fresh.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try fresh.bindBootstrap(generation: next)
    fresh.hostReady(generation: next)
    try fresh.notifyReady(from: next)
    try fresh.notifyReady(from: next)
    XCTAssertEqual(fresh.state().events.map(\.type), ["applied"])
    try fresh.stage(artifact("next"))
    fresh.observeBackgroundWork(from: next)
    fresh.setActivationGuard(false)
    XCTAssertThrowsError(try fresh.apply(from: next, now: 1))
  }
  func testProcessDeathRecoversOnceAndQuarantinesContent() throws {
    var engine = try store()
    try engine.stage(artifact("bad"))
    _ = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    engine = try store()
    XCTAssertEqual(engine.state().current.contentHash, "builtin")
    XCTAssertEqual(engine.state().events.map(\.type), ["rollback"])
    XCTAssertThrowsError(try engine.stage(artifact("bad")))
    XCTAssertEqual(try store().state().events.count, 1)
  }
  func testReadinessClockPausesInBackgroundAndGuardKeepsCandidate() throws {
    let engine = try store()
    try engine.stage(artifact("candidate"))
    engine.setActivationGuard(true)
    _ = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    XCTAssertEqual(engine.state().current.contentHash, "builtin")
    engine.setActivationGuard(false)
    let first = engine.state().generation
    try engine.bindBootstrap(generation: first)
    engine.hostReady(generation: first)
    _ = try engine.apply(from: first, now: 1)
    engine.setForeground(false, now: 5)
    XCTAssertFalse(try engine.checkTimeout(now: 1000))
    engine.setForeground(true, now: 1000)
    XCTAssertFalse(try engine.checkTimeout(now: 1005))
    XCTAssertTrue(try engine.checkTimeout(now: 1006))
    XCTAssertEqual(engine.state().events.map(\.type), ["rollback"])
  }
  func testNativeBuildChangeAndCorruptStateSelectEmbedded() throws {
    let engine = try store()
    try engine.stage(artifact("candidate"))
    XCTAssertNil(try store(build: "new-build").state().staged)
    try Data("invalid".utf8).write(to: directory.appendingPathComponent("state.json"))
    XCTAssertEqual(try store().state().current.contentHash, "builtin")
  }
  func testFailedDurableWriteStopsOwnerAndColdStartIsIdempotent() throws {
    let engine = try store()
    try FileManager.default.createDirectory(
      at: directory.appendingPathComponent("state.json"), withIntermediateDirectories: true)
    XCTAssertThrowsError(try engine.beginLaunch(foreground: true, activateStaged: true, now: 0))
    try FileManager.default.removeItem(at: directory.appendingPathComponent("state.json"))
    XCTAssertThrowsError(try engine.beginLaunch(foreground: true, activateStaged: true, now: 1))
    XCTAssertEqual(engine.state().generation, 0)
    let recovered = try store()
    let generation = try recovered.beginLaunch(foreground: false, activateStaged: false, now: 2)
    XCTAssertEqual(
      try recovered.beginLaunch(foreground: true, activateStaged: true, now: 3), generation)
  }
  func testStaleBindingsCannotStageOrChangeTheNextInstancesGuard() throws {
    let engine = try store()
    let old = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try engine.bindBootstrap(generation: old)
    engine.hostReady(generation: old)
    try engine.stage(artifact("first"), from: old)
    let current = try engine.apply(from: old, now: 1)
    try engine.bindBootstrap(generation: current)
    engine.hostReady(generation: current)
    try engine.notifyReady(from: current)
    XCTAssertThrowsError(try engine.stage(artifact("stale"), from: old))
    XCTAssertThrowsError(try engine.assertInstance(old))
    engine.setActivationGuard(true, from: old)
    try engine.stage(artifact("next"), from: current)
    XCTAssertNotEqual(try engine.apply(from: current, now: 2), current)
  }

  func testPreviousGoodIsDurableAndDoesNotReplaceTrialFallback() throws {
    var engine = try store()
    for hash in ["first", "second"] {
      try engine.stage(artifact(hash))
      let generation = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
      try engine.bindBootstrap(generation: generation)
      try engine.notifyReady(from: generation)
      engine = try store()
    }
    XCTAssertEqual(engine.state().previousGood?.contentHash, "first")
    try engine.stage(artifact("failed"))
    _ = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    engine = try store()
    XCTAssertEqual(engine.state().current.contentHash, "second")
    XCTAssertEqual(engine.state().previousGood?.contentHash, "first")
    XCTAssertEqual(engine.state().events.last?.type, "rollback")
    try engine.stage(artifact("builtin", embedded: true))
    let embeddedGeneration = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try engine.bindBootstrap(generation: embeddedGeneration)
    try engine.notifyReady(from: embeddedGeneration)
    XCTAssertEqual(engine.state().previousGood?.contentHash, "second")
    XCTAssertNil(try store(build: "new-native-build").state().previousGood)
  }
}
