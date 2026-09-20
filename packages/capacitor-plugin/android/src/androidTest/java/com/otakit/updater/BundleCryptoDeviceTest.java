package com.otakit.updater;

import static org.junit.Assert.*;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BundleCryptoDeviceTest {

  @Test
  public void platformProviderAuthenticatesBeforeWritingPlaintext() throws Exception {
    File directory = InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir();
    File input = new File(directory, UUID.randomUUID().toString());
    File output = new File(directory, UUID.randomUUID().toString());
    byte[] key = new byte[32];
    byte[] nonce = new byte[12];
    for (int i = 0; i < key.length; i++) key[i] = (byte) i;
    for (int i = 0; i < nonce.length; i++) nonce[i] = (byte) i;
    String hex =
      "7b6aa276a9dba36ef929f2e5c5801b0cf7b3e314bf2f1e5c5e0e9df1681b658e2e78da91c3ffffb9dfebd748620c76d3e455d9b60791";
    byte[] ciphertext = new byte[hex.length() / 2];
    for (int i = 0; i < ciphertext.length; i++) ciphertext[i] = (byte) Integer.parseInt(
      hex.substring(i * 2, i * 2 + 2),
      16
    );
    try {
      Files.write(input.toPath(), ciphertext);
      BundleCrypto.decryptFile(key, nonce, input, output);
      assertEquals(
        "<html>authenticated OTA fixture</html>",
        new String(Files.readAllBytes(output.toPath()), StandardCharsets.UTF_8)
      );
      ciphertext[ciphertext.length - 1] ^= 1;
      Files.write(input.toPath(), ciphertext);
      Files.write(output.toPath(), new byte[] { 42 });
      try {
        BundleCrypto.decryptFile(key, nonce, input, output);
        fail("Tampered GCM tag accepted");
      } catch (javax.crypto.AEADBadTagException expected) {}
      assertArrayEquals(new byte[] { 42 }, Files.readAllBytes(output.toPath()));
    } finally {
      input.delete();
      output.delete();
    }
  }
}
