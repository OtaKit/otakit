package com.otakit.updater;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;

final class HashUtils {

  private HashUtils() {}

  static String sha256(InputStream input) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] buffer = new byte[1024 * 1024];
    int read;
    while ((read = input.read(buffer)) > 0) {
      digest.update(buffer, 0, read);
    }
    byte[] hash = digest.digest();
    StringBuilder builder = new StringBuilder();
    for (byte b : hash) {
      builder.append(String.format("%02x", b));
    }
    return builder.toString();
  }

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

  static void verifyDownload(File file, String expectedSha256, long expectedBytes, String kind)
    throws Exception {
    String actual = sha256(file);
    boolean hashMatches = actual.equalsIgnoreCase(expectedSha256);
    boolean sizeMatches = expectedBytes < 0 || expectedBytes == file.length();
    if (!hashMatches || !sizeMatches) {
      String safeExpected =
        expectedSha256 != null && expectedSha256.matches("[a-fA-F0-9]{64}")
          ? expectedSha256.toLowerCase(java.util.Locale.ROOT)
          : "invalid";
      throw new IllegalStateException(
        "Downloaded " +
          kind +
          (hashMatches ? " size mismatch" : " hash mismatch") +
          "; expectedSha256=" +
          safeExpected +
          "; actualSha256=" +
          actual +
          "; expectedBytes=" +
          expectedBytes +
          "; receivedBytes=" +
          file.length()
      );
    }
  }
}
