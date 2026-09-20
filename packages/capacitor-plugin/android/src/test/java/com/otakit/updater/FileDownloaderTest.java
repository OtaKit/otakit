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
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class FileDownloaderTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  @Test
  public void failedReadDeletesPartialFileAndClosesResources() throws Exception {
    File cache = temporaryFolder.newFolder();
    TestConnection connection = new TestConnection();
    connection.stream = new InputStream() {
      int remaining = 100;

      @Override
      public int read() throws IOException {
        if (remaining-- > 0) return 1;
        throw new IOException("connection reset");
      }

      @Override
      public void close() {
        connection.inputClosed = true;
      }
    };
    assertThrows(IOException.class, () ->
      FileDownloader.download(
        connection.testUrl(),
        cache,
        false,
        new DownloadRetry(delay -> {}, () -> 0.5, () -> 0L)
      )
    );
    assertEquals(0, cache.list().length);
    assertTrue(connection.inputClosed);
    assertTrue(connection.disconnected);
  }

  @Test
  public void inputOpenFailureDeletesAllocatedFile() throws Exception {
    File cache = temporaryFolder.newFolder();
    TestConnection connection = new TestConnection();
    connection.failOpen = true;
    assertThrows(IOException.class, () ->
      FileDownloader.download(
        connection.testUrl(),
        cache,
        false,
        new DownloadRetry(delay -> {}, () -> 0.5, () -> 0L)
      )
    );
    assertEquals(0, cache.list().length);
    assertTrue(connection.disconnected);
  }

  @Test
  public void successTransfersFileOwnershipToCaller() throws Exception {
    File cache = temporaryFolder.newFolder();
    TestConnection connection = new TestConnection();
    connection.stream = new ByteArrayInputStream(new byte[] { 1, 2, 3 });
    File result = FileDownloader.download(
      connection.testUrl(),
      cache,
      false,
      new DownloadRetry(delay -> {}, () -> 0.5, () -> 0L)
    );
    assertArrayEquals(new byte[] { 1, 2, 3 }, Files.readAllBytes(result.toPath()));
    assertEquals(1, cache.list().length);
    assertTrue(connection.disconnected);
  }

  @Test
  public void httpFailureDoesNotAllocateAFile() throws Exception {
    File cache = temporaryFolder.newFolder();
    TestConnection connection = new TestConnection();
    connection.status = 403;
    assertThrows(DownloadRetry.HttpFailure.class, () ->
      FileDownloader.download(
        connection.testUrl(),
        cache,
        false,
        new DownloadRetry(delay -> {}, () -> 0.5, () -> 0L)
      )
    );
    assertEquals(0, cache.list().length);
    assertTrue(connection.disconnected);
  }

  private static final class TestConnection extends HttpURLConnection {

    InputStream stream;
    int status = 200;
    boolean failOpen;
    boolean inputClosed;
    boolean disconnected;

    TestConnection() throws Exception {
      super(new URL("https://example.test/bundle.zip"));
    }

    URL testUrl() throws Exception {
      return new URL(
        null,
        url.toString(),
        new URLStreamHandler() {
          @Override
          protected URLConnection openConnection(URL ignored) {
            return TestConnection.this;
          }
        }
      );
    }

    @Override
    public InputStream getInputStream() throws IOException {
      if (failOpen) throw new IOException("connection closed before body");
      return stream;
    }

    @Override
    public int getResponseCode() {
      return status;
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
