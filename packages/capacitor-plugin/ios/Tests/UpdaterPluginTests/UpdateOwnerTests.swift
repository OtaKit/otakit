import Foundation
import XCTest
@testable import UpdaterPlugin

final class UpdateOwnerTests: XCTestCase {
  func testLostBridgeCannotPublishOrActivateAnUpdate() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.stage("B")
    var bridgeAvailable = true
    let owner = UpdateOwner(isAvailable: { bridgeAvailable })
    // A worker may have started before the bridge disappeared.
    try owner.run {}
    bridgeAvailable = false
    XCTAssertThrowsError(try owner.run {
      try fixture.coordinator.prepareApplyStaged(isCompatibleRuntime: { _ in true }, isBundleUsable: fixture.isUsable)
    }) { XCTAssertTrue($0 is CancellationError) }
    XCTAssertThrowsError(try owner.run { try fixture.stage("C") })
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertEqual(fixture.store.getFallbackBundleId(), "A")
    XCTAssertEqual(fixture.store.getStagedBundleId(), "B")
    XCTAssertTrue(fixture.indexExists("A"))
    XCTAssertFalse(fixture.indexExists("C"))
  }

  func testLiveOwnerCanStageActivateAndConfirm() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    let owner = UpdateOwner(isAvailable: { true })
    try owner.run { try fixture.installHealthy("A") }
    XCTAssertEqual(fixture.store.getCurrentBundle().status, .success)
  }
}
