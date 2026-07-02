package com.otakit.updater;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
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
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
      Cipher.DECRYPT_MODE,
      new SecretKeySpec(dek, "AES"),
      new GCMParameterSpec(GCM_TAG_BITS, nonce)
    );

    // Explicit doFinal (not CipherOutputStream) so a GCM tag failure always
    // throws instead of depending on close() behavior. GCM decryption
    // buffers the full input internally anyway before releasing plaintext.
    byte[] ciphertext = readAllBytes(input);
    if (ciphertext.length <= TAG_LENGTH) {
      throw new IllegalStateException("invalid bundle encryption parameter: ciphertext too short");
    }
    byte[] plaintext = cipher.doFinal(ciphertext);
    try (FileOutputStream out = new FileOutputStream(output)) {
      out.write(plaintext);
    }
  }

  private static byte[] readAllBytes(File file) throws Exception {
    try (
      InputStream in = new FileInputStream(file);
      ByteArrayOutputStream out = new ByteArrayOutputStream()
    ) {
      byte[] buffer = new byte[8192];
      int read;
      while ((read = in.read(buffer)) > 0) {
        out.write(buffer, 0, read);
      }
      return out.toByteArray();
    }
  }
}
