import CryptoKit
import Foundation
import os

enum BundleCryptoError: Error, LocalizedError {
  case noMatchingKey(String)
  case invalidParameter(String)
  case decryptionFailed(String)
  case insufficientMemory(encryptedBytes: Int64, budgetBytes: Int64)

  var errorDescription: String? {
    switch self {
    case let .noMatchingKey(kid):
      return "no matching bundle key (kid \(kid))"
    case let .invalidParameter(name):
      return "invalid bundle encryption parameter: \(name)"
    case let .decryptionFailed(detail):
      return "bundle decryption failed: \(detail)"
    case let .insufficientMemory(encryptedBytes, budgetBytes):
      return "insufficient_memory_for_encrypted_bundle; encryptedBytes=\(encryptedBytes); budgetBytes=\(budgetBytes)"
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
  private static let reserveBytes: Int64 = 32 * 1024 * 1024
  private static let maximumEncryptedBytes: Int64 = 128 * 1024 * 1024

  static func requireMemoryBudget(encryptedBytes: Int64, availableBytes: Int64) throws {
    let budget = availableBytes <= reserveBytes ? 0 : min(maximumEncryptedBytes, (availableBytes - reserveBytes) / 4)
    guard encryptedBytes <= budget else {
      throw BundleCryptoError.insufficientMemory(encryptedBytes: encryptedBytes, budgetBytes: budget)
    }
  }

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
    output: URL,
    availableBytes: Int64 = Int64(os_proc_available_memory())
  ) throws {
    guard let nonce = Data(base64Encoded: nonceB64) else {
      throw BundleCryptoError.invalidParameter("nonce")
    }

    guard dek.count == keyLength, nonce.count == 12 else {
      throw BundleCryptoError.invalidParameter("key or nonce length")
    }
    let attributes = try FileManager.default.attributesOfItem(atPath: input.path)
    guard let size = attributes[.size] as? NSNumber, size.int64Value > tagLength else {
      throw BundleCryptoError.invalidParameter("ciphertext too short")
    }
    try requireMemoryBudget(encryptedBytes: size.int64Value, availableBytes: availableBytes)
    let ciphertextWithTag = try Data(contentsOf: input, options: .mappedIfSafe)
    guard ciphertextWithTag.count == size.intValue else {
      throw BundleCryptoError.invalidParameter("ciphertext changed during read")
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
