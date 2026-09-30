import Foundation
import XCTest
@testable import UpdaterPlugin

/// Preview link parsing and state must match Preview.java and
/// console/lib/preview-links.ts.
final class PreviewTests: XCTestCase {
  private static let token = "abcdefghijklmnopqrstuvwxyz"

  private func link(_ string: String) -> PreviewLink? {
    PreviewLink.parse(URL(string: string)!)
  }

  func testParsesStartAndExitLinksOnAnyScheme() {
    XCTAssertEqual(link("myapp://otakit-preview?token=\(Self.token)"), .start(token: Self.token))
    XCTAssertEqual(
      link("com.example.app://OTAKIT-PREVIEW?utm=x&token=\(Self.token)"),
      .start(token: Self.token)
    )
    XCTAssertEqual(link("myapp://otakit-preview?exit=1"), .exit)
    XCTAssertEqual(link("myapp://otakit-preview?exit=1&token=\(Self.token)"), .exit)
  }

  func testIgnoresEveryOtherLink() {
    for url in [
      "myapp://otakit-preview",
      "myapp://otakit-preview?token=",
      "myapp://otakit-preview?token=ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "myapp://otakit-preview?token=\(Self.token)a",
      "myapp://otakit-preview?token=abc0efghijklmnopqrstuvwxyz",
      "myapp://otakit-preview?exit=0",
      "myapp://other?token=\(Self.token)",
      "https://example.com/otakit-preview?token=\(Self.token)",
      "myapp://checkout?order=1",
    ] {
      XCTAssertNil(link(url), url)
    }
  }

  func testNamesTheHiddenChannelAndKeepsTheTokenOutOfEvents() {
    let channel = PreviewLink.channel(for: Self.token)
    XCTAssertEqual(channel, "__preview_abcdefghijklmnopqrstuvwxyz")
    XCTAssertTrue(PreviewLink.isPreviewChannel(channel))
    XCTAssertFalse(PreviewLink.isPreviewChannel("production"))
    XCTAssertFalse(PreviewLink.isPreviewChannel(nil))
    for lookalike in ["__preview", "__previews", "__preview-qa", "__preview_short"] {
      XCTAssertFalse(PreviewLink.isPreviewChannel(lookalike), lookalike)
      XCTAssertEqual(PreviewLink.reportedChannel(lookalike), lookalike)
    }
    XCTAssertEqual(PreviewLink.reportedChannel(channel), "__preview")
    XCTAssertEqual(PreviewLink.reportedChannel("production"), "production")
    XCTAssertNil(PreviewLink.reportedChannel(nil))
  }

  func testPreviewStatePersistsAndExpiresLocallyAfterThirtyDays() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    let startedAt = Date(timeIntervalSince1970: 1_790_000_000)
    let state = PreviewState(token: Self.token, startedAt: startedAt)

    XCTAssertNil(fixture.store.getPreview())
    fixture.store.setPreview(state)
    XCTAssertEqual(fixture.reopenStore().getPreview(), state)
    XCTAssertEqual(state.channel, PreviewLink.channel(for: Self.token))
    XCTAssertFalse(state.isTooOld(now: startedAt.addingTimeInterval(29 * 24 * 60 * 60)))
    XCTAssertTrue(state.isTooOld(now: startedAt.addingTimeInterval(31 * 24 * 60 * 60)))

    fixture.store.setPreview(nil)
    XCTAssertNil(fixture.reopenStore().getPreview())
  }

  private static var previewChannel: String { PreviewLink.channel(for: token) }

  func testAHealthyPreviewKeepsTheBundleFromBeforeItAsFallback() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.installHealthy("P", channel: Self.previewChannel)

    XCTAssertEqual(fixture.store.getCurrentBundle().id, "P")
    XCTAssertEqual(fixture.store.getFallbackBundle().id, "A")
    XCTAssertTrue(fixture.indexExists("A"))
  }

  func testLeavingAPreviewReturnsToTheBundleFromBeforeIt() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.installHealthy("P", channel: Self.previewChannel)
    try fixture.stage("Q", channel: Self.previewChannel)

    let leave = try fixture.coordinator.prepareLeavePreview(isBundleUsable: fixture.isUsable)

    XCTAssertEqual(leave.activationPath, fixture.store.getBundle(id: "A")?.path)
    XCTAssertEqual(Set(leave.cleanupBundleIds), ["P", "Q"])
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertEqual(fixture.store.getFallbackBundle().id, "A")
    XCTAssertNil(fixture.store.getStagedBundleId())
    fixture.coordinator.cleanupBundles(leave.cleanupBundleIds)
    XCTAssertTrue(fixture.indexExists("A"))
    XCTAssertFalse(fixture.indexExists("P"))
  }

  func testLeavingAPreviewWithNothingBeforeItUsesTheBuiltinBundle() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("P", channel: Self.previewChannel)

    let leave = try fixture.coordinator.prepareLeavePreview(isBundleUsable: fixture.isUsable)

    XCTAssertNil(leave.activationPath)
    XCTAssertEqual(leave.cleanupBundleIds, ["P"])
    XCTAssertTrue(fixture.store.getCurrentBundle().isBuiltin)
    XCTAssertTrue(fixture.store.getFallbackBundle().isBuiltin)
  }

  func testAReleaseAppliedOverAPreviewKeepsTheEarlierFallback() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.installHealthy("P", channel: Self.previewChannel)

    let applied = try fixture.apply("R")
    XCTAssertTrue(applied.didApply)
    XCTAssertEqual(fixture.store.getFallbackBundle().id, "A")
    XCTAssertFalse(fixture.indexExists("P"))

    let ready = try fixture.coordinator.prepareNotifyAppReady(activationId: fixture.trial?.activationId)
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds)
    XCTAssertEqual(fixture.store.getFallbackBundle().id, "R")
    XCTAssertFalse(fixture.indexExists("A"))
  }

  func testLeavingAPreviewFailsClosedWhenStateCannotBeWritten() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.installHealthy("P", channel: Self.previewChannel)

    try fixture.withReadOnlyState {
      XCTAssertThrowsError(try fixture.coordinator.prepareLeavePreview(isBundleUsable: fixture.isUsable))
    }
    XCTAssertEqual(fixture.reopenStore().getCurrentBundle().id, "P")
    XCTAssertTrue(fixture.indexExists("P"))
  }

  func testTrialIsOverOnceTheAppIsReady() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    XCTAssertFalse(fixture.coordinator.isCurrentInTrial())
    try fixture.installHealthy("A")
    XCTAssertFalse(fixture.coordinator.isCurrentInTrial())
  }
}
