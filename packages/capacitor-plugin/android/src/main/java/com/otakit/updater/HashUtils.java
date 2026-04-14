package com.otakit.updater;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

final class HashUtils {

  private HashUtils() {}

  static String sha256(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (FileInputStream input = new FileInputStream(file)) {
      byte[] buffer = new byte[1024 * 1024];
      int read;
      while ((read = input.read(buffer)) > 0) {
        digest.update(buffer, 0, read);
      }
    }

    byte[] hash = digest.digest();
    StringBuilder builder = new StringBuilder();
    for (byte b : hash) {
      builder.append(String.format("%02x", b));
    }
    return builder.toString();
  }

  static boolean verify(File file, String expectedSha256) throws Exception {
    return sha256(file).equalsIgnoreCase(expectedSha256);
  }
}
