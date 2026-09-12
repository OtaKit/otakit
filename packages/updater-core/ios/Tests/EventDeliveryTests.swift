import XCTest

@testable import OtaKitUpdaterCore

final class EventDeliveryTests: XCTestCase {
  var directory: URL!
  var file: URL { directory.appendingPathComponent("state.json") }
  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
  func artifact(_ hash: String, release: String? = "release") -> Artifact {
    Artifact(
      appId: "app", platform: "ios", runtimeVersion: "runtime", contentHash: hash,
      version: hash, releaseId: release, bundlePath: "/owned/\(hash)/index.bundle",
      embedded: hash == "builtin")
  }
  func store() throws -> LaunchStore {
    try LaunchStore(file: file, buildId: "build", builtin: artifact("builtin", release: nil))
  }
  func worker(_ engine: LaunchStore, sender: @escaping EventDelivery.Sender) throws -> EventDelivery
  {
    try EventDelivery(
      store: engine, base: URL(string: "https://ingest.example/v1")!,
      appId: "app", platform: "ios", nativeBuild: "1", sender: sender)
  }
  func testLostResponseReplaysDurableIdentityAndBodyUntil202() async throws {
    var engine = try store()
    try engine.recordDownloadFailure(artifact("candidate"), detail: "verification failed")
    let id = try XCTUnwrap(engine.state().events.first?.id)
    var bodies: [Data] = []
    var status = 503
    let sender: EventDelivery.Sender = { url, app, body in
      XCTAssertEqual(url.absoluteString, "https://ingest.example/v1/events")
      XCTAssertEqual(app, "app")
      bodies.append(body)
      if bodies.count == 1 { throw URLError(.networkConnectionLost) }
      return status
    }
    var delivery = try worker(engine, sender: sender)
    let firstDelay = await delivery.flushOnce()
    XCTAssertEqual(firstDelay, 5)
    engine = try store()
    delivery = try worker(engine, sender: sender)
    for expected: UInt64 in [5, 10, 20, 40, 80, 160, 300, 300] {
      let delay = await delivery.flushOnce()
      XCTAssertEqual(delay, expected)
      XCTAssertEqual(engine.state().events.first?.id, id)
    }
    status = 202
    let delay = await delivery.flushOnce()
    XCTAssertEqual(delay, 0)
    XCTAssertTrue(try store().state().events.isEmpty)
    XCTAssertTrue(bodies.allSatisfy { $0 == bodies[0] })
    let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodies[0]) as? [String: Any])
    XCTAssertEqual(payload["eventId"] as? String, id)
    XCTAssertEqual(payload["releaseId"] as? String, "release")
    XCTAssertEqual(payload["action"] as? String, "download_error")
  }
  func testRetryableStatusesAndTerminalDiagnostic() async throws {
    let engine = try store()
    try engine.recordDownloadFailure(artifact("candidate"), detail: "failed")
    var status = 408
    let delivery = try worker(engine) { _, _, _ in status }
    for code in [408, 429, 500, 200] {
      status = code
      let delay = await delivery.flushOnce()
      XCTAssertGreaterThan(delay, 0)
      XCTAssertEqual(engine.state().events.count, 1)
    }
    status = 403
    let delay = await delivery.flushOnce()
    XCTAssertEqual(delay, 0)
    let recovered = try store().state()
    XCTAssertTrue(recovered.events.isEmpty)
    XCTAssertEqual(recovered.droppedEvents, 1)
    XCTAssertEqual(recovered.lastEventError, "Event delivery HTTP 403")
  }
  func testQueueBoundsExpiryAndLegacyTimestamp() throws {
    let engine = try store()
    try engine.recordDownloadFailure(artifact("candidate"), detail: "failed")
    var state = engine.state()
    let original = try XCTUnwrap(state.events.first)
    state.events = (0..<260).map { index in
      TrialEvent(
        id: UUID().uuidString, type: original.type, artifact: original.artifact,
        createdAt: Date().timeIntervalSince1970 + Double(index))
    }
    try JSONEncoder().encode(state).write(to: file)
    var recovered = try store()
    _ = try recovered.eventForDelivery()
    XCTAssertEqual(recovered.state().events.count, 256)
    XCTAssertEqual(recovered.state().droppedEvents, 4)
    state = recovered.state()
    state.events[0].createdAt = Date().timeIntervalSince1970 - 86401
    state.events[1].createdAt = nil
    let legacy = state.events[1].id
    try JSONEncoder().encode(state).write(to: file)
    recovered = try store()
    let event = try XCTUnwrap(recovered.eventForDelivery())
    XCTAssertEqual(event.id, legacy)
    XCTAssertNotNil(event.createdAt)
    XCTAssertEqual(try store().eventForDelivery(), event)
    XCTAssertEqual(recovered.state().droppedEvents, 5)
  }
  func testDownloadStagingAndAssociationDoNotDuplicateDeliveryOrSuccess() throws {
    let engine = try store()
    let generation = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try engine.bindBootstrap(generation: generation)
    engine.hostReady(generation: generation)
    try engine.stage(artifact("candidate"), from: generation, downloaded: true)
    XCTAssertEqual(try store().state().events.map(\.type), ["downloaded"])
    try engine.stage(artifact("candidate"), from: generation)
    let trial = try engine.apply(from: generation, now: 0)
    try engine.bindBootstrap(generation: trial)
    try engine.stage(artifact("candidate", release: "other"), from: trial)
    XCTAssertEqual(engine.state().current.releaseId, "release")
    try engine.notifyReady(from: trial)
    try engine.stage(artifact("candidate", release: "other"), from: trial)
    XCTAssertNil(engine.state().staged)
    XCTAssertEqual(engine.state().current.releaseId, "other")
    XCTAssertEqual(engine.state().events.map(\.type), ["downloaded", "applied"])
    XCTAssertEqual(engine.state().events.last?.artifact.releaseId, "release")
  }
  func testEmbeddedSwitchRequiresReadinessAndRecoversOutgoingPublication() throws {
    var engine = try store()
    try engine.stage(artifact("candidate"))
    var generation = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try engine.bindBootstrap(generation: generation)
    try engine.notifyReady(from: generation)
    engine.hostReady(generation: generation)
    try engine.stage(artifact("builtin", release: "baseline"), from: generation)
    generation = try engine.apply(from: generation, now: 0)
    XCTAssertEqual(engine.state().trialGeneration, generation)
    XCTAssertEqual(engine.state().lastGood.contentHash, "candidate")
    engine = try store()
    XCTAssertEqual(engine.state().current.contentHash, "candidate")
    XCTAssertEqual(engine.state().events.last?.artifact.releaseId, "baseline")
    XCTAssertEqual(engine.state().events.last?.type, "rollback")
  }
  func testMissingReleaseIsDiscardedAndFailedAckKeepsOriginalIdentity() async throws {
    let engine = try store()
    try engine.stage(artifact("candidate", release: nil))
    let generation = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try engine.bindBootstrap(generation: generation)
    try engine.notifyReady(from: generation)
    var sends = 0
    let delivery = try worker(engine) { _, _, _ in
      sends += 1
      return 202
    }
    _ = await delivery.flushOnce()
    XCTAssertEqual(sends, 0)
    XCTAssertEqual(engine.state().droppedEvents, 1)
    try engine.recordDownloadFailure(artifact("other"), detail: "failed")
    let id = engine.state().events.first?.id
    let saved = try Data(contentsOf: file)
    try FileManager.default.removeItem(at: file)
    try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
    let delay = await delivery.flushOnce()
    XCTAssertEqual(delay, 5)
    XCTAssertEqual(engine.state().events.first?.id, id)
    try FileManager.default.removeItem(at: file)
    try saved.write(to: file)
    XCTAssertEqual(try store().state().events.first?.id, id)
  }

  func testMalformedOutboxCannotResetHealthyCode() throws {
    let engine = try store()
    try engine.stage(artifact("candidate"))
    let generation = try engine.beginLaunch(foreground: true, activateStaged: true, now: 0)
    try engine.bindBootstrap(generation: generation)
    try engine.notifyReady(from: generation)
    var saved = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    saved["events"] = [42, (saved["events"] as! [Any])[0], ["type": "invalid"]]
    try JSONSerialization.data(withJSONObject: saved).write(to: file)
    let recovered = try store()
    XCTAssertEqual(recovered.state().current.contentHash, "candidate")
    XCTAssertEqual(recovered.state().events.count, 1)
    XCTAssertEqual(recovered.state().droppedEvents, 2)
    XCTAssertEqual(recovered.state().lastEventError, "Invalid saved event payload")
  }

  func testConcurrentFlushCannotSendSameHeadTwice() async throws {
    let engine = try store()
    try engine.recordDownloadFailure(artifact("candidate"), detail: "failed")
    let gate = EventSenderGate()
    let delivery = try worker(engine) { _, _, _ in await gate.send() }
    let first = Task { await delivery.flushOnce() }
    await gate.waitForSend()
    let concurrentDelay = await delivery.flushOnce()
    XCTAssertEqual(concurrentDelay, 5)
    await gate.accept()
    let result = await first.value
    XCTAssertEqual(result, 0)
    XCTAssertTrue(engine.state().events.isEmpty)
  }
}

private actor EventSenderGate {
  private var response: CheckedContinuation<Int, Never>?
  private var waiting: CheckedContinuation<Void, Never>?
  func send() async -> Int {
    await withCheckedContinuation { continuation in
      response = continuation
      waiting?.resume()
      waiting = nil
    }
  }
  func waitForSend() async {
    if response != nil { return }
    await withCheckedContinuation { waiting = $0 }
  }
  func accept() {
    response?.resume(returning: 202)
    response = nil
  }
}
