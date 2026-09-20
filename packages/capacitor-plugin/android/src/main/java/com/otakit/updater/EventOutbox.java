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

  static final int LIMIT = 256;
  static final long TTL = 7L * 24 * 60 * 60 * 1000;

  static final class Entry {

    final String id, url, appId, body;
    final long createdAt, nextAt;
    final int attempts;

    Entry(String url, String appId, String body, long createdAt, int attempts, long nextAt)
      throws Exception {
      this.id = new JSONObject(body).getString("eventId");
      this.url = url;
      this.appId = appId;
      this.body = body;
      this.createdAt = createdAt;
      this.attempts = attempts;
      this.nextAt = nextAt;
    }

    JSONObject json() throws Exception {
      return new JSONObject()
        .put("url", url)
        .put("appId", appId)
        .put("body", body)
        .put("createdAt", createdAt)
        .put("attempts", attempts)
        .put("nextAt", nextAt);
    }
  }

  private final AtomicFile file;
  private List<Entry> entries = new ArrayList<>();

  EventOutbox(File directory) throws Exception {
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException(
      "Cannot create event outbox"
    );
    file = new AtomicFile(new File(directory, "events.json"));
    if (!file.getBaseFile().exists() && !new File(file.getBaseFile() + ".bak").exists()) return;
    byte[] bytes;
    try (java.io.InputStream input = file.openRead()) {
      if (file.getBaseFile().length() > 4 * 1024 * 1024) throw new IOException(
        "Event outbox too large"
      );
      java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int count;
      while ((count = input.read(chunk)) != -1) {
        if (buffer.size() + count > 4 * 1024 * 1024) throw new IOException(
          "Event outbox too large"
        );
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
            item.getString("url"),
            item.getString("appId"),
            item.getString("body"),
            item.getLong("createdAt"),
            item.getInt("attempts"),
            item.getLong("nextAt")
          )
        );
      }
      if (entries.size() > LIMIT) throw new IllegalStateException("Invalid outbox length");
    } catch (Exception corrupted) {
      android.util.Log.w("OtaKit", "Discarding unreadable event outbox");
      save(new ArrayList<>());
    }
  }

  synchronized void enqueue(String url, String appId, String body, long now) throws Exception {
    if (body.getBytes(StandardCharsets.UTF_8).length > 8192) throw new IOException(
      "Device event too large"
    );
    List<Entry> next = live(now);
    Entry entry = new Entry(url, appId, body, now, 0, now);
    for (Entry existing : next) if (existing.id.equals(entry.id)) return;
    while (next.size() >= LIMIT) next.remove(0);
    next.add(entry);
    save(next);
  }

  synchronized Entry ready(long now) throws Exception {
    List<Entry> next = live(now);
    if (next.size() != entries.size()) save(next);
    for (Entry entry : entries) if (entry.nextAt <= now) return entry;
    return null;
  }

  synchronized Long waitMilliseconds(long now) {
    Long delay = null;
    for (Entry entry : entries) {
      long due = Math.min(entry.nextAt, entry.createdAt + TTL);
      long candidate = Math.max(0, due - now);
      delay = delay == null ? candidate : Math.min(delay, candidate);
    }
    return delay;
  }

  synchronized void complete(String id, int status, String retryAfter, long now, double random)
    throws Exception {
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
        next.set(i, new Entry(entry.url, entry.appId, entry.body, entry.createdAt, attempts, due));
      }
      break;
    }
    save(next);
  }

  private List<Entry> live(long now) {
    List<Entry> result = new ArrayList<>();
    for (Entry entry : entries) if (now < entry.createdAt + TTL) result.add(entry);
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
