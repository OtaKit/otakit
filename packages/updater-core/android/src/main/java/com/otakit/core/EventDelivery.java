package com.otakit.core;

import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Independent telemetry worker. The committed outbox owns identity; HTTP 202 only acknowledges it. */
public final class EventDelivery {

  public interface Sender {
    int post(URI url, String appId, byte[] body) throws Exception;
  }

  private final LaunchStore store;
  private final URI endpoint;
  private final String appId;
  private final String platform;
  private final String nativeBuild;
  private final Sender sender;
  private int failures;

  public EventDelivery(
    LaunchStore store,
    String base,
    String appId,
    String platform,
    String nativeBuild,
    boolean allowLocalhost
  ) throws Exception {
    this(store, base, appId, platform, nativeBuild, allowLocalhost, EventDelivery::post);
  }

  public EventDelivery(
    LaunchStore store,
    String base,
    String appId,
    String platform,
    String nativeBuild,
    boolean allowLocalhost,
    Sender sender
  ) throws Exception {
    endpoint = new URI(base.replaceAll("/+$", "") + "/events");
    if (
      endpoint.getHost() == null ||
      endpoint.getHost().isEmpty() ||
      endpoint.getUserInfo() != null ||
      endpoint.getRawQuery() != null ||
      endpoint.getRawFragment() != null ||
      !("https".equals(endpoint.getScheme()) ||
        (allowLocalhost &&
          "http".equals(endpoint.getScheme()) &&
          Set.of("localhost", "127.0.0.1", "::1", "[::1]").contains(endpoint.getHost())))
    ) throw new Exception("Invalid ingest URL");
    this.store = store;
    this.appId = appId;
    this.platform = platform;
    this.nativeBuild = nativeBuild;
    this.sender = sender;
  }

  public void start() {
    java.util.concurrent.ScheduledExecutorService executor =
      Executors.newSingleThreadScheduledExecutor();
    executor.execute(
      new Runnable() {
        @Override
        public void run() {
          executor.schedule(this, flushOnce(), TimeUnit.SECONDS);
        }
      }
    );
  }

  public synchronized long flushOnce() {
    try {
      JSONObject event = store.eventForDelivery();
      if (event == null) {
        failures = 0;
        return 5;
      }
      String id = event.getString("id");
      byte[] body;
      try {
        JSONObject artifact = event.getJSONObject("artifact");
        String action = event.getString("type");
        if (
          !appId.equals(artifact.getString("appId")) ||
          !platform.equals(artifact.getString("platform")) ||
          !Set.of("downloaded", "applied", "download_error", "rollback").contains(action) ||
          artifact.isNull("releaseId") ||
          artifact.getString("releaseId").isEmpty()
        ) throw new Exception("Invalid event attribution");
        JSONObject payload = new JSONObject()
          .put("eventId", id)
          .put(
            "sentAt",
            Instant.ofEpochMilli((long) (event.getDouble("createdAt") * 1000)).toString()
          )
          .put("platform", platform)
          .put("action", action)
          .put("bundleVersion", artifact.getString("version"))
          .put(
            "channel",
            artifact.opt("channel") == null ? JSONObject.NULL : artifact.opt("channel")
          )
          .put("runtimeVersion", artifact.getString("runtimeVersion"))
          .put("releaseId", artifact.getString("releaseId"))
          .put("nativeBuild", nativeBuild)
          .put("detail", event.opt("detail") == null ? JSONObject.NULL : event.opt("detail"));
        body = payload.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > 8192) throw new Exception("Oversized event");
      } catch (Exception error) {
        store.discardEvent(id, "Invalid event payload or attribution");
        return 0;
      }
      int status = sender.post(endpoint, appId, body);
      if (status == 202) {
        store.acknowledgeEvents(Set.of(id));
        failures = 0;
        return 0;
      }
      if (status >= 300 && status < 500 && status != 408 && status != 429) {
        store.discardEvent(id, "Event delivery HTTP " + status);
        failures = 0;
        return 0;
      }
    } catch (Exception error) {
      /* Preserve the event and its ID after network or durable-ack failure. */
    }
    failures = Math.min(failures + 1, 7);
    return Math.min(300, 5L << (failures - 1));
  }

  private static int post(URI endpoint, String appId, byte[] body) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) endpoint.toURL().openConnection();
    try {
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(10_000);
      connection.setReadTimeout(10_000);
      connection.setRequestMethod("POST");
      connection.setDoOutput(true);
      connection.setFixedLengthStreamingMode(body.length);
      connection.setRequestProperty("Content-Type", "application/json");
      connection.setRequestProperty("X-App-Id", appId);
      try (java.io.OutputStream output = connection.getOutputStream()) {
        output.write(body);
      }
      return connection.getResponseCode(); // Do not buffer an untrusted response body.
    } finally {
      connection.disconnect();
    }
  }
}
