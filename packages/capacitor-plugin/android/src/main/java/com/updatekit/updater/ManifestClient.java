package com.updatekit.updater;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class ManifestClient {

  static final class ManifestSignature {

    final String kid;
    final String sig;
    final int iat;
    final int exp;

    ManifestSignature(String kid, String sig, int iat, int exp) {
      this.kid = kid;
      this.sig = sig;
      this.iat = iat;
      this.exp = exp;
    }
  }

  static final class LatestManifest {

    final String version;
    final String url;
    final String sha256;
    final int size;
    final Integer minNativeBuild;
    final String releaseId;
    final ManifestSignature signature;

    LatestManifest(
      String version,
      String url,
      String sha256,
      int size,
      Integer minNativeBuild,
      String releaseId,
      ManifestSignature signature
    ) {
      this.version = version;
      this.url = url;
      this.sha256 = sha256;
      this.size = size;
      this.minNativeBuild = minNativeBuild;
      this.releaseId = releaseId;
      this.signature = signature;
    }
  }

  private ManifestClient() {}

  static void requireHTTPS(URL url, boolean allowInsecure) throws Exception {
    String protocol = url.getProtocol().toLowerCase();
    if ("https".equals(protocol)) return;
    if (allowInsecure) {
      String host = url.getHost().toLowerCase();
      if ("localhost".equals(host) || "127.0.0.1".equals(host)) return;
    }
    throw new IllegalStateException("URL must use HTTPS: " + url.toString());
  }

  static LatestManifest fetchLatest(
    String updateUrl,
    String appId,
    String channel,
    String currentVersion,
    String currentReleaseId,
    String nativeBuild,
    String platform,
    boolean allowInsecureUrls,
    java.util.List<ManifestVerifier.KeyEntry> manifestKeys
  ) throws Exception {
    String base = updateUrl.replaceAll("/+$", "");
    URL url = new URL(base + "/manifest");

    requireHTTPS(url, allowInsecureUrls);

    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    try {
      connection.setRequestMethod("GET");
      connection.setRequestProperty("X-App-Id", appId);
      connection.setRequestProperty("X-Platform", platform);
      if (channel != null && !channel.trim().isEmpty()) {
        connection.setRequestProperty("X-Channel", channel);
      }
      connection.setRequestProperty("X-Current-Version", currentVersion);
      if (currentReleaseId != null && !currentReleaseId.trim().isEmpty()) {
        connection.setRequestProperty("X-Release-Id", currentReleaseId);
      }
      connection.setRequestProperty("X-Native-Build", nativeBuild);
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(30_000);

      int status = connection.getResponseCode();
      if (status == 204) {
        return null;
      }
      if (status != 200) {
        String body = readStream(
          connection.getErrorStream() != null
            ? connection.getErrorStream()
            : connection.getInputStream()
        );
        throw new IllegalStateException("Latest request failed (" + status + "): " + body);
      }

      String payload = readStream(connection.getInputStream());
      JSONObject json = new JSONObject(payload);

      String version = json.getString("version");
      String downloadUrl = json.getString("url");
      String sha256 = json.getString("sha256");
      int size = json.getInt("size");

      Integer minNativeBuild = null;
      if (json.has("minNativeBuild") && !json.isNull("minNativeBuild")) {
        Object raw = json.get("minNativeBuild");
        if (raw instanceof Number) {
          minNativeBuild = ((Number) raw).intValue();
        } else if (raw instanceof String) {
          String value = ((String) raw).trim();
          if (!value.isEmpty()) {
            minNativeBuild = Integer.parseInt(value);
          }
        }
      }

      ManifestSignature signature = null;
      if (json.has("signature") && !json.isNull("signature")) {
        JSONObject sigObj = json.getJSONObject("signature");
        if (sigObj.has("kid") && sigObj.has("sig") && sigObj.has("iat") && sigObj.has("exp")) {
          signature = new ManifestSignature(
            sigObj.getString("kid"),
            sigObj.getString("sig"),
            sigObj.getInt("iat"),
            sigObj.getInt("exp")
          );
        }
      }

      String releaseId = null;
      if (json.has("releaseId") && !json.isNull("releaseId")) {
        releaseId = json.getString("releaseId");
      }

      // Validate download URL scheme
      requireHTTPS(new URL(downloadUrl), allowInsecureUrls);

      if (manifestKeys == null || manifestKeys.isEmpty()) {
        android.util.Log.w(
          "UpdateKit",
          "No manifest signing keys configured — signature verification is disabled for this request."
        );
      }

      // Verify manifest signature if signing keys are configured
      if (manifestKeys != null && !manifestKeys.isEmpty()) {
        if (signature == null) {
          throw new IllegalStateException(
            "Manifest signature missing but signing keys are configured"
          );
        }
        ManifestVerifier.verify(
          appId,
          channel,
          platform,
          version,
          sha256,
          size,
          minNativeBuild,
          signature,
          manifestKeys
        );
      }

      return new LatestManifest(
        version,
        downloadUrl,
        sha256,
        size,
        minNativeBuild,
        releaseId,
        signature
      );
    } finally {
      connection.disconnect();
    }
  }

  private static String readStream(InputStream input) throws Exception {
    if (input == null) {
      return "";
    }
    try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      int read;
      while ((read = stream.read(buffer)) > 0) {
        out.write(buffer, 0, read);
      }
      return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
  }
}
