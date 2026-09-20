import Foundation

/// Checked on the main thread together with state publication and activation.
final class UpdateOwner {
  private let isAvailable: () -> Bool
  init(isAvailable: @escaping () -> Bool) { self.isAvailable = isAvailable }

  func run<T>(_ action: () throws -> T) throws -> T {
    guard isAvailable() else { throw CancellationError() }
    return try action()
  }
}
