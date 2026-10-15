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
  public void everyCheckAsksTheServerEvenWithAnHttpCacheInstalled() throws Exception {
    // An app may install an HTTP cache; a manifest kept there would hide a revert.
    byte[] fresh = (
      "{\"version\":\"2.0\",\"sha256\":\"hash2\",\"size\":1," +
      "\"releaseId\":\"release-b\",\"url\":\"https://example.test/b.zip\"}"
    ).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    byte[] stale = (
      "{\"version\":\"1.0\",\"sha256\":\"hash\",\"size\":1," +
      "\"releaseId\":\"release-a\",\"url\":\"https://example.test/a.zip\"}"
    ).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    java.util.concurrent.atomic.AtomicInteger lookups = new java.util.concurrent.atomic.AtomicInteger();
    java.net.ResponseCache previous = java.net.ResponseCache.getDefault();
    java.net.ResponseCache.setDefault(
      new java.net.ResponseCache() {
        @Override
        public java.net.CacheResponse get(
          java.net.URI uri,
          String method,
          java.util.Map<String, java.util.List<String>> headers
        ) {
          lookups.incrementAndGet();
          return new java.net.CacheResponse() {
            @Override
            public java.util.Map<String, java.util.List<String>> getHeaders() {
              java.util.Map<String, java.util.List<String>> cached = new java.util.HashMap<>();
              cached.put(null, java.util.List.of("HTTP/1.1 200 OK"));
              cached.put("Content-Length", java.util.List.of(String.valueOf(stale.length)));
              return cached;
            }

            @Override
            public java.io.InputStream getBody() {
              return new java.io.ByteArrayInputStream(stale);
            }
          };
        }

        @Override
        public java.net.CacheRequest put(java.net.URI uri, java.net.URLConnection connection) {
          return null;
        }
      }
    );
    java.net.ServerSocket server = new java.net.ServerSocket(
      0,
      2,
      java.net.InetAddress.getByName("127.0.0.1")
    );
    Thread serving = new Thread(() -> {
      try (java.net.Socket socket = server.accept()) {
        socket.setSoTimeout(10_000);
        java.io.InputStream input = socket.getInputStream();
        StringBuilder header = new StringBuilder();
        while (!header.toString().endsWith("\r\n\r\n")) {
          int value = input.read();
          if (value < 0) return;
          header.append((char) value);
        }
        java.io.OutputStream output = socket.getOutputStream();
        output.write(
          (
            "HTTP/1.1 200 OK\r\nContent-Length: " +
            fresh.length +
            "\r\nCache-Control: public, max-age=600\r\nConnection: close\r\n\r\n"
          ).getBytes(java.nio.charset.StandardCharsets.US_ASCII)
        );
        output.write(fresh);
      } catch (java.io.IOException ignored) {
        // The server closed: the request never came.
      }
    });
    serving.setDaemon(true);
    serving.start();
    try {
      ManifestClient.ParsedManifest parsed = ManifestClient.fetchLatest(
        "http://127.0.0.1:" + server.getLocalPort(),
        "cache-test",
        null,
        null,
        true,
        ManifestKeyConfig.parse(new JSONObject())
      );
      assertEquals("2.0", parsed.stable.version);
      assertEquals(0, lookups.get());
    } finally {
      java.net.ResponseCache.setDefault(previous);
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
