package com.otakit.updater;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 34)
public class ManifestKeyConfigTest {

  @Test
  public void malformedExplicitConfigRejectsUnsignedHTTPManifest() throws Exception {
    byte[] body = (
      "{\"version\":\"1.0\",\"sha256\":\"hash\",\"size\":1," +
      "\"releaseId\":\"release-a\",\"url\":\"https://example.test/bundle.zip\"}"
    ).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    java.net.ServerSocket server = new java.net.ServerSocket(
      0,
      2,
      java.net.InetAddress.getByName("127.0.0.1")
    );
    java.util.concurrent.atomic.AtomicReference<Throwable> serverFailure =
      new java.util.concurrent.atomic.AtomicReference<>();
    Thread serving = new Thread(() -> {
      try {
        for (int request = 0; request < 2; request++) {
          try (java.net.Socket socket = server.accept()) {
            socket.setSoTimeout(10_000);
            java.io.InputStream input = socket.getInputStream();
            StringBuilder header = new StringBuilder();
            while (!header.toString().endsWith("\r\n\r\n")) {
              int value = input.read();
              if (value < 0 || header.length() > 16384) throw new java.io.IOException(
                "Invalid test request"
              );
              header.append((char) value);
            }
            java.io.OutputStream output = socket.getOutputStream();
            output.write(
              (
                "HTTP/1.1 200 OK\r\nContent-Length: " +
                body.length +
                "\r\nConnection: close\r\n\r\n"
              ).getBytes(java.nio.charset.StandardCharsets.US_ASCII)
            );
            output.write(body);
          }
        }
      } catch (Throwable error) {
        serverFailure.set(error);
      }
    });
    serving.setDaemon(true);
    serving.start();
    try {
      String url = "http://127.0.0.1:" + server.getLocalPort();
      // Intentional self-hosted unsigned mode remains available without explicit keys.
      assertNotNull(
        ManifestClient.fetchLatest(
          url,
          "app",
          null,
          null,
          true,
          ManifestKeyConfig.parse(new JSONObject())
        )
      );
      ManifestVerifier.VerificationException failure = assertThrows(
        ManifestVerifier.VerificationException.class,
        () ->
          ManifestClient.fetchLatest(
            url,
            "app",
            null,
            null,
            true,
            ManifestKeyConfig.parse(new JSONObject("{\"manifestKeys\":\"mistyped\"}"))
          )
      );
      assertEquals("signature_missing", failure.reason);
      serving.join(10_000);
      assertFalse(serving.isAlive());
      assertNull(serverFailure.get());
    } finally {
      server.close();
    }
  }

  @Test
  public void wrongTypeCannotSilentlyDisableVerification() throws Exception {
    for (String value : new String[] { "\"mistyped\"", "{}", "123", "true", "null" }) {
      assertFalse(
        value,
        ManifestKeyConfig.parse(new JSONObject("{\"manifestKeys\":" + value + "}")).isEmpty()
      );
    }
  }

  @Test
  public void absentAndEmptyRetainIntentionalDefaults() throws Exception {
    assertTrue(ManifestKeyConfig.parse(new JSONObject()).isEmpty());
    assertTrue(ManifestKeyConfig.parse(new JSONObject("{\"manifestKeys\":[]}")).isEmpty());
  }

  @Test
  public void malformedEntriesRemainFailClosed() throws Exception {
    for (String value : new String[] { "[{}]", "[123]", "[{\"kid\":\"key\"}]" }) {
      assertFalse(
        ManifestKeyConfig.parse(new JSONObject("{\"manifestKeys\":" + value + "}")).isEmpty()
      );
    }
  }

  @Test
  public void validConfiguredKeyIsPreserved() throws Exception {
    ManifestVerifier.KeyEntry key = HostedManifestKeys.createDefaultKeys().get(0);
    String encoded = android.util.Base64.encodeToString(key.derData, android.util.Base64.NO_WRAP);
    JSONObject entry = new JSONObject().put("kid", key.kid).put("key", encoded);
    java.util.List<ManifestVerifier.KeyEntry> parsed = ManifestKeyConfig.parse(
      new JSONObject().put("manifestKeys", new org.json.JSONArray().put(entry))
    );
    assertEquals(1, parsed.size());
    assertEquals(key.kid, parsed.get(0).kid);
    assertArrayEquals(key.derData, parsed.get(0).derData);
  }
}
