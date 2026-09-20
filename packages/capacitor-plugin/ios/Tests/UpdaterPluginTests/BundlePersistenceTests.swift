import Foundation
import XCTest
@testable import UpdaterPlugin

final class BundlePersistenceTests: XCTestCase {
  private var fixture: CoordinatorFixture!

  override func setUpWithError() throws { fixture = try CoordinatorFixture() }
  override func tearDownWithError() throws { try fixture.cleanup() }

  func testFailedActivationCommitSurvivesRestartAndCanRetry() throws {
    try fixture.installHealthy("A")
    try fixture.stage("B")
    try fixture.withReadOnlyState {
      XCTAssertThrowsError(try fixture.coordinator.prepareApplyStaged(
        isCompatibleRuntime: { _ in true }, isBundleUsable: fixture.isUsable
      ))
      XCTAssertEqual(fixture.store.getBundle(id: "B")?.status, .trial)
    }
    let reopened = fixture.reopenStore()
    XCTAssertEqual(reopened.getCurrentBundle().id, "A")
    XCTAssertEqual(reopened.getFallbackBundle().id, "A")
    XCTAssertEqual(reopened.getStagedBundleId(), "B")
    let coordinator = UpdaterCoordinator(store: reopened)
    let startup = try coordinator.normalizeStartupState(isBundleUsable: fixture.isUsable)
    XCTAssertNil(startup.eventPayload)
    XCTAssertEqual(startup.activationPath, reopened.bundleDirectory(for: "A").path)
    XCTAssertTrue(try coordinator.prepareApplyStaged(
      isCompatibleRuntime: { _ in true }, isBundleUsable: fixture.isUsable
    ).didApply)
  }

  func testFailedReadinessCommitKeepsFallbackAndCanRetryExactlyOnce() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    try fixture.withReadOnlyState {
      XCTAssertThrowsError(try fixture.coordinator.prepareNotifyAppReady())
      XCTAssertEqual(fixture.store.getCurrentBundle().status, .success)
      XCTAssertEqual(fixture.reopenStore().getFallbackBundle().id, "A")
      XCTAssertTrue(fixture.indexExists("A"))
    }
    let ready = try fixture.coordinator.prepareNotifyAppReady()
    XCTAssertEqual(ready.eventPayload?.action, .applied)
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds)
    XCTAssertFalse(fixture.indexExists("A"))
    XCTAssertTrue(fixture.indexExists("B"))
    XCTAssertNil(try fixture.coordinator.prepareNotifyAppReady().eventPayload)
  }

  func testFailedRollbackCommitKeepsBothBundlesAndCanRetry() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    let trial = try XCTUnwrap(fixture.trial)
    try fixture.withReadOnlyState {
      XCTAssertThrowsError(try fixture.coordinator.prepareRollback(
        expectedTrial: trial, reason: "notify_timeout", isBundleUsable: fixture.isUsable
      ))
      let reopened = fixture.reopenStore()
      XCTAssertEqual(reopened.getCurrentBundle().id, "B")
      XCTAssertEqual(reopened.getCurrentBundle().status, .trial)
      XCTAssertEqual(reopened.getFallbackBundle().id, "A")
      XCTAssertNil(reopened.getLastFailedBundle())
      XCTAssertTrue(fixture.indexExists("A"))
      XCTAssertTrue(fixture.indexExists("B"))
    }
    let rollback = try fixture.coordinator.prepareRollback(
      expectedTrial: trial, reason: "notify_timeout", isBundleUsable: fixture.isUsable
    )
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds)
    XCTAssertTrue(rollback.didRollback)
    let reopened = fixture.reopenStore()
    XCTAssertEqual(reopened.getCurrentBundle().id, "A")
    XCTAssertEqual(reopened.getLastFailedBundle()?.id, "B")
    XCTAssertEqual(reopened.getLastFailedBundle()?.status, .error)
    XCTAssertTrue(fixture.indexExists("A"))
    XCTAssertFalse(fixture.indexExists("B"))
  }

  func testLegacyPreferencesMigrateOnFirstWrite() throws {
    fixture.defaults.set("A", forKey: "otakit_current_bundle_id")
    fixture.defaults.set("A", forKey: "otakit_fallback_bundle_id")
    fixture.defaults.set("B", forKey: "otakit_staged_bundle_id")
    XCTAssertEqual(fixture.store.getCurrentBundleId(), "A")
    try fixture.store.setStagedBundleId("C")
    fixture.defaults.set("obsolete", forKey: "otakit_current_bundle_id")
    let reopened = fixture.reopenStore()
    XCTAssertEqual(reopened.getCurrentBundleId(), "A")
    XCTAssertEqual(reopened.getFallbackBundleId(), "A")
    XCTAssertEqual(reopened.getStagedBundleId(), "C")
  }

  func testCorruptStateCannotAuthorizeMutationOrCleanup() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    try Data("{truncated".utf8).write(to: fixture.root.appendingPathComponent("otakit-state.json"))
    XCTAssertThrowsError(try fixture.coordinator.normalizeStartupState(isBundleUsable: fixture.isUsable))
    XCTAssertThrowsError(try fixture.store.setCurrentBundleId("C"))
    fixture.coordinator.cleanupBundles(["A", "B"])
    XCTAssertTrue(fixture.indexExists("A"))
    XCTAssertTrue(fixture.indexExists("B"))
  }
}
