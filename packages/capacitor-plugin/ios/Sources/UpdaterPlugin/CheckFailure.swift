import Foundation

/// Bounded diagnostics: never include manifest bodies, URLs, signatures, or key IDs.
struct CheckFailure {
  let phase: String
  let detail: String

  static func from(_ error: Error) -> CheckFailure? {
    if error is CancellationError { return nil }
    if let verifier = error as? ManifestVerifierError {
      let detail: String
      switch verifier {
      case .expired: detail = "signature_expired"
      case .unknownKid: detail = "signature_unknown_key"
      case .invalidSignature: detail = "signature_invalid"
      case .missingSignature: detail = "signature_missing"
      }
      return CheckFailure(phase: "signature", detail: detail)
    }
    if let manifest = error as? ManifestClientError {
      if case let .httpStatus(status) = manifest {
        return CheckFailure(phase: "check", detail: "manifest_http_\(status)")
      }
      return CheckFailure(phase: "check", detail: "manifest_invalid")
    }
    let failure = error as NSError
    if failure.domain == NSURLErrorDomain {
      if failure.code == NSURLErrorCancelled { return nil }
      return CheckFailure(phase: "check", detail: "manifest_network_\(failure.code)")
    }
    return CheckFailure(phase: "check", detail: "manifest_check_failed")
  }

  static func observe<T>(_ operation: () async throws -> T, report: (CheckFailure) throws -> Void) async throws -> T {
    do { return try await operation() }
    catch {
      if let failure = from(error) { try report(failure) }
      throw error
    }
  }
}
