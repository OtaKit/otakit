import Foundation
import XCTest
@testable import UpdaterPlugin

final class UpdaterCoordinatorTests: XCTestCase {
  private var fixture: CoordinatorFixture!

  override func setUpWithError() throws {
    fixture = try CoordinatorFixture()
  }

  override func tearDownWithError() throws {
    try fixture.cleanup()
  }

  func testReadinessAcknowledgesOnlyOnce() throws {
    try fixture.apply("A")
    let ready = try fixture.coordinator.prepareNotifyAppReady()
    XCTAssertEqual(ready.eventPayload?.action, .applied)
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .success)
    XCTAssertNil(try fixture.coordinator.prepareNotifyAppReady().eventPayload)
  }

  func testTimeoutAfterReadinessDoesNotRollBackSuccess() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    let ready = try fixture.coordinator.prepareNotifyAppReady()
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds)
    let rollback = try fixture.coordinator.prepareRollback(
      expectedTrial: try XCTUnwrap(fixture.trial),
      reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds)
    XCTAssertFalse(rollback.didRollback)
    XCTAssertNil(rollback.eventPayload)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "B")
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .success)
    XCTAssertTrue(fixture.indexExists("B"))
  }

  func testFailedReadinessWritePreservesHealthyFallback() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    try fixture.withReadOnlyMetadata("B") {
      XCTAssertThrowsError(try fixture.coordinator.prepareNotifyAppReady())
      XCTAssertEqual(fixture.store.getCurrentBundle().status, .trial)
      XCTAssertEqual(fixture.store.getFallbackBundle().id, "A")
      XCTAssertTrue(fixture.indexExists("A"))
    }
  }

  func testFailedTrialWriteDoesNotSwitchCurrentBundle() throws {
    try fixture.installHealthy("A")
    try fixture.stage("B")
    try fixture.withReadOnlyMetadata("B") {
      XCTAssertThrowsError(try fixture.coordinator.prepareApplyStaged(
        isCompatibleRuntime: { _ in true }, isBundleUsable: fixture.isUsable
      ))
      XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
      XCTAssertEqual(fixture.store.getStagedBundleId(), "B")
      XCTAssertTrue(fixture.indexExists("A"))
    }
  }

  func testOldTimeoutDoesNotAffectNewTrial() throws {
    try fixture.installHealthy("A")
    let oldTrial = try XCTUnwrap(fixture.apply("B").trial)
    let ready = try fixture.coordinator.prepareNotifyAppReady()
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds)
    try fixture.apply("C")
    let stale = try fixture.coordinator.prepareRollback(
      expectedTrial: oldTrial, reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    XCTAssertFalse(stale.didRollback)
    XCTAssertTrue(stale.cleanupBundleIds.isEmpty)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "C")
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .trial)
  }

  func testOldTimeoutDoesNotAffectRetryOfSameBundle() throws {
    try fixture.installHealthy("A")
    let oldTrial = try XCTUnwrap(fixture.apply("B").trial)
    let failed = try fixture.coordinator.prepareRollback(
      expectedTrial: oldTrial, reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    fixture.coordinator.cleanupBundles(failed.cleanupBundleIds)
    let retry = try XCTUnwrap(fixture.apply("B").trial)
    XCTAssertNotEqual(oldTrial.activationId, retry.activationId)
    let stale = try fixture.coordinator.prepareRollback(
      expectedTrial: oldTrial, reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    XCTAssertFalse(stale.didRollback)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "B")
    let actual = try fixture.coordinator.prepareRollback(
      expectedTrial: retry, reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    XCTAssertTrue(actual.didRollback)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    let duplicate = try fixture.coordinator.prepareRollback(
      expectedTrial: retry, reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    XCTAssertFalse(duplicate.didRollback)
  }

  func testRollbackRestoresHealthyBundleAndRemovesFailedTrial() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    let rollback = try fixture.coordinator.prepareRollback(
      expectedTrial: try XCTUnwrap(fixture.trial),
      reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds)
    XCTAssertTrue(rollback.didRollback)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .success)
    XCTAssertTrue(fixture.indexExists("A"))
    XCTAssertFalse(fixture.indexExists("B"))
    XCTAssertEqual(rollback.activationPath, fixture.store.bundleDirectory(for: "A").path)
  }

  func testStartupRejectsIncompleteStagedBundle() throws {
    try fixture.installHealthy("A")
    try fixture.stage("B")
    try FileManager.default.removeItem(at: fixture.indexURL("B"))
    let startup = try fixture.coordinator.normalizeStartupState(isBundleUsable: fixture.isUsable)
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds)
    XCTAssertNil(fixture.store.getStagedBundleId())
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertTrue(fixture.indexExists("A"))
  }

  func testSecondActivationWaitsForCurrentTrialAndPreservesHealthyFallback() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    let second = try fixture.apply("C")
    XCTAssertFalse(second.didApply)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "B")
    XCTAssertEqual(fixture.store.getFallbackBundle().id, "A")
    XCTAssertEqual(fixture.store.getStagedBundleId(), "C")

    let rollback = try fixture.coordinator.prepareRollback(
      expectedTrial: try XCTUnwrap(fixture.trial),
      reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds)
    let startup = try fixture.coordinator.normalizeStartupState(isBundleUsable: fixture.isUsable)
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertTrue(fixture.indexExists("A"))
  }

  func testLegacySelfFallbackRestoresBuiltinInsteadOfDeletingActivationTarget() throws {
    try fixture.apply("B")
    try fixture.store.setFallbackBundleId("B")
    let startup = try fixture.coordinator.normalizeStartupState(isBundleUsable: fixture.isUsable)
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds)
    XCTAssertNil(startup.activationPath)
    XCTAssertTrue(fixture.store.getCurrentBundle().isBuiltin)
    XCTAssertNil(fixture.store.getFallbackBundleId())
  }

  func testDeferredUpdateCanApplyAfterReadiness() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    XCTAssertFalse(try fixture.apply("C").didApply)
    let ready = try fixture.coordinator.prepareNotifyAppReady()
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds)
    let applied = try fixture.coordinator.prepareApplyStaged(
      isCompatibleRuntime: { _ in true }, isBundleUsable: fixture.isUsable
    )
    XCTAssertTrue(applied.didApply)
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "C")
    XCTAssertEqual(fixture.store.getFallbackBundle().id, "B")
    XCTAssertEqual(fixture.store.getFallbackBundle().status, .success)
    XCTAssertTrue(fixture.indexExists("B"))
  }

  func testRollbackNeverRestoresAnUnconfirmedFallback() throws {
    try fixture.apply("B")
    try fixture.stage("C")
    try fixture.store.setFallbackBundleId("C")
    let rollback = try fixture.coordinator.prepareRollback(
      expectedTrial: try XCTUnwrap(fixture.trial),
      reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds)
    XCTAssertNil(rollback.activationPath)
    XCTAssertTrue(fixture.store.getCurrentBundle().isBuiltin)
  }

  func testCleanupRechecksReferencesBeforeDeleting() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    try fixture.stage("C")
    fixture.coordinator.cleanupBundles(["A", "B", "C", "builtin"])
    XCTAssertTrue(fixture.indexExists("A"))
    XCTAssertTrue(fixture.indexExists("B"))
    XCTAssertTrue(fixture.indexExists("C"))
  }
}

final class CoordinatorFixture {
  let root: URL
  let defaults: UserDefaults
  let suiteName = "otakit-coordinator-tests-\(UUID().uuidString)"
  let store: BundleStore
  let coordinator: UpdaterCoordinator
  var trial: UpdaterCoordinator.Trial?

  init() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
    store = BundleStore(defaults: defaults, rootDirectory: root)
    coordinator = UpdaterCoordinator(store: store)
  }

  func cleanup() throws {
    defaults.removePersistentDomain(forName: suiteName)
    try FileManager.default.removeItem(at: root)
  }

  func withReadOnlyMetadata(_ id: String, work: () throws -> Void) throws {
    let directory = store.bundleDirectory(for: id)
    let metadata = directory.appendingPathComponent("bundle.json")
    let manager = FileManager.default
    try manager.setAttributes([.posixPermissions: 0o400], ofItemAtPath: metadata.path)
    try manager.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
    defer {
      try? manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
      try? manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: metadata.path)
    }
    try work()
  }

  func reopenStore() -> BundleStore {
    BundleStore(defaults: defaults, rootDirectory: root)
  }

  func withReadOnlyState(work: () throws -> Void) throws {
    let manager = FileManager.default
    try manager.setAttributes([.posixPermissions: 0o500], ofItemAtPath: root.path)
    defer { try? manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path) }
    try work()
  }

  func indexURL(_ id: String) -> URL {
    store.bundleDirectory(for: id).appendingPathComponent("index.html")
  }

  func indexExists(_ id: String) -> Bool {
    FileManager.default.fileExists(atPath: indexURL(id).path)
  }

  func isUsable(_ bundle: BundleInfo) -> Bool {
    bundle.isBuiltin || indexExists(bundle.id)
  }

  func stage(_ id: String) throws {
    let directory = store.bundleDirectory(for: id)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(id.utf8).write(to: indexURL(id))
    let bundle = BundleInfo(
      id: id, version: id, runtimeVersion: nil, status: .pending, downloadedAt: Date(),
      sha256: "hash-\(id)", path: directory.path, channel: nil, releaseId: "release-\(id)"
    )
    coordinator.cleanupBundles(try coordinator.stageDownloadedBundle(bundle))
  }

  @discardableResult
  func apply(_ id: String) throws -> UpdaterCoordinator.ApplyPreparation {
    try stage(id)
    let result = try coordinator.prepareApplyStaged(
      isCompatibleRuntime: { _ in true }, isBundleUsable: isUsable
    )
    if let active = result.trial { trial = active }
    coordinator.cleanupBundles(result.cleanupBundleIds)
    return result
  }

  func installHealthy(_ id: String) throws {
    let applied = try apply(id)
    XCTAssertTrue(applied.didApply)
    let ready = try coordinator.prepareNotifyAppReady()
    XCTAssertNotNil(ready.eventPayload)
    coordinator.cleanupBundles(ready.cleanupBundleIds)
  }
}
