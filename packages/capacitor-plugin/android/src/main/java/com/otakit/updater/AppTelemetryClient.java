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
 * App telemetry (error tracking and custom events, plugin 3.4+): items from JavaScript, wrapped in
 * batches with the device context and delivered from their own outbox, so they never delay or
 * evict OTA update events. Errors and events go in separate batches; while a batch waits
 * (offline), new items of the same kind and context join it, and a full outbox evicts events
 * first.
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

  /** Errors and A/B test reports are kept over events when the outbox is full. */
  enum Lane {
    ERROR,
    EVENT,
    REPORT;

    int priority() {
      return this == EVENT ? 0 : 1;
    }
  }

  static final class Batches {

    final List<String> bodies = new ArrayList<>();
    final List<Integer> itemCounts = new ArrayList<>();
    final List<Lane> lanes = new ArrayList<>();
    int dropped;
  }

  interface IdSource {
    String next();
  }

  /**
   * Wraps valid items (JSON objects with a string kind, at most 16 KiB) in batches of one lane and
   * at most 50 items that fit the outbox.
   */
  static Batches batches(JSONArray items, JSONObject context, long now, IdSource ids) {
    Batches result = new Batches();
    List<List<JSONObject>> groups = new ArrayList<>();
    List<Lane> groupLanes = new ArrayList<>();
    List<JSONObject> current = new ArrayList<>();
    Lane currentLane = Lane.EVENT;
    int currentBytes = 0;
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.optJSONObject(i);
      int size = item == null ? 0 : item.toString().getBytes(StandardCharsets.UTF_8).length;
      if (item == null || !(item.opt("kind") instanceof String) || size > MAX_ITEM_BYTES) {
        result.dropped++;
        continue;
      }
      Lane lane = "error".equals(item.optString("kind")) ? Lane.ERROR : Lane.EVENT;
      if (
        !current.isEmpty() &&
        (lane != currentLane ||
          current.size() >= MAX_BATCH_ITEMS ||
          currentBytes + size > MAX_BATCH_ITEM_BYTES)
      ) {
        groups.add(current);
        groupLanes.add(currentLane);
        current = new ArrayList<>();
        currentBytes = 0;
      }
      currentLane = lane;
      current.add(item);
      currentBytes += size + 1;
    }
    if (!current.isEmpty()) {
      groups.add(current);
      groupLanes.add(currentLane);
    }

    String sentAt = iso8601(now);
    for (int index = 0; index < groups.size(); index++) {
      List<JSONObject> group = groups.get(index);
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
        result.lanes.add(groupLanes.get(index));
      } catch (Exception error) {
        result.dropped += group.size();
      }
    }
    return result;
  }

  /**
   * Items of both batches in the first one (its ID, time and context), or null when they would be
   * over 50 items.
   */
  static String mergeBatches(String existing, String incoming) throws Exception {
    JSONObject batch = new JSONObject(existing);
    JSONArray current = batch.getJSONArray("items");
    JSONArray added = new JSONObject(incoming).getJSONArray("items");
    if (current.length() + added.length() > MAX_BATCH_ITEMS) return null;
    for (int i = 0; i < added.length(); i++) current.put(added.get(i));
    return batch.toString();
  }

  /** Batches only take in items of the same lane and device context. */
  static String mergeKey(Lane lane, JSONObject context) {
    return lane.name().toLowerCase(Locale.US) + "|" + context.toString();
  }

  /** Persists the items for delivery to {ingestUrl}/app-telemetry; returns [accepted, dropped]. */
  static int[] enqueue(String ingestUrl, String appId, JSONObject context, JSONArray items) {
    return enqueue(ingestUrl, appId, context, items, null);
  }

  /** As enqueue; a lane overrides the one from the items' kind (A/B test reports). */
  static int[] enqueue(
    String ingestUrl,
    String appId,
    JSONObject context,
    JSONArray items,
    Lane override
  ) {
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
      Lane lane = override != null ? override : batches.lanes.get(i);
      boolean stored = delivery.enqueue(
        url,
        appId,
        batches.bodies.get(i),
        lane.priority(),
        mergeKey(lane, context),
        AppTelemetryClient::mergeBatches
      );
      if (stored) accepted += batches.itemCounts.get(i);
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
