package com.otakit.updater;

import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONObject;

final class DeviceEventClient {

  private static final OutboxDelivery delivery = new OutboxDelivery(
    EventOutbox.Limits.DEVICE_EVENTS,
    "device event"
  );

  private DeviceEventClient() {}

  static boolean hasPendingEvents() {
    return delivery.hasPending();
  }

  static void resume(java.io.File directory) {
    delivery.resume(directory);
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
    send(
      ingestUrl,
      appId,
      platform,
      action,
      bundleVersion,
      channel,
      runtimeVersion,
      releaseId,
      nativeBuild,
      detail,
      null,
      null,
      "unknown"
    );
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
    String detail,
    String attemptId,
    String phase,
    String lifecycle
  ) {
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
      payload.put("nativeSdkVersion", SDKVersion.VALUE);
      payload.put("attemptId", attemptId);
      payload.put("phase", phase);
      payload.put("lifecycle", lifecycle);
      if (detail != null) {
        String truncated = detail.length() > 500 ? detail.substring(0, 500) : detail;
        payload.put("detail", truncated);
      }

      // Persistence failure must not fail or roll back the update itself.
      delivery.enqueue(url.toString(), appId, payload.toString());
    } catch (Exception ignored) {
      android.util.Log.w("OtaKit", "Cannot build device event");
    }
  }

  private static String iso8601Now() {
    SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
    return formatter.format(new Date());
  }
}
