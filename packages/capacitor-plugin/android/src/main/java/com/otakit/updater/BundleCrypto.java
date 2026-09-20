package com.otakit.updater;

import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * AES-256-GCM bundle decryption.
 *
 * The CLI encrypts the zip with a random per-bundle DEK and wraps the DEK
 * under the app KEK; both ciphertexts carry the 16-byte GCM tag appended
 * (Java's AES/GCM/NoPadding expects exactly that layout).
 */
final class BundleCrypto {

  private static final int GCM_TAG_BITS = 128;
  private static final int KEY_LENGTH = 32;
  private static final int TAG_LENGTH = 16;
  private static final long RESERVE_BYTES = 32L * 1024 * 1024;
  private static final long MAX_ENCRYPTED_BYTES = 128L * 1024 * 1024;

  private BundleCrypto() {}

  static byte[] unwrapDek(byte[] kek, byte[] wrapNonce, byte[] wrappedDek) throws Exception {
    if (kek == null || kek.length != KEY_LENGTH) {
      throw new IllegalStateException("invalid bundle encryption parameter: bundle key length");
    }
    if (wrappedDek == null || wrappedDek.length != KEY_LENGTH + TAG_LENGTH) {
      throw new IllegalStateException("invalid bundle encryption parameter: wrappedDek");
    }
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
      Cipher.DECRYPT_MODE,
      new SecretKeySpec(kek, "AES"),
      new GCMParameterSpec(GCM_TAG_BITS, wrapNonce)
    );
    byte[] dek = cipher.doFinal(wrappedDek);
    if (dek.length != KEY_LENGTH) {
      throw new IllegalStateException("bundle decryption failed: unexpected DEK length");
    }
    return dek;
  }

  static void decryptFile(byte[] dek, byte[] nonce, File input, File output) throws Exception {
    Runtime runtime = Runtime.getRuntime();
    long available = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory());
    decryptFile(dek, nonce, input, output, available);
  }

  static void requireMemoryBudget(long encryptedBytes, long availableBytes) {
    long budget =
      availableBytes <= RESERVE_BYTES
        ? 0
        : Math.min(MAX_ENCRYPTED_BYTES, (availableBytes - RESERVE_BYTES) / 4);
    if (encryptedBytes > budget) throw new IllegalStateException(
      "insufficient_memory_for_encrypted_bundle; encryptedBytes=" +
        encryptedBytes +
        "; budgetBytes=" +
        budget
    );
  }

  static void decryptFile(byte[] dek, byte[] nonce, File input, File output, long availableBytes)
    throws Exception {
    long size = input.length();
    if (size <= TAG_LENGTH) throw new IllegalStateException(
      "invalid bundle encryption parameter: ciphertext too short"
    );
    requireMemoryBudget(size, availableBytes);
    if (dek == null || dek.length != KEY_LENGTH || nonce == null || nonce.length != 12) {
      throw new IllegalStateException("invalid bundle encryption parameter: key or nonce length");
    }
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
      Cipher.DECRYPT_MODE,
      new SecretKeySpec(dek, "AES"),
      new GCMParameterSpec(GCM_TAG_BITS, nonce)
    );

    // Explicit doFinal (not CipherOutputStream) so a GCM tag failure always
    // throws instead of depending on close() behavior. GCM decryption
    // buffers the full input internally anyway before releasing plaintext.
    byte[] ciphertext = readExactBytes(input, (int) size);
    byte[] plaintext = cipher.doFinal(ciphertext);
    try (FileOutputStream out = new FileOutputStream(output)) {
      out.write(plaintext);
    }
  }

  private static byte[] readExactBytes(File file, int size) throws Exception {
    byte[] bytes = new byte[size];
    try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
      input.readFully(bytes);
      if (input.read() != -1) throw new java.io.IOException("Encrypted bundle changed during read");
    }
    return bytes;
  }
}
