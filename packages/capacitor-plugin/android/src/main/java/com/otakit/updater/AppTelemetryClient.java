package com.otakit.updater;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * App telemetry (error tracking, plugin 3.4+): items from JavaScript, wrapped in batches with the
 * device context and delivered from their own outbox, so app errors never delay or evict OTA
 * update events.
 */
final class AppTelemetryClient {

  static final int MAX_ITEM_BYTES = 16 * 1024;
  static final int MAX_BATCH_ITEMS = 50;
  /** Room for the items of one batch; the envelope fits in the rest of the outbox's 64 KiB. */
  static final int MAX_BATCH_ITEM_BYTES = 56 * 1024;

  /**
   * Random per process start, so the dashboard can count app launches with an error. Not
   * persisted and not a device identifier.
   */
  static final String SESSION_ID = UUID.randomUUID().toString();

  private static final OutboxDelivery delivery = new OutboxDelivery(
    EventOutbox.Limits.APP_TELEMETRY,
    "app telemetry"
  );

  private AppTelemetryClient() {}

  static void resume(File directory) {
    delivery.resume(directory);
  }

  static boolean hasPending() {
    return delivery.hasPending();
  }

  static final class Batches {

    final List<String> bodies = new ArrayList<>();
    final List<Integer> itemCounts = new ArrayList<>();
    int dropped;
  }

  interface IdSource {
    String next();
  }

  /**
   * Wraps valid items (JSON objects with a string kind, at most 16 KiB) in batches of at most 50
   * items that fit the outbox.
   */
  static Batches batches(JSONArray items, JSONObject context, long now, IdSource ids) {
    Batches result = new Batches();
    List<List<JSONObject>> groups = new ArrayList<>();
    List<JSONObject> current = new ArrayList<>();
    int currentBytes = 0;
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.optJSONObject(i);
      int size = item == null ? 0 : item.toString().getBytes(StandardCharsets.UTF_8).length;
      if (item == null || !(item.opt("kind") instanceof String) || size > MAX_ITEM_BYTES) {
        result.dropped++;
        continue;
      }
      if (
        !current.isEmpty() &&
        (current.size() >= MAX_BATCH_ITEMS || currentBytes + size > MAX_BATCH_ITEM_BYTES)
      ) {
        groups.add(current);
        current = new ArrayList<>();
        currentBytes = 0;
      }
      current.add(item);
      currentBytes += size + 1;
    }
    if (!current.isEmpty()) groups.add(current);

    String sentAt = iso8601(now);
    for (List<JSONObject> group : groups) {
      try {
        JSONArray list = new JSONArray();
        for (JSONObject item : group) list.put(item);
        String body = new JSONObject()
          .put("batchId", ids.next())
          .put("sentAt", sentAt)
          .put("context", context)
          .put("items", list)
          .toString();
        if (
          body.getBytes(StandardCharsets.UTF_8).length > EventOutbox.Limits.APP_TELEMETRY.maxBody
        ) {
          result.dropped += group.size();
          continue;
        }
        result.bodies.add(body);
        result.itemCounts.add(group.size());
      } catch (Exception error) {
        result.dropped += group.size();
      }
    }
    return result;
  }

  /** Persists the items for delivery to {ingestUrl}/app-telemetry; returns [accepted, dropped]. */
  static int[] enqueue(String ingestUrl, String appId, JSONObject context, JSONArray items) {
    String url = ingestUrl.replaceAll("/+$", "") + "/app-telemetry";
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return new int[] { 0, items.length() };
    }
    Batches batches = batches(items, context, System.currentTimeMillis(), () ->
      UUID.randomUUID().toString()
    );
    int accepted = 0;
    int dropped = batches.dropped;
    for (int i = 0; i < batches.bodies.size(); i++) {
      if (delivery.enqueue(url, appId, batches.bodies.get(i))) accepted += batches.itemCounts.get(
        i
      );
      else dropped += batches.itemCounts.get(i);
    }
    return new int[] { accepted, dropped };
  }

  private static String iso8601(long time) {
    SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
    formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
    return formatter.format(new Date(time));
  }
}
