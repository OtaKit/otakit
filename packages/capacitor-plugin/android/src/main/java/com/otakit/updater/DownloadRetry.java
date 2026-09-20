package com.otakit.updater;

import java.io.IOException;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Callable;
import java.util.function.DoubleSupplier;
import java.util.function.LongSupplier;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

/** Bounded retries for GET transport failures. Integrity and disk failures stay terminal. */
final class DownloadRetry {

  static boolean isExpiredUrlFailure(Exception error) {
    if (!(error instanceof HttpFailure)) return false;
    int status = ((HttpFailure) error).status;
    return status == 403 || status == 410;
  }

  interface Sleeper {
    void sleep(long milliseconds) throws InterruptedException;
  }

  static final class HttpFailure extends IOException {

    final int status;
    final String retryAfter;

    HttpFailure(int status, String retryAfter) {
      super("Download failed with HTTP " + status);
      this.status = status;
      this.retryAfter = retryAfter;
    }
  }

  static final class NetworkFailure extends IOException {

    NetworkFailure(IOException cause) {
      super("Download connection failed (" + cause.getClass().getSimpleName() + ")", cause);
    }

    @Override
    public String getMessage() {
      // Only locally constructed EOF diagnostics are safe to include; arbitrary network messages may contain URLs.
      String detail = getCause() instanceof java.io.EOFException ? getCause().getMessage() : null;
      return (
        super.getMessage() +
        (detail != null && detail.startsWith("body length mismatch;") ? "; " + detail : "")
      );
    }
  }

  private final Sleeper sleeper;
  private final DoubleSupplier random;
  private final LongSupplier now;

  DownloadRetry() {
    this(Thread::sleep, Math::random, System::currentTimeMillis);
  }

  DownloadRetry(Sleeper sleeper, DoubleSupplier random, LongSupplier now) {
    this.sleeper = sleeper;
    this.random = random;
    this.now = now;
  }

  <T> T run(Callable<T> operation) throws Exception {
    for (int attempt = 1; ; attempt++) {
      if (
        Thread.currentThread().isInterrupted()
      ) throw new java.util.concurrent.CancellationException("Download cancelled");
      try {
        return operation.call();
      } catch (Exception failure) {
        Long delay = delay(failure, attempt);
        if (delay == null) throw failure;
        try {
          sleeper.sleep(delay);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          throw new java.util.concurrent.CancellationException("Download cancelled");
        }
      }
    }
  }

  Long delay(Exception failure, int attempt) {
    if (attempt >= 3 || attempt < 1 || Thread.currentThread().isInterrupted()) return null;
    Long retryAfterMs = null;
    if (failure instanceof HttpFailure) {
      HttpFailure http = (HttpFailure) failure;
      if (
        !(http.status == 408 ||
          http.status == 425 ||
          http.status == 429 ||
          http.status == 500 ||
          http.status == 502 ||
          http.status == 503 ||
          http.status == 504)
      ) return null;
      retryAfterMs = retryAfterMilliseconds(http.retryAfter, now.getAsLong());
      // Do not sleep indefinitely or retry earlier than a long server-requested delay.
      if (retryAfterMs != null && retryAfterMs > 30_000) return null;
    } else if (!(failure instanceof NetworkFailure)) {
      return null;
    }
    long backoff = (long) (1000L * (1L << (attempt - 1)) * (0.5 + random.getAsDouble()));
    return retryAfterMs == null ? backoff : Math.max(backoff, retryAfterMs);
  }

  static Long retryAfterMilliseconds(String value, long now) {
    if (value == null) return null;
    String trimmed = value.trim();
    if (trimmed.matches("[0-9]+")) {
      try {
        return Math.multiplyExact(Long.parseLong(trimmed), 1000L);
      } catch (ArithmeticException | NumberFormatException error) {
        return Long.MAX_VALUE;
      }
    }
    SimpleDateFormat format = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
    format.setTimeZone(TimeZone.getTimeZone("GMT"));
    format.setLenient(false);
    ParsePosition position = new ParsePosition(0);
    Date date = format.parse(trimmed, position);
    return date != null && position.getIndex() == trimmed.length()
      ? Math.max(0, date.getTime() - now)
      : null;
  }

  static <T> T network(Callable<T> operation) throws Exception {
    try {
      return operation.call();
    } catch (SSLHandshakeException | SSLPeerUnverifiedException failure) {
      throw failure;
    } catch (IOException failure) {
      throw new NetworkFailure(failure);
    }
  }
}
