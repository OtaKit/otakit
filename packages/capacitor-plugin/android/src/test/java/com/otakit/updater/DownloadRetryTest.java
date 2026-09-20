package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.net.ssl.SSLHandshakeException;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class DownloadRetryTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  @Test
  public void transientFailuresRetryFreshFilesWithoutAppendingPartialBytes() throws Exception {
    Server server = new Server(
      temporaryFolder.newFolder(),
      new Reply(503, null),
      Reply.interrupted(),
      Reply.success()
    );
    File result = server.download();
    assertArrayEquals(new byte[] { 1, 2, 3 }, Files.readAllBytes(result.toPath()));
    assertEquals(3, server.opened);
    assertEquals(Arrays.asList(1000L, 2000L), server.delays);
    assertEquals(1, server.cache.list().length);
    for (Reply reply : server.replies) assertTrue(reply.disconnected);
  }

  @Test
  public void retryAfterIsHonoredAndLongDelaysDoNotRetryEarly() throws Exception {
    Server limited = new Server(temporaryFolder.newFolder(), new Reply(429, "12"), Reply.success());
    limited.download();
    assertEquals(Arrays.asList(12000L), limited.delays);
    Server longDelay = new Server(temporaryFolder.newFolder(), new Reply(503, "120"));
    assertThrows(DownloadRetry.HttpFailure.class, longDelay::download);
    assertEquals(1, longDelay.opened);
    assertTrue(longDelay.delays.isEmpty());
  }

  @Test
  public void permanentHttpAndCertificateFailuresAreNotRetried() throws Exception {
    for (int status : new int[] { 400, 401, 403, 404, 410 }) {
      Server server = new Server(temporaryFolder.newFolder(), new Reply(status, null));
      assertThrows(DownloadRetry.HttpFailure.class, server::download);
      assertEquals(1, server.opened);
      assertTrue(server.delays.isEmpty());
    }
    Reply badCertificate = Reply.success();
    badCertificate.responseFailure = new SSLHandshakeException("untrusted certificate");
    Server server = new Server(temporaryFolder.newFolder(), badCertificate);
    assertThrows(SSLHandshakeException.class, server::download);
    assertEquals(1, server.opened);
    assertTrue(server.delays.isEmpty());
  }

  @Test
  public void retryExhaustionDeletesEveryPartialFile() throws Exception {
    Server server = new Server(
      temporaryFolder.newFolder(),
      Reply.interrupted(),
      Reply.interrupted(),
      Reply.interrupted()
    );
    assertThrows(DownloadRetry.NetworkFailure.class, server::download);
    assertEquals(3, server.opened);
    assertEquals(2, server.delays.size());
    assertEquals(0, server.cache.list().length);
  }

  @Test
  public void localDiskFailureIsNotRetried() throws Exception {
    Server server = new Server(temporaryFolder.newFile(), Reply.success());
    assertThrows(IOException.class, server::download);
    assertEquals(1, server.opened);
    assertTrue(server.delays.isEmpty());
  }

  @Test
  public void retryAfterDateAndOverflowAreHandled() {
    assertEquals(
      Long.valueOf(12_000),
      DownloadRetry.retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:12 GMT", 0)
    );
    assertEquals(
      Long.valueOf(0),
      DownloadRetry.retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:12 GMT", 20_000)
    );
    assertEquals(
      Long.valueOf(Long.MAX_VALUE),
      DownloadRetry.retryAfterMilliseconds("99999999999999999999999999", 0)
    );
    assertNull(DownloadRetry.retryAfterMilliseconds("invalid", 0));
    assertNull(DownloadRetry.retryAfterMilliseconds("-1", 0));
  }

  @Test
  public void interruptedBackoffCancelsWithoutAnotherAttempt() throws Exception {
    int[] attempts = { 0 };
    DownloadRetry retry = new DownloadRetry(
      delay -> {
        throw new InterruptedException("owner cancelled");
      },
      () -> 0.5,
      () -> 0L
    );
    try {
      assertThrows(java.util.concurrent.CancellationException.class, () ->
        retry.run(() -> {
          attempts[0]++;
          throw new DownloadRetry.HttpFailure(503, null);
        })
      );
      assertEquals(1, attempts[0]);
      assertTrue(Thread.currentThread().isInterrupted());
    } finally {
      Thread.interrupted();
    }
  }

  @Test
  public void integrityErrorsAndCancellationDoNotRetry() throws Exception {
    List<Long> delays = new ArrayList<>();
    DownloadRetry retry = new DownloadRetry(delays::add, () -> 0.5, () -> 0L);
    assertThrows(IllegalStateException.class, () ->
      retry.run(() -> {
        throw new IllegalStateException("hash mismatch");
      })
    );
    assertThrows(java.util.concurrent.CancellationException.class, () ->
      retry.run(() -> {
        throw new java.util.concurrent.CancellationException();
      })
    );
    assertTrue(delays.isEmpty());
  }

  private static final class Server {

    final File cache;
    final List<Reply> replies;
    final List<Long> delays = new ArrayList<>();
    int opened;

    Server(File cache, Reply... replies) {
      this.cache = cache;
      this.replies = Arrays.asList(replies);
    }

    File download() throws Exception {
      URL url = new URL(
        null,
        "https://example.test/object",
        new URLStreamHandler() {
          @Override
          protected URLConnection openConnection(URL ignored) throws IOException {
            if (cache.isDirectory()) assertEquals(
              "Previous attempt leaked a file",
              0,
              cache.list().length
            );
            if (opened >= replies.size()) throw new AssertionError("Too many attempts");
            return replies.get(opened++);
          }
        }
      );
      return FileDownloader.download(
        url,
        cache,
        false,
        new DownloadRetry(delays::add, () -> 0.5, () -> 0L)
      );
    }
  }

  private static final class Reply extends HttpURLConnection {

    final int status;
    final String retryAfter;
    InputStream stream = new ByteArrayInputStream(new byte[] { 1, 2, 3 });
    IOException responseFailure;
    boolean disconnected;

    Reply(int status, String retryAfter) throws Exception {
      super(new URL("https://example.test/object"));
      this.status = status;
      this.retryAfter = retryAfter;
    }

    static Reply success() throws Exception {
      return new Reply(200, null);
    }

    static Reply interrupted() throws Exception {
      Reply reply = success();
      reply.stream = new InputStream() {
        int remaining = 100;

        @Override
        public int read() throws IOException {
          if (remaining-- > 0) return 9;
          throw new IOException("connection reset mid-body");
        }
      };
      return reply;
    }

    @Override
    public int getResponseCode() throws IOException {
      if (responseFailure != null) throw responseFailure;
      return status;
    }

    @Override
    public String getHeaderField(String name) {
      return "Retry-After".equals(name) ? retryAfter : null;
    }

    @Override
    public InputStream getInputStream() {
      return stream;
    }

    @Override
    public void disconnect() {
      disconnected = true;
    }

    @Override
    public boolean usingProxy() {
      return false;
    }

    @Override
    public void connect() {}
  }
}
