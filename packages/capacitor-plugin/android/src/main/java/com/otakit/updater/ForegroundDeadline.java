package com.otakit.updater;

import android.os.Handler;
import android.os.SystemClock;
import java.util.function.LongSupplier;

/** Owned by the main thread. Only foreground time consumes the readiness budget. */
final class ForegroundDeadline {

  interface Scheduler {
    Runnable schedule(long delayMs, Runnable callback);
  }

  private final LongSupplier now;
  private final Scheduler scheduler;
  private boolean foreground;
  private long remainingMs;
  private long startedAt;
  private long generation;
  private Runnable action;
  private Runnable cancelScheduled;

  ForegroundDeadline(Handler handler) {
    this(SystemClock::uptimeMillis, (delay, callback) -> {
      handler.postDelayed(callback, delay);
      return () -> handler.removeCallbacks(callback);
    });
  }

  ForegroundDeadline(LongSupplier now, Scheduler scheduler) {
    this.now = now;
    this.scheduler = scheduler;
  }

  void start(long timeoutMs, Runnable action) {
    cancel();
    remainingMs = Math.max(0, timeoutMs);
    this.action = action;
    arm();
  }

  void setForeground(boolean value) {
    if (foreground == value) return;
    if (foreground && action != null) {
      remainingMs = Math.max(0, remainingMs - Math.max(0, now.getAsLong() - startedAt));
    }
    disarm();
    foreground = value;
    arm();
  }

  void cancel() {
    disarm();
    action = null;
    remainingMs = 0;
  }

  private void disarm() {
    generation++;
    if (cancelScheduled != null) cancelScheduled.run();
    cancelScheduled = null;
  }

  private void arm() {
    if (!foreground || action == null) return;
    startedAt = now.getAsLong();
    long expectedGeneration = ++generation;
    cancelScheduled = scheduler.schedule(remainingMs, () -> fire(expectedGeneration));
  }

  private void fire(long expectedGeneration) {
    if (generation != expectedGeneration || !foreground || action == null) return;
    remainingMs = Math.max(0, remainingMs - Math.max(0, now.getAsLong() - startedAt));
    cancelScheduled = null;
    if (remainingMs > 0) {
      arm();
      return;
    }
    Runnable expired = action;
    action = null;
    generation++;
    expired.run();
  }
}
