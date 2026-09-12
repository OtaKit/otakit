import XCTest

final class NativeLinkTests: XCTestCase {
  func testOpenFixtureLink() {
    continueAfterFailure = false
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let alert = springboard.alerts.firstMatch
    // iOS can remember a prior confirmation. The device runner separately requires
    // a DOM report from the linked screen, whether a prompt was shown or not.
    guard alert.waitForExistence(timeout: 5) else { return }
    XCTAssertTrue(
      alert.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "OtaKit Expo Fixture"))
        .firstMatch.exists,
      "Only accept the private fixture's URL prompt")
    alert.buttons["Open"].tap()
    XCTAssertTrue(alert.waitForNonExistence(timeout: 10), "The fixture URL prompt must close")
  }
}
