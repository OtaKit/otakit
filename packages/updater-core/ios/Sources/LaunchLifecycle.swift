import Foundation

/// Retains lifecycle observations while the host prepares storage off the main thread.
public final class LaunchLifecycle {
  public enum State { case active, inactive, background }

  private let lock = NSLock()
  private let clock: () -> TimeInterval
  private var state: State
  private var store: LaunchStore?

  public init(
    state: State, clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }
  ) {
    self.state = state
    self.clock = clock
  }

  public func update(_ state: State) {
    lock.lock()
    defer { lock.unlock() }
    self.state = state
    store?.setForeground(state == .active, now: clock())
  }

  /// Call once after storage preparation, on the preparation worker.
  public func start(_ store: LaunchStore, foregroundUIIntent: Bool) throws {
    lock.lock()
    defer { lock.unlock() }
    precondition(self.store == nil, "Launch lifecycle already started")
    let now = clock()
    // UI intent governs headless deferral; temporary inactivity must not latch that guard.
    _ = try store.beginLaunch(
      foreground: foregroundUIIntent, activateStaged: state != .background, now: now)
    store.setForeground(state == .active, now: now)
    self.store = store
  }
}
