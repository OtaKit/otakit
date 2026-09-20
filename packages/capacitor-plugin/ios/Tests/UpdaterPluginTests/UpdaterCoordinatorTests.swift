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
    let ready = fixture.coordinator.prepareNotifyAppReady()
    XCTAssertEqual(ready.eventPayload?.action, .applied)
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .success)
    XCTAssertNil(fixture.coordinator.prepareNotifyAppReady().eventPayload)
  }

  func testRollbackRestoresHealthyBundleAndRemovesFailedTrial() throws {
    try fixture.installHealthy("A")
    try fixture.apply("B")
    let rollback = fixture.coordinator.prepareRollback(
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
    let startup = fixture.coordinator.normalizeStartupState(isBundleUsable: fixture.isUsable)
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds)
    XCTAssertNil(fixture.store.getStagedBundleId())
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertTrue(fixture.indexExists("A"))
  }
}

final class CoordinatorFixture {
  let root: URL
  let defaults: UserDefaults
  let suiteName = "otakit-coordinator-tests-\(UUID().uuidString)"
  let store: BundleStore
  let coordinator: UpdaterCoordinator

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
    let result = coordinator.prepareApplyStaged(
      isCompatibleRuntime: { _ in true }, isBundleUsable: isUsable
    )
    coordinator.cleanupBundles(result.cleanupBundleIds)
    return result
  }

  func installHealthy(_ id: String) throws {
    let applied = try apply(id)
    XCTAssertTrue(applied.didApply)
    let ready = coordinator.prepareNotifyAppReady()
    XCTAssertNotNil(ready.eventPayload)
    coordinator.cleanupBundles(ready.cleanupBundleIds)
  }
}
