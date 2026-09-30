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

  func testActivatingTheBuiltinBundleDropsEveryInstalledBundle() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.apply("B")
    XCTAssertTrue(fixture.coordinator.isCurrentInTrial())
    try fixture.stage("C")

    let cleanup = try fixture.coordinator.prepareActivateBuiltin()

    XCTAssertEqual(Set(cleanup), ["A", "B", "C"])
    XCTAssertTrue(fixture.store.getCurrentBundle().isBuiltin)
    XCTAssertTrue(fixture.store.getFallbackBundle().isBuiltin)
    XCTAssertNil(fixture.store.getStagedBundleId())
    XCTAssertFalse(fixture.coordinator.isCurrentInTrial())
    fixture.coordinator.cleanupBundles(cleanup)
    XCTAssertFalse(fixture.indexExists("A"))
    XCTAssertFalse(fixture.indexExists("B"))
    XCTAssertFalse(fixture.indexExists("C"))
  }

  func testActivatingTheBuiltinBundleFailsClosedWhenStateCannotBeWritten() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")

    try fixture.withReadOnlyState {
      XCTAssertThrowsError(try fixture.coordinator.prepareActivateBuiltin())
    }
    XCTAssertEqual(fixture.reopenStore().getCurrentBundle().id, "A")
    XCTAssertTrue(fixture.indexExists("A"))
  }

  func testTrialIsOverOnceTheAppIsReady() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    XCTAssertFalse(fixture.coordinator.isCurrentInTrial())
    try fixture.installHealthy("A")
    XCTAssertFalse(fixture.coordinator.isCurrentInTrial())
  }
}
