import Foundation
import XCTest
@testable import UpdaterPlugin

final class ExperimentsTests: XCTestCase {
  private let secret = "0123456789abcdef0123456789abcdef"
  private let first = "0b1d2c3e-0000-4000-8000-00000000000a"
  private let second = "0b1d2c3e-0000-4000-8000-00000000000b"

  func testBucketsMatchTheSharedVectors() {
    // Same vectors as the TypeScript and Java tests: SHA-256("secret:exp:<id>:<use>").
    XCTAssertEqual(
      ExperimentAssignment.buckets(secret: secret, experimentId: first), ["traffic": 14, "variant": 34])
    XCTAssertEqual(
      ExperimentAssignment.buckets(secret: secret, experimentId: second), ["traffic": 84, "variant": 13])
  }

  func testValidatesIdsAndReports() {
    XCTAssertTrue(ExperimentAssignment.isExperimentId(first))
    XCTAssertFalse(ExperimentAssignment.isExperimentId(first.uppercased()))
    XCTAssertFalse(ExperimentAssignment.isExperimentId("rollout:abc"))
    for report in ["exposure", "error", "conversion:purchase_completed", "conversion:a.b:c-d"] {
      XCTAssertTrue(ExperimentAssignment.isReport(report), report)
    }
    for report in ["", "exposed", "conversion:", "conversion:..", "conversion:has space",
                   "conversion:" + String(repeating: "x", count: 65)] {
      XCTAssertFalse(ExperimentAssignment.isReport(report), report)
    }
  }

  private func reports() -> ExperimentReports {
    let suite = "otakit-experiments-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
    return ExperimentReports(defaults: defaults)
  }

  func testRecordsEachReportOnceAndOnlyAfterItWasStored() {
    let reports = reports()
    var stored = 0
    let store = { () -> Bool in stored += 1; return true }
    // A conversion before the exposure is not made.
    XCTAssertFalse(reports.record(
      experimentId: first, report: "conversion:buy", requires: "exposure", now: 1, store: store))
    XCTAssertEqual(stored, 0)
    // A failed store records nothing.
    XCTAssertFalse(reports.record(
      experimentId: first, report: "exposure", requires: nil, now: 1, store: { false }))
    XCTAssertTrue(reports.record(experimentId: first, report: "exposure", requires: nil, now: 1, store: store))
    XCTAssertFalse(reports.record(experimentId: first, report: "exposure", requires: nil, now: 2, store: store))
    XCTAssertTrue(reports.record(
      experimentId: first, report: "conversion:buy", requires: "exposure", now: 3, store: store))
    XCTAssertTrue(reports.record(experimentId: first, report: "error", requires: "exposure", now: 4, store: store))
    XCTAssertEqual(stored, 3)
    XCTAssertEqual(
      reports.reported(experimentIds: [first, second]),
      [first: ["exposure", "conversion:buy", "error"]])
  }

  func testKeepsTheNewest50Experiments() {
    let reports = reports()
    for index in 0..<55 {
      let id = String(format: "0b1d2c3e-0000-4000-8000-%012d", index)
      XCTAssertTrue(reports.record(
        experimentId: id, report: "exposure", requires: nil, now: Double(index), store: { true }))
    }
    let ids = (0..<55).map { String(format: "0b1d2c3e-0000-4000-8000-%012d", $0) }
    let kept = reports.reported(experimentIds: ids)
    XCTAssertEqual(kept.count, ExperimentReports.limit)
    XCTAssertNil(kept[ids[4]])
    XCTAssertNotNil(kept[ids[5]])
  }

  func testReportsGoToTheirOwnLaneKeptOverEvents() {
    XCTAssertGreaterThan(AppTelemetryClient.Lane.report.priority, AppTelemetryClient.Lane.error.priority)
    XCTAssertGreaterThan(AppTelemetryClient.Lane.error.priority, AppTelemetryClient.Lane.event.priority)
    let context: [String: Any] = ["platform": "ios", "sessionId": "s"]
    XCTAssertNotEqual(
      AppTelemetryClient.mergeKey(lane: .report, context: context),
      AppTelemetryClient.mergeKey(lane: .event, context: context))
  }
}
