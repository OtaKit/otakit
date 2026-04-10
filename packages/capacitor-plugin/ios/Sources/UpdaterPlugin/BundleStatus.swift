import Foundation

enum BundleStatus: String, Codable {
  case builtin
  case pending
  case trial
  case success
  case error
}
