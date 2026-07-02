import CryptoKit
import Foundation

enum BundleCryptoError: Error, LocalizedError {
  case noMatchingKey(String)
  case invalidParameter(String)
  case decryptionFailed(String)

  var errorDescription: String? {
    switch self {
    case let .noMatchingKey(kid):
      return "no matching bundle key (kid \(kid))"
    case let .invalidParameter(name):
      return "invalid bundle encryption parameter: \(name)"
    case let .decryptionFailed(detail):
      return "bundle decryption failed: \(detail)"
    }
  }
}

/// AES-256-GCM bundle decryption.
///
/// The CLI encrypts the zip with a random per-bundle DEK and wraps the DEK
/// under the app KEK; both ciphertexts carry the 16-byte GCM tag appended.
enum BundleCrypto {
  private static let tagLength = 16
  private static let keyLength = 32

  static func unwrapDek(
    kek: Data,
    wrapNonceB64: String,
    wrappedDekB64: String
  ) throws -> Data {
    guard kek.count == keyLength else {
      throw BundleCryptoError.invalidParameter("bundle key length")
    }
    guard let wrapNonce = Data(base64Encoded: wrapNonceB64) else {
      throw BundleCryptoError.invalidParameter("wrapNonce")
    }
    guard let wrappedDek = Data(base64Encoded: wrappedDekB64),
          wrappedDek.count == keyLength + tagLength else {
      throw BundleCryptoError.invalidParameter("wrappedDek")
    }

    let dek: Data
    do {
      let sealedBox = try AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: wrapNonce),
        ciphertext: wrappedDek.prefix(keyLength),
        tag: wrappedDek.suffix(tagLength)
      )
      dek = try AES.GCM.open(sealedBox, using: SymmetricKey(data: kek))
    } catch {
      throw BundleCryptoError.decryptionFailed("DEK unwrap: \(error.localizedDescription)")
    }
    guard dek.count == keyLength else {
      throw BundleCryptoError.decryptionFailed("unwrapped DEK has unexpected length")
    }
    return dek
  }

  static func decryptFile(
    dek: Data,
    nonceB64: String,
    input: URL,
    output: URL
  ) throws {
    guard let nonce = Data(base64Encoded: nonceB64) else {
      throw BundleCryptoError.invalidParameter("nonce")
    }

    let ciphertextWithTag = try Data(contentsOf: input)
    guard ciphertextWithTag.count > tagLength else {
      throw BundleCryptoError.invalidParameter("ciphertext too short")
    }

    do {
      let sealedBox = try AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: nonce),
        ciphertext: ciphertextWithTag.prefix(ciphertextWithTag.count - tagLength),
        tag: ciphertextWithTag.suffix(tagLength)
      )
      let plaintext = try AES.GCM.open(sealedBox, using: SymmetricKey(data: dek))
      try plaintext.write(to: output, options: .atomic)
    } catch let error as BundleCryptoError {
      throw error
    } catch {
      throw BundleCryptoError.decryptionFailed(error.localizedDescription)
    }
  }
}
