package com.otakit.updater;

import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** A bounded, atomic snapshot. Transport never owns or changes event identity. */
final class EventOutbox {

  /**
   * Bounds of one outbox. OTA events and app telemetry have their own, in their own
   * directories, so a flood of app errors never evicts OTA events.
   */
  static final class Limits {

    final int count;
    final long ttl;
    final int maxBody;
    final int maxFile;
    /** The body field that identifies an entry; a retry never changes it. */
    final String idKey;
    final String fileName;

    Limits(int count, long ttl, int maxBody, int maxFile, String idKey, String fileName) {
      this.count = count;
      this.ttl = ttl;
      this.maxBody = maxBody;
      this.maxFile = maxFile;
      this.idKey = idKey;
      this.fileName = fileName;
    }

    static final Limits DEVICE_EVENTS = new Limits(
      256,
      7L * 24 * 60 * 60 * 1000,
      8192,
      4 * 1024 * 1024,
      "eventId",
      "events.json"
    );
    /** Batches of up to 64 KiB, kept 3 days: an hour of items each while offline. */
    static final Limits APP_TELEMETRY = new Limits(
      72,
      3L * 24 * 60 * 60 * 1000,
      64 * 1024,
      8 * 1024 * 1024,
      "batchId",
      "batches.json"
    );
  }

  static final int LIMIT = Limits.DEVICE_EVENTS.count;
  static final long TTL = Limits.DEVICE_EVENTS.ttl;
  /** New items join a pending entry with the same merge key for this long after it was created. */
  static final long MERGE_WINDOW = 60L * 60 * 1000;

  /** Combines two bodies into one, or returns null when they do not fit together. */
  interface Merge {
    String merge(String existing, String incoming) throws Exception;
  }

  static final class Entry {

    final String id, url, appId, body;
    final long createdAt, nextAt;
    final int attempts;
    /** When the outbox is full, lower priorities are evicted first. */
    final int priority;
    /** Entries with the same key can take in new items (see enqueue); null for none. */
    final String mergeKey;

    Entry(
      String idKey,
      String url,
      String appId,
      String body,
      long createdAt,
      int attempts,
      long nextAt
    ) throws Exception {
      this(idKey, url, appId, body, createdAt, attempts, nextAt, 0, null);
    }

    Entry(
      String idKey,
      String url,
      String appId,
      String body,
      long createdAt,
      int attempts,
      long nextAt,
      int priority,
      String mergeKey
    ) throws Exception {
      this.id = new JSONObject(body).getString(idKey);
      this.url = url;
      this.appId = appId;
      this.body = body;
      this.createdAt = createdAt;
      this.attempts = attempts;
      this.nextAt = nextAt;
      this.priority = priority;
      this.mergeKey = mergeKey;
    }

    JSONObject json() throws Exception {
      JSONObject json = new JSONObject()
        .put("url", url)
        .put("appId", appId)
        .put("body", body)
        .put("createdAt", createdAt)
        .put("attempts", attempts)
        .put("nextAt", nextAt);
      if (priority != 0) json.put("priority", priority);
      if (mergeKey != null) json.put("mergeKey", mergeKey);
      return json;
    }
  }

  final Limits limits;
  private final AtomicFile file;
  private List<Entry> entries = new ArrayList<>();
  /** The entry being delivered; it never takes in new items. */
  private String sendingId;

  EventOutbox(File directory) throws Exception {
    this(directory, Limits.DEVICE_EVENTS);
  }

  EventOutbox(File directory, Limits limits) throws Exception {
    this.limits = limits;
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException(
      "Cannot create event outbox"
    );
    file = new AtomicFile(new File(directory, limits.fileName));
    if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) return;
    byte[] bytes;
    try (java.io.InputStream input = file.openRead()) {
      if (file.getBaseFile().length() > limits.maxFile) throw new IOException(
        "Event outbox too large"
      );
      java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int count;
      while ((count = input.read(chunk)) != -1) {
        if (buffer.size() + count > limits.maxFile) throw new IOException("Event outbox too large");
        buffer.write(chunk, 0, count);
      }
      bytes = buffer.toByteArray();
    }
    try {
      JSONArray stored = new JSONArray(new String(bytes, StandardCharsets.UTF_8));
      for (int i = 0; i < stored.length(); i++) {
        JSONObject item = stored.getJSONObject(i);
        entries.add(
          new Entry(
            limits.idKey,
            item.getString("url"),
            item.getString("appId"),
            item.getString("body"),
            item.getLong("createdAt"),
            item.getInt("attempts"),
            item.getLong("nextAt"),
            item.optInt("priority", 0),
            item.has("mergeKey") ? item.getString("mergeKey") : null
          )
        );
      }
      if (entries.size() > limits.count) throw new IllegalStateException("Invalid outbox length");
    } catch (Exception corrupted) {
      android.util.Log.w("OtaKit", "Discarding unreadable event outbox");
      save(new ArrayList<>());
    }
  }

  synchronized void enqueue(String url, String appId, String body, long now) throws Exception {
    enqueue(url, appId, body, now, 0, null, null);
  }

  /**
   * Stores the body. With a merge key, the body joins the newest entry when that entry has the
   * same key, is not being delivered, is under an hour old, and merge can combine both within the
   * size limit. When the outbox is full, the oldest entry of the lowest priority up to priority is
   * evicted; when every entry has a higher priority, the body is refused.
   */
  synchronized void enqueue(
    String url,
    String appId,
    String body,
    long now,
    int priority,
    String mergeKey,
    Merge merge
  ) throws Exception {
    if (body.getBytes(StandardCharsets.UTF_8).length > limits.maxBody) throw new IOException(
      "Outbox entry too large"
    );
    List<Entry> next = live(now);
    Entry entry = new Entry(limits.idKey, url, appId, body, now, 0, now, priority, mergeKey);
    for (Entry existing : next) if (existing.id.equals(entry.id)) return;
    if (mergeKey != null && merge != null && !next.isEmpty()) {
      int last = next.size() - 1;
      Entry tail = next.get(last);
      if (
        mergeKey.equals(tail.mergeKey) &&
        !tail.id.equals(sendingId) &&
        tail.url.equals(url) &&
        tail.appId.equals(appId) &&
        now - tail.createdAt < MERGE_WINDOW
      ) {
        String merged = merge.merge(tail.body, body);
        if (merged != null && merged.getBytes(StandardCharsets.UTF_8).length <= limits.maxBody) {
          next.set(
            last,
            new Entry(
              limits.idKey,
              tail.url,
              tail.appId,
              merged,
              tail.createdAt,
              tail.attempts,
              tail.nextAt,
              tail.priority,
              tail.mergeKey
            )
          );
          save(next);
          return;
        }
      }
    }
    while (next.size() >= limits.count) {
      int lowest = Integer.MAX_VALUE;
      for (Entry existing : next) lowest = Math.min(lowest, existing.priority);
      if (lowest > priority) throw new IOException("Outbox full of higher-priority entries");
      for (int i = 0; i < next.size(); i++) {
        if (next.get(i).priority == lowest) {
          next.remove(i);
          break;
        }
      }
    }
    next.add(entry);
    save(next);
  }

  synchronized Entry ready(long now) throws Exception {
    List<Entry> next = live(now);
    if (next.size() != entries.size()) save(next);
    sendingId = null;
    for (Entry entry : entries) {
      if (entry.nextAt <= now) {
        sendingId = entry.id;
        return entry;
      }
    }
    return null;
  }

  synchronized Long waitMilliseconds(long now) {
    Long delay = null;
    for (Entry entry : entries) {
      long due = Math.min(entry.nextAt, entry.createdAt + limits.ttl);
      long candidate = Math.max(0, due - now);
      delay = delay == null ? candidate : Math.min(delay, candidate);
    }
    return delay;
  }

  synchronized void complete(String id, int status, String retryAfter, long now, double random)
    throws Exception {
    if (id.equals(sendingId)) sendingId = null;
    List<Entry> next = live(now);
    for (int i = 0; i < next.size(); i++) {
      Entry entry = next.get(i);
      if (!entry.id.equals(id)) continue;
      if (
        (status >= 200 && status < 300) ||
        (status >= 300 && status < 500 && status != 408 && status != 425 && status != 429)
      ) {
        next.remove(i);
      } else {
        int attempts = Math.min(entry.attempts + 1, 20);
        long backoff = (long) (Math.min(3_600_000, 5000L << Math.min(attempts - 1, 10)) *
          (0.5 + random));
        Long serverDelay = DownloadRetry.retryAfterMilliseconds(retryAfter, now);
        long delay = serverDelay == null ? backoff : Math.max(backoff, serverDelay);
        long due = delay > Long.MAX_VALUE - now ? Long.MAX_VALUE : now + delay;
        next.set(
          i,
          new Entry(
            limits.idKey,
            entry.url,
            entry.appId,
            entry.body,
            entry.createdAt,
            attempts,
            due,
            entry.priority,
            entry.mergeKey
          )
        );
      }
      break;
    }
    save(next);
  }

  private List<Entry> live(long now) {
    List<Entry> result = new ArrayList<>();
    for (Entry entry : entries) if (now < entry.createdAt + limits.ttl) result.add(entry);
    return result;
  }

  private void save(List<Entry> next) throws Exception {
    JSONArray data = new JSONArray();
    for (Entry entry : next) data.put(entry.json());
    FileOutputStream output = null;
    byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
    try {
      output = file.startWrite();
      output.write(bytes);
      output.getFD().sync();
      file.finishWrite(output);
      output = null;
      if (!java.util.Arrays.equals(bytes, file.readFully())) throw new IOException(
        "Event outbox commit failed"
      );
      entries = next;
    } catch (Exception error) {
      if (output != null) file.failWrite(output);
      throw error;
    }
  }
}
