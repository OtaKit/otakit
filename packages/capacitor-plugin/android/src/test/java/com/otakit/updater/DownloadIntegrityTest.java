package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class DownloadIntegrityTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private File fixture() throws Exception {
    File file = temporaryFolder.newFile();
    Files.write(file.toPath(), new byte[] { 1, 2, 3 });
    return file;
  }

  @Test
  public void mismatchIncludesHashesAndByteCountsWithoutPaths() throws Exception {
    File file = fixture();
    String expected = "0".repeat(64);
    Exception error = assertThrows(IllegalStateException.class, () ->
      HashUtils.verifyDownload(file, expected, 10, "bundle")
    );
    assertTrue(error.getMessage().contains("hash mismatch"));
    assertTrue(error.getMessage().contains("expectedSha256=" + expected));
    assertTrue(error.getMessage().contains("actualSha256=" + HashUtils.sha256(file)));
    assertTrue(error.getMessage().contains("expectedBytes=10; receivedBytes=3"));
    assertFalse(error.getMessage().contains(file.getAbsolutePath()));
    assertTrue(error.getMessage().length() < 500);
  }

  @Test
  public void sizeMismatchFailsEvenWithMatchingHash() throws Exception {
    File file = fixture();
    String hash = HashUtils.sha256(file);
    assertThrows(IllegalStateException.class, () ->
      HashUtils.verifyDownload(file, hash, 4, "bundle")
    );
    HashUtils.verifyDownload(file, hash.toUpperCase(java.util.Locale.ROOT), 3, "bundle");
    HashUtils.verifyDownload(file, hash, -1, "bundle");
  }

  @Test
  public void invalidExpectedHashIsRedacted() throws Exception {
    File file = fixture();
    Exception error = assertThrows(IllegalStateException.class, () ->
      HashUtils.verifyDownload(file, "https://secret.test?token=secret", -1, "bundle")
    );
    assertTrue(error.getMessage().contains("expectedSha256=invalid"));
    assertFalse(error.getMessage().contains("secret"));
  }
}
