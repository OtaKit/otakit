import Foundation
import UIKit
import XCTest
@testable import UpdaterPlugin

final class ForegroundDeadlineTests: XCTestCase {
  func testBackgroundTimeDoesNotConsumeRemainingBudget() {
    let clock = DeadlineClock()
    let deadline = clock.makeDeadline()
    var expirations = 0
    deadline.setForeground(true)
    deadline.start(timeout: 10) { expirations += 1 }
    let originalCallback = clock.jobs.last!.callback
    clock.now = 3
    deadline.setForeground(false)
    clock.now = 3603
    originalCallback() // Simulate an already queued callback despite cancellation.
    XCTAssertEqual(expirations, 0)
    deadline.setForeground(true)
    XCTAssertEqual(clock.jobs.last!.delay, 7)
    clock.now += 7
    clock.jobs.last!.callback()
    XCTAssertEqual(expirations, 1)
    originalCallback()
    XCTAssertEqual(expirations, 1)
  }

  func testTrialStartedInBackgroundWaitsForForeground() {
    let clock = DeadlineClock()
    let deadline = clock.makeDeadline()
    var expired = false
    deadline.start(timeout: 10) { expired = true }
    clock.now = 1000
    XCTAssertTrue(clock.jobs.isEmpty)
    deadline.setForeground(true)
    XCTAssertEqual(clock.jobs.last!.delay, 10)
    XCTAssertFalse(expired)
    clock.now += 10
    clock.jobs.last!.callback()
    XCTAssertTrue(expired)
  }

  func testRepeatedLifecycleEventsDoNotResetBudget() {
    let clock = DeadlineClock()
    let deadline = clock.makeDeadline()
    deadline.setForeground(true)
    deadline.start(timeout: 10) {}
    clock.now = 2
    deadline.setForeground(true)
    deadline.setForeground(false)
    clock.now = 50
    deadline.setForeground(false)
    deadline.setForeground(true)
    XCTAssertEqual(clock.jobs.last!.delay, 8)
    clock.now = 54
    deadline.setForeground(false)
    clock.now = 90
    deadline.setForeground(true)
    XCTAssertEqual(clock.jobs.last!.delay, 4)
  }

  func testCancelledAndReplacedCallbacksCannotExpireNewTrial() {
    let clock = DeadlineClock()
    let deadline = clock.makeDeadline()
    var expired = "none"
    deadline.setForeground(true)
    deadline.start(timeout: 10) { expired = "A" }
    let old = clock.jobs.last!.callback
    deadline.cancel()
    deadline.start(timeout: 10) { expired = "B" }
    clock.now = 10
    old()
    XCTAssertEqual(expired, "none")
    let current = clock.jobs.last!.callback
    current()
    current()
    XCTAssertEqual(expired, "B")
    deadline.start(timeout: 10) { expired = "C" }
    let cancelled = clock.jobs.last!.callback
    deadline.cancel()
    clock.now = 20
    cancelled()
    XCTAssertEqual(expired, "B")
  }

  func testEarlySchedulerCallbackWaitsForRemainder() {
    let clock = DeadlineClock()
    let deadline = clock.makeDeadline()
    var expired = false
    deadline.setForeground(true)
    deadline.start(timeout: 10) { expired = true }
    clock.now = 3
    clock.jobs.last!.callback()
    XCTAssertFalse(expired)
    XCTAssertEqual(clock.jobs.last!.delay, 7)
    clock.now = 10
    clock.jobs.last!.callback()
    XCTAssertTrue(expired)
  }

  @MainActor
  func testApplicationNotificationsPauseRealTrialBeforeRollback() throws {
    let fixture = try CoordinatorFixture()
    defer { try? fixture.cleanup() }
    try fixture.installHealthy("A")
    try fixture.apply("B")
    let trial = try XCTUnwrap(fixture.trial)
    let clock = DeadlineClock()
    let deadline = clock.makeDeadline()
    let center = NotificationCenter()
    deadline.observe(center: center, active: UIApplication.didBecomeActiveNotification,
      inactive: UIApplication.willResignActiveNotification, initiallyActive: true)
    deadline.start(timeout: 10) {
      do {
        let rollback = try fixture.coordinator.prepareRollback(expectedTrial: trial,
          reason: "notify_timeout", isBundleUsable: fixture.isUsable)
        fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds)
      } catch { XCTFail("Rollback failed: \(error)") }
    }
    clock.now = 4
    center.post(name: UIApplication.willResignActiveNotification, object: nil)
    clock.now = 600
    clock.jobs.last!.callback()
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "B")
    XCTAssertTrue(fixture.indexExists("A"))
    center.post(name: UIApplication.didBecomeActiveNotification, object: nil)
    XCTAssertEqual(clock.jobs.last!.delay, 6)
    clock.now = 606
    clock.jobs.last!.callback()
    XCTAssertEqual(fixture.store.getCurrentBundle().id, "A")
    XCTAssertFalse(fixture.indexExists("B"))
  }
}

private final class DeadlineClock {
  var now: TimeInterval = 0
  var jobs: [(delay: TimeInterval, callback: () -> Void)] = []
  func makeDeadline() -> ForegroundDeadline {
    ForegroundDeadline(now: { [unowned self] in self.now }, schedule: { [unowned self] delay, callback in
      self.jobs.append((delay, callback))
      return {} // Deliberately allow tests to deliver stale callbacks.
    })
  }
}
