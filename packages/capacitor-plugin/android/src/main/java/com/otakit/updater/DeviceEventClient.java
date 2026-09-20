package com.otakit.updater;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class DeviceEventClient {

  private static final ScheduledExecutorService executor =
    Executors.newSingleThreadScheduledExecutor();
  private static EventOutbox outbox;
  private static ScheduledFuture<?> scheduled;
  private static boolean sending;

  private DeviceEventClient() {}

  static synchronized void resume(java.io.File directory) {
    try {
      if (outbox == null) outbox = new EventOutbox(directory);
      schedule();
    } catch (Exception error) {
      android.util.Log.w("OtaKit", "Cannot open device event outbox");
    }
  }

  private static synchronized void schedule() {
    if (sending || outbox == null) return;
    if (scheduled != null) scheduled.cancel(false);
    Long delay = outbox.waitMilliseconds(System.currentTimeMillis());
    scheduled =
      delay == null
        ? null
        : executor.schedule(DeviceEventClient::drain, delay, TimeUnit.MILLISECONDS);
  }

  private static void drain() {
    synchronized (DeviceEventClient.class) {
      if (sending) return;
      sending = true;
      if (scheduled != null) scheduled.cancel(false);
      scheduled = null;
    }
    boolean storageFailed = false;
    try {
      EventOutbox.Entry entry = outbox.ready(System.currentTimeMillis());
      if (entry == null) return;
      int status = 0;
      String retryAfter = null;
      HttpURLConnection connection = null;
      try {
        connection = (HttpURLConnection) new URL(entry.url).openConnection();
        connection.setRequestMethod("POST");
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("X-App-Id", entry.appId);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(10_000);
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
          output.write(entry.body.getBytes(StandardCharsets.UTF_8));
        }
        status = connection.getResponseCode();
        retryAfter = connection.getHeaderField("Retry-After");
      } catch (Exception ignored) {
        // Retain the original ID and body after a lost response or offline failure.
      } finally {
        if (connection != null) connection.disconnect();
      }
      outbox.complete(entry.id, status, retryAfter, System.currentTimeMillis(), Math.random());
    } catch (Exception error) {
      storageFailed = true;
      android.util.Log.w("OtaKit", "Cannot persist device event delivery state");
    } finally {
      synchronized (DeviceEventClient.class) {
        sending = false;
        // A broken disk must not create a zero-delay retry loop.
        if (storageFailed) scheduled = executor.schedule(
          DeviceEventClient::drain,
          60,
          TimeUnit.SECONDS
        );
        else schedule();
      }
    }
  }

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
    synchronized (DeviceEventClient.class) {
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
          String truncated = detail.length() > 500 ? detail.substring(0, 500) : detail;
          payload.put("detail", truncated);
        }

        if (outbox == null) throw new java.io.IOException("Outbox unavailable");
        outbox.enqueue(url.toString(), appId, payload.toString(), System.currentTimeMillis());
        schedule();
      } catch (Exception ignored) {
        // Persistence failure must not fail or roll back the update itself.
        android.util.Log.w("OtaKit", "Cannot persist device event");
      }
    }
  }

  private static String iso8601Now() {
    SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
    return formatter.format(new Date());
  }
}
