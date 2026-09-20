package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = { 28, 34 }, manifest = Config.NONE)
public class EventOutboxTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private String body(String id) throws Exception {
    return new JSONObject()
      .put("eventId", id)
      .put("sentAt", "2026-09-20T12:00:00Z")
      .put("action", "applied")
      .toString();
  }

  private void enqueue(EventOutbox queue, String id, long now) throws Exception {
    queue.enqueue("https://ingest.example/events", "app-a", body(id), now);
  }

  @Test
  public void restartAndLostResponsePreserveOriginalIdentityAndBody() throws Exception {
    File directory = temporaryFolder.newFolder();
    EventOutbox queue = new EventOutbox(directory);
    enqueue(queue, "original-id", 1000);
    queue.complete("original-id", 0, null, 1000, 0.5);
    EventOutbox reopened = new EventOutbox(directory);
    assertNull(reopened.ready(5999));
    EventOutbox.Entry retry = reopened.ready(6000);
    assertEquals("original-id", retry.id);
    assertEquals(body("original-id"), retry.body);
    assertEquals("app-a", retry.appId);
    assertEquals(1, retry.attempts);
    reopened.complete(retry.id, 202, null, 6000, 0.5);
    assertNull(new EventOutbox(directory).ready(6000));
  }

  @Test
  public void rateLimitSurvivesRestartAndDoesNotBlockOtherEvents() throws Exception {
    File directory = temporaryFolder.newFolder();
    EventOutbox queue = new EventOutbox(directory);
    enqueue(queue, "limited", 1000);
    queue.complete("limited", 429, "120", 1000, 0.5);
    enqueue(queue, "other", 2000);
    queue = new EventOutbox(directory);
    assertEquals("other", queue.ready(2000).id);
    queue.complete("other", 200, null, 2000, 0.5);
    assertNull(queue.ready(120999));
    assertEquals("limited", queue.ready(121000).id);
  }

  @Test
  public void permanentRejectionIsDroppedAndServerFailuresRetry() throws Exception {
    EventOutbox queue = new EventOutbox(temporaryFolder.newFolder());
    enqueue(queue, "invalid", 0);
    queue.complete("invalid", 400, null, 0, 0.5);
    assertNull(queue.waitMilliseconds(0));
    for (int status : new int[] { 408, 425, 429, 500, 502, 503, 504 }) {
      enqueue(queue, "retry-" + status, 0);
      queue.complete("retry-" + status, status, null, 0, 0.5);
    }
    assertNull(queue.ready(4999));
    assertNotNull(queue.ready(5000));
  }

  @Test
  public void queueIsBoundedAndExpiresWithoutRetryingLongServerDelayEarly() throws Exception {
    EventOutbox queue = new EventOutbox(temporaryFolder.newFolder());
    for (int i = 0; i <= EventOutbox.LIMIT; i++) enqueue(queue, "event-" + i, 0);
    assertEquals("event-1", queue.ready(0).id);
    queue.complete("event-1", 429, "999999999999999999999999", 0, 0.5);
    assertEquals("event-2", queue.ready(0).id);
    assertNull(queue.ready(EventOutbox.TTL));
    assertNull(queue.waitMilliseconds(EventOutbox.TTL));
  }

  @Test
  public void failedSaveKeepsUnacknowledgedEventInMemoryAndOnDisk() throws Exception {
    File directory = temporaryFolder.newFolder();
    EventOutbox queue = new EventOutbox(directory);
    enqueue(queue, "keep", 0);
    File saved = new File(directory, "events.json");
    byte[] original = Files.readAllBytes(saved.toPath());
    File backup = new File(directory.getParentFile(), directory.getName() + "-backup");
    assertTrue(directory.renameTo(backup));
    Files.write(directory.toPath(), new byte[] { 1 });
    assertThrows(Exception.class, () -> queue.complete("keep", 200, null, 0, 0.5));
    assertEquals("keep", queue.ready(0).id);
    assertTrue(directory.delete());
    assertTrue(backup.renameTo(directory));
    assertArrayEquals(original, Files.readAllBytes(saved.toPath()));
    assertEquals("keep", new EventOutbox(directory).ready(0).id);
  }

  @Test
  public void corruptJsonDoesNotPermanentlyDisableDelivery() throws Exception {
    File directory = temporaryFolder.newFolder();
    Files.write(new File(directory, "events.json").toPath(), new byte[] { '{' });
    EventOutbox queue = new EventOutbox(directory);
    enqueue(queue, "new", 0);
    assertEquals("new", new EventOutbox(directory).ready(0).id);
  }
}
