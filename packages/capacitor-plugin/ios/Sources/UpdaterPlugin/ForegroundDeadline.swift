import Foundation

/// Owned by the main thread. Only foreground time consumes the readiness budget.
final class ForegroundDeadline {
  typealias Scheduler = (TimeInterval, @escaping () -> Void) -> () -> Void
  private let now: () -> TimeInterval
  private let schedule: Scheduler
  private var foreground = false
  private var remaining: TimeInterval = 0
  private var startedAt: TimeInterval = 0
  private var generation = 0
  private var action: (() -> Void)?
  private var cancelScheduled: (() -> Void)?
  private var observations: [(NotificationCenter, NSObjectProtocol)] = []

  init(
    now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    schedule: @escaping Scheduler = { delay, callback in
      let item = DispatchWorkItem(block: callback)
      DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
      return { item.cancel() }
    }
  ) {
    self.now = now
    self.schedule = schedule
  }

  func observe(
    center: NotificationCenter, active: Notification.Name, inactive: Notification.Name,
    initiallyActive: Bool
  ) {
    setForeground(initiallyActive)
    observations.append((center, center.addObserver(forName: active, object: nil, queue: .main) { [weak self] _ in
      self?.setForeground(true)
    }))
    observations.append((center, center.addObserver(forName: inactive, object: nil, queue: .main) { [weak self] _ in
      self?.setForeground(false)
    }))
  }

  func start(timeout: TimeInterval, action: @escaping () -> Void) {
    cancel()
    remaining = max(0, timeout)
    self.action = action
    arm()
  }

  func setForeground(_ value: Bool) {
    guard value != foreground else { return }
    if foreground, action != nil {
      remaining = max(0, remaining - max(0, now() - startedAt))
    }
    disarm()
    foreground = value
    arm()
  }

  func cancel() {
    disarm()
    action = nil
    remaining = 0
  }

  private func disarm() {
    generation += 1
    cancelScheduled?()
    cancelScheduled = nil
  }

  private func arm() {
    guard foreground, action != nil else { return }
    startedAt = now()
    generation += 1
    let expectedGeneration = generation
    cancelScheduled = schedule(remaining) { [weak self] in
      self?.fire(expectedGeneration: expectedGeneration)
    }
  }

  private func fire(expectedGeneration: Int) {
    guard generation == expectedGeneration, foreground, let action else { return }
    remaining = max(0, remaining - max(0, now() - startedAt))
    cancelScheduled = nil
    if remaining > 0 { arm(); return }
    self.action = nil
    generation += 1
    action()
  }

  deinit {
    cancelScheduled?()
    for (center, observation) in observations { center.removeObserver(observation) }
  }
}
