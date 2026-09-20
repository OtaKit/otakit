package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BundleCryptoTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  // AES-256-GCM fixture generated with node:crypto; shared with the CryptoKit tests.
  private static final String CIPHERTEXT =
    "7b6aa276a9dba36ef929f2e5c5801b0cf7b3e314bf2f1e5c5e0e9df1681b658e2e78da91c3ffffb9dfebd748620c76d3e455d9b60791";

  private static byte[] hex(String value) {
    byte[] bytes = new byte[value.length() / 2];
    for (int i = 0; i < bytes.length; i++) bytes[i] = (byte) Integer.parseInt(
      value.substring(i * 2, i * 2 + 2),
      16
    );
    return bytes;
  }

  private byte[] key() {
    return hex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  }

  private byte[] nonce() {
    return hex("000102030405060708090a0b");
  }

  @Test
  public void decryptsCliCompatibleCiphertextAfterAuthentication() throws Exception {
    File input = temporaryFolder.newFile();
    File output = temporaryFolder.newFile();
    Files.write(input.toPath(), hex(CIPHERTEXT));
    BundleCrypto.decryptFile(key(), nonce(), input, output, 1024L * 1024 * 1024);
    assertEquals(
      "<html>authenticated OTA fixture</html>",
      new String(Files.readAllBytes(output.toPath()), StandardCharsets.UTF_8)
    );
  }

  @Test
  public void tamperedBodyTagAndWrongKeyCannotPublishPlaintext() throws Exception {
    for (int index : new int[] { 0, hex(CIPHERTEXT).length - 1, -1 }) {
      File input = temporaryFolder.newFile();
      File output = temporaryFolder.newFile();
      byte[] bytes = hex(CIPHERTEXT);
      byte[] key = key();
      if (index >= 0) bytes[index] ^= 1;
      else key[0] ^= 1;
      Files.write(input.toPath(), bytes);
      Files.write(output.toPath(), new byte[] { 42 });
      assertThrows(Exception.class, () ->
        BundleCrypto.decryptFile(key, nonce(), input, output, 1024L * 1024 * 1024)
      );
      assertArrayEquals(new byte[] { 42 }, Files.readAllBytes(output.toPath()));
    }
  }

  @Test
  public void largeSparseFileIsRejectedBeforeAllocatingOrWriting() throws Exception {
    File input = temporaryFolder.newFile();
    File output = new File(temporaryFolder.getRoot(), "absent.zip");
    try (RandomAccessFile file = new RandomAccessFile(input, "rw")) {
      file.setLength(200L * 1024 * 1024);
    }
    Exception error = assertThrows(IllegalStateException.class, () ->
      BundleCrypto.decryptFile(key(), nonce(), input, output, 80L * 1024 * 1024)
    );
    assertTrue(error.getMessage().startsWith("insufficient_memory_for_encrypted_bundle"));
    assertFalse(output.exists());
  }

  @Test
  public void budgetIncludesReserveAndAvoidsOverflow() {
    long reserve = 32L * 1024 * 1024;
    BundleCrypto.requireMemoryBudget(100, reserve + 400);
    assertThrows(IllegalStateException.class, () ->
      BundleCrypto.requireMemoryBudget(101, reserve + 400)
    );
    assertThrows(IllegalStateException.class, () ->
      BundleCrypto.requireMemoryBudget(100, Long.MIN_VALUE)
    );
    assertThrows(IllegalStateException.class, () ->
      BundleCrypto.requireMemoryBudget(129L * 1024 * 1024, Long.MAX_VALUE)
    );
  }

  @Test
  public void truncatedInputCannotCreateOutput() throws Exception {
    File input = temporaryFolder.newFile();
    File output = new File(temporaryFolder.getRoot(), "absent.zip");
    Files.write(input.toPath(), new byte[16]);
    assertThrows(IllegalStateException.class, () ->
      BundleCrypto.decryptFile(key(), nonce(), input, output, Long.MAX_VALUE)
    );
    assertFalse(output.exists());
  }
}
