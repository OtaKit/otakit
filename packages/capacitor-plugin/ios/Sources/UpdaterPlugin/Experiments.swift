import Foundation

/// A/B tests (plugin 3.4+). The JavaScript side reads the experiments from the
/// signed config and picks variants; native supplies what must stay on the
/// device: buckets from the assignment secret (never sent or exposed), and a
/// record of the reports the device made, so each is made at most once.
enum ExperimentAssignment {
  static let maxExperiments = 20

  /// Buckets 1-100 for an experiment's traffic and variant, independent of
  /// each other and of rollouts (same function, other keys).
  static func buckets(secret: String, experimentId: String) -> [String: Int] {
    [
      "traffic": Rollout.bucket(secret: secret, key: "exp:\(experimentId):traffic"),
      "variant": Rollout.bucket(secret: secret, key: "exp:\(experimentId):variant")
    ]
  }

  static func isExperimentId(_ value: String) -> Bool {
    value.range(
      of: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      options: .regularExpression) != nil
  }

  /// `exposure`, `error`, or `conversion:<goal event name>`.
  static func isReport(_ value: String) -> Bool {
    if value == "exposure" || value == "error" { return true }
    guard value.hasPrefix("conversion:") else { return false }
    let goal = String(value.dropFirst("conversion:".count))
    return goal.range(of: "^[A-Za-z0-9_.:-]{1,64}$", options: .regularExpression) != nil
      && goal.range(of: "[A-Za-z0-9]", options: .regularExpression) != nil
  }
}

/// The reports this device made per experiment, kept for the newest 50
/// experiments. A report is recorded only after it was stored for delivery.
final class ExperimentReports {
  static let limit = 50
  private static let key = "otakit_experiment_reports"

  struct Record: Codable, Equatable {
    var reports: [String]
    /// When the first report of the experiment was made (ms since 1970).
    var firstAt: Double
  }

  private let defaults: UserDefaults
  /// Shared by every plugin instance in the process (more than one bridge),
  /// so a report is never made twice.
  private static let lock = NSLock()

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  func reported(experimentIds: [String]) -> [String: [String]] {
    ExperimentReports.lock.lock(); defer { ExperimentReports.lock.unlock() }
    let records = load()
    var result: [String: [String]] = [:]
    for id in experimentIds {
      if let record = records[id] { result[id] = record.reports }
    }
    return result
  }

  /// Runs `store` and records the report, unless the device already made it
  /// or has not made `requires`. True when the report was stored now.
  func record(
    experimentId: String, report: String, requires: String?, now: Double, store: () -> Bool
  ) -> Bool {
    ExperimentReports.lock.lock(); defer { ExperimentReports.lock.unlock() }
    var records = load()
    let existing = records[experimentId]
    if existing?.reports.contains(report) == true { return false }
    if let requires, existing?.reports.contains(requires) != true { return false }
    guard store() else { return false }
    var record = existing ?? Record(reports: [], firstAt: now)
    record.reports.append(report)
    records[experimentId] = record
    if records.count > ExperimentReports.limit {
      let oldest = records.sorted { $0.value.firstAt < $1.value.firstAt }
        .prefix(records.count - ExperimentReports.limit)
      for (id, _) in oldest { records.removeValue(forKey: id) }
    }
    if let data = try? JSONEncoder().encode(records) {
      defaults.set(data, forKey: ExperimentReports.key)
    }
    return true
  }

  private func load() -> [String: Record] {
    guard let data = defaults.data(forKey: ExperimentReports.key) else { return [:] }
    return (try? JSONDecoder().decode([String: Record].self, from: data)) ?? [:]
  }
}
