package com.updatekit.updater;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

final class StatsClient {

  private static final ExecutorService executor = Executors.newSingleThreadExecutor();

  private StatsClient() {}

  static void send(
    String updateUrl,
    String appId,
    String platform,
    String action,
    String bundleVersion,
    String channel,
    String releaseId,
    String nativeBuild,
    String errorMessage
  ) {
    executor.execute(() -> {
      HttpURLConnection connection = null;
      try {
        String base = updateUrl.replaceAll("/+$", "");
        URL url = new URL(base + "/stats");

        JSONObject payload = new JSONObject();
        payload.put("platform", platform);
        payload.put("action", action);
        if (bundleVersion != null) {
          payload.put("bundleVersion", bundleVersion);
        }
        if (channel != null && !channel.isEmpty()) {
          payload.put("channel", channel);
        }
        if (releaseId != null && !releaseId.isEmpty()) {
          payload.put("releaseId", releaseId);
        }
        if (nativeBuild != null) {
          payload.put("nativeBuild", nativeBuild);
        }
        if (errorMessage != null) {
          String truncated =
            errorMessage.length() > 500 ? errorMessage.substring(0, 500) : errorMessage;
          payload.put("errorMessage", truncated);
        }

        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);

        connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setRequestProperty("X-App-Id", appId);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setDoOutput(true);

        try (OutputStream output = connection.getOutputStream()) {
          output.write(body);
        }

        // Fire and forget - just trigger the request
        connection.getResponseCode();
      } catch (Exception ignored) {
        // Stats are best-effort, don't fail on errors
      } finally {
        if (connection != null) {
          connection.disconnect();
        }
      }
    });
  }
}
