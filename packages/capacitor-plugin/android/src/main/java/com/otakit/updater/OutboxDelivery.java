package com.otakit.updater;

import java.io.File;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * One serial delivery loop for one outbox, independent of any Capacitor bridge lifetime.
 * Device events and app telemetry each have their own.
 */
final class OutboxDelivery {

  private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
  private final EventOutbox.Limits limits;
  private final String name;
  private EventOutbox outbox;
  private ScheduledFuture<?> scheduled;
  private boolean sending;

  OutboxDelivery(EventOutbox.Limits limits, String name) {
    this.limits = limits;
    this.name = name;
  }

  synchronized boolean hasPending() {
    return outbox != null && outbox.waitMilliseconds(System.currentTimeMillis()) != null;
  }

  synchronized void resume(File directory) {
    try {
      if (outbox == null) outbox = new EventOutbox(directory, limits);
      schedule();
    } catch (Exception error) {
      android.util.Log.w("OtaKit", "Cannot open the " + name + " outbox");
    }
  }

  /** Persists the body for delivery; false when it could not be stored. */
  synchronized boolean enqueue(String url, String appId, String body) {
    return enqueue(url, appId, body, 0, null, null);
  }

  /** As enqueue, with a priority and merging (see EventOutbox.enqueue). */
  synchronized boolean enqueue(
    String url,
    String appId,
    String body,
    int priority,
    String mergeKey,
    EventOutbox.Merge merge
  ) {
    try {
      if (outbox == null) throw new java.io.IOException("Outbox unavailable");
      outbox.enqueue(url, appId, body, System.currentTimeMillis(), priority, mergeKey, merge);
      schedule();
      return true;
    } catch (Exception error) {
      android.util.Log.w("OtaKit", "Cannot persist to the " + name + " outbox");
      return false;
    }
  }

  private synchronized void schedule() {
    if (sending || outbox == null) return;
    if (scheduled != null) scheduled.cancel(false);
    Long delay = outbox.waitMilliseconds(System.currentTimeMillis());
    scheduled = delay == null ? null : executor.schedule(this::drain, delay, TimeUnit.MILLISECONDS);
  }

  private void drain() {
    EventOutbox current;
    synchronized (this) {
      if (sending || outbox == null) return;
      sending = true;
      if (scheduled != null) scheduled.cancel(false);
      scheduled = null;
      current = outbox;
    }
    boolean storageFailed = false;
    try {
      EventOutbox.Entry entry = current.ready(System.currentTimeMillis());
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
      current.complete(entry.id, status, retryAfter, System.currentTimeMillis(), Math.random());
    } catch (Exception error) {
      storageFailed = true;
      android.util.Log.w("OtaKit", "Cannot persist " + name + " delivery state");
    } finally {
      synchronized (this) {
        sending = false;
        // A broken disk must not create a zero-delay retry loop.
        if (storageFailed) scheduled = executor.schedule(this::drain, 60, TimeUnit.SECONDS);
        else schedule();
      }
    }
  }
}
