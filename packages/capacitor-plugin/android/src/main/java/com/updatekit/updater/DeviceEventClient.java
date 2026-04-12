package com.updatekit.updater;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.UUID;
import org.json.JSONObject;

final class DeviceEventClient {

  private static final ExecutorService executor = Executors.newSingleThreadExecutor();

  private DeviceEventClient() {}

  static void send(
    String ingestUrl,
    String appId,
    String platform,
    String action,
    String bundleVersion,
    String channel,
    String runtimeVersion,
    String releaseId,
    String nativeBuild,
    String detail
  ) {
    executor.execute(() -> {
      HttpURLConnection connection = null;
      try {
        String base = ingestUrl.replaceAll("/+$", "");
        URL url = new URL(base + "/events");

        JSONObject payload = new JSONObject();
        payload.put("eventId", UUID.randomUUID().toString());
        payload.put("sentAt", iso8601Now());
        payload.put("platform", platform);
        payload.put("action", action);
        payload.put("bundleVersion", bundleVersion);
        if (channel != null && !channel.isEmpty()) {
          payload.put("channel", channel);
        }
        if (runtimeVersion != null && !runtimeVersion.isEmpty()) {
          payload.put("runtimeVersion", runtimeVersion);
        }
        payload.put("releaseId", releaseId);
        payload.put("nativeBuild", nativeBuild);
        if (detail != null) {
          String truncated =
            detail.length() > 500 ? detail.substring(0, 500) : detail;
          payload.put("detail", truncated);
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

        // Device events are best-effort and should never block the update flow.
        connection.getResponseCode();
      } catch (Exception ignored) {
        // Device events are best-effort, don't fail on errors
      } finally {
        if (connection != null) {
          connection.disconnect();
        }
      }
    });
  }

  private static String iso8601Now() {
    SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
    return formatter.format(new Date());
  }
}
