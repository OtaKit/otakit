package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class EventDeliveryTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  @Test
  public void realHttpRetryPreservesBodyAndDeletesOnlyAfterAcceptance() throws Exception {
    File directory = temporaryFolder.newFolder();
    ServerSocket server = new ServerSocket(0, 2, InetAddress.getByName("127.0.0.1"));
    List<String> bodies = new CopyOnWriteArrayList<>();
    List<String> appIds = new CopyOnWriteArrayList<>();
    CountDownLatch accepted = new CountDownLatch(1);
    java.util.concurrent.atomic.AtomicReference<Throwable> serverFailure =
      new java.util.concurrent.atomic.AtomicReference<>();
    Thread serving = new Thread(() -> {
      try {
        for (int attempt = 0; attempt < 2; attempt++) {
          try (java.net.Socket socket = server.accept()) {
            socket.setSoTimeout(10_000);
            java.io.InputStream input = socket.getInputStream();
            StringBuilder header = new StringBuilder();
            while (!header.toString().endsWith("\r\n\r\n")) {
              int value = input.read();
              if (value < 0 || header.length() > 16384) throw new java.io.IOException(
                "Invalid test request"
              );
              header.append((char) value);
            }
            int length = 0;
            for (String line : header.toString().split("\r\n")) {
              if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) length =
                Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
              if (line.toLowerCase(java.util.Locale.ROOT).startsWith("x-app-id:")) appIds.add(
                line.substring(line.indexOf(':') + 1).trim()
              );
            }
            byte[] body = new byte[length];
            new java.io.DataInputStream(input).readFully(body);
            bodies.add(new String(body, StandardCharsets.UTF_8));
            socket
              .getOutputStream()
              .write(
                (
                  "HTTP/1.1 " +
                  (attempt == 0 ? "503 Unavailable" : "202 Accepted") +
                  "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                ).getBytes(StandardCharsets.US_ASCII)
              );
          }
        }
      } catch (Throwable error) {
        serverFailure.set(error);
      } finally {
        accepted.countDown();
      }
    });
    serving.setDaemon(true);
    serving.start();
    try {
      DeviceEventClient.resume(directory);
      DeviceEventClient.send(
        "http://127.0.0.1:" + server.getLocalPort(),
        "app-a",
        "android",
        "applied",
        "1.0",
        null,
        null,
        "release-a",
        "1",
        null
      );
      assertTrue("Retry was not delivered", accepted.await(15, TimeUnit.SECONDS));
      assertNull(serverFailure.get());
      assertEquals(2, bodies.size());
      assertEquals(bodies.get(0), bodies.get(1));
      assertEquals(java.util.Arrays.asList("app-a", "app-a"), appIds);
      long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
      while (
        new EventOutbox(directory).waitMilliseconds(System.currentTimeMillis()) != null &&
        System.nanoTime() < deadline
      ) Thread.sleep(20);
      assertNull(new EventOutbox(directory).waitMilliseconds(System.currentTimeMillis()));
    } finally {
      server.close();
    }
  }
}
