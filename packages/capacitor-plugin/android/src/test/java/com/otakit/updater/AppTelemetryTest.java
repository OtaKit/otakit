package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AppTelemetryTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private static JSONObject item(int index, int stack) throws Exception {
    StringBuilder text = new StringBuilder();
    for (int i = 0; i < stack; i++) text.append('s');
    return new JSONObject()
      .put("kind", "error")
      .put("eventId", java.util.UUID.randomUUID().toString())
      .put("name", "TypeError")
      .put("message", "boom " + index)
      .put("stack", text.toString())
      .put("handled", false);
  }

  private static JSONObject context() throws Exception {
    return new JSONObject()
      .put("platform", "android")
      .put("sessionId", "9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f")
      .put("bundleVersion", "1.0.0")
      .put("nativeBuild", "42")
      .put("osVersion", "15")
      .put("sdkVersion", "3.4.0");
  }

  @Test
  public void wrapsItemsInBatchesWithTheDeviceContext() throws Exception {
    AtomicInteger ids = new AtomicInteger();
    JSONArray items = new JSONArray().put(item(1, 100)).put(item(2, 100));
    AppTelemetryClient.Batches result = AppTelemetryClient.batches(
      items,
      context(),
      1_760_000_000_000L,
      () -> "batch-" + ids.incrementAndGet()
    );
    assertEquals(java.util.Arrays.asList(2), result.itemCounts);
    assertEquals(0, result.dropped);
    JSONObject batch = new JSONObject(result.bodies.get(0));
    assertEquals("batch-1", batch.getString("batchId"));
    assertEquals("2025-10-09T08:53:20.000Z", batch.getString("sentAt"));
    assertEquals("android", batch.getJSONObject("context").getString("platform"));
    assertEquals("boom 2", batch.getJSONArray("items").getJSONObject(1).getString("message"));
    assertFalse(batch.getJSONArray("items").getJSONObject(0).getBoolean("handled"));
  }

  @Test
  public void splitsByCountAndSizeAndDropsInvalidItems() throws Exception {
    JSONArray many = new JSONArray();
    for (int i = 0; i < 120; i++) many.put(item(i, 100));
    assertEquals(
      java.util.Arrays.asList(50, 50, 20),
      AppTelemetryClient.batches(many, context(), 0, () -> "b").itemCounts
    );

    JSONArray large = new JSONArray();
    for (int i = 0; i < 10; i++) large.put(item(i, 15_000));
    AppTelemetryClient.Batches sized = AppTelemetryClient.batches(large, context(), 0, () -> "b");
    int total = 0;
    for (int count : sized.itemCounts) total += count;
    assertEquals(10, total);
    assertTrue(sized.itemCounts.size() >= 3);
    for (String body : sized.bodies) assertTrue(body.getBytes("UTF-8").length <= 64 * 1024);

    JSONArray invalid = new JSONArray()
      .put("text")
      .put(new JSONObject().put("name", "no kind"))
      .put(new JSONObject().put("kind", 1))
      .put(item(1, 17_000))
      .put(item(2, 10));
    AppTelemetryClient.Batches filtered = AppTelemetryClient.batches(invalid, context(), 0, () ->
      "b"
    );
    assertEquals(java.util.Arrays.asList(1), filtered.itemCounts);
    assertEquals(4, filtered.dropped);
  }

  @Test
  public void telemetryOutboxIsSeparateAndBounded() throws Exception {
    File directory = temporaryFolder.newFolder();
    EventOutbox telemetry = new EventOutbox(directory, EventOutbox.Limits.APP_TELEMETRY);
    EventOutbox events = new EventOutbox(directory);
    String url = "https://ingest.example/v1/app-telemetry";
    for (int i = 0; i <= EventOutbox.Limits.APP_TELEMETRY.count; i++) {
      telemetry.enqueue(
        url,
        "app-a",
        new JSONObject().put("batchId", "batch-" + i).put("items", new JSONArray()).toString(),
        0
      );
    }
    events.enqueue(
      url,
      "app-a",
      new JSONObject().put("eventId", "event-1").put("action", "applied").toString(),
      0
    );

    EventOutbox reopened = new EventOutbox(directory, EventOutbox.Limits.APP_TELEMETRY);
    assertEquals("batch-1", reopened.ready(0).id);
    assertEquals("event-1", new EventOutbox(directory).ready(0).id);
    assertNull(reopened.ready(EventOutbox.Limits.APP_TELEMETRY.ttl));

    StringBuilder tooLarge = new StringBuilder("{\"batchId\":\"x\",\"pad\":\"");
    while (tooLarge.length() <= 64 * 1024) tooLarge.append('x');
    tooLarge.append("\"}");
    try {
      telemetry.enqueue(url, "app-a", tooLarge.toString(), 0);
      fail("An entry over 64 KiB must be rejected");
    } catch (java.io.IOException expected) {
      // expected
    }
  }

  private static JSONObject event(int index) throws Exception {
    return new JSONObject()
      .put("kind", "event")
      .put("eventId", java.util.UUID.randomUUID().toString())
      .put("name", "tap_" + index)
      .put("properties", new JSONObject());
  }

  @Test
  public void errorsAndEventsGoInSeparateBatches() throws Exception {
    JSONArray items = new JSONArray().put(item(1, 10)).put(event(1)).put(event(2)).put(item(2, 10));
    AppTelemetryClient.Batches result = AppTelemetryClient.batches(items, context(), 0, () -> "b");
    assertEquals(java.util.Arrays.asList(1, 2, 1), result.itemCounts);
    assertEquals(
      java.util.Arrays.asList(
        AppTelemetryClient.Lane.ERROR,
        AppTelemetryClient.Lane.EVENT,
        AppTelemetryClient.Lane.ERROR
      ),
      result.lanes
    );
  }

  private static final String URL = "https://ingest.example/v1/app-telemetry";

  private static void add(EventOutbox outbox, JSONArray items, JSONObject context, long now)
    throws Exception {
    AppTelemetryClient.Batches batches = AppTelemetryClient.batches(items, context, now, () ->
      java.util.UUID.randomUUID().toString()
    );
    for (int i = 0; i < batches.bodies.size(); i++) {
      AppTelemetryClient.Lane lane = batches.lanes.get(i);
      outbox.enqueue(
        URL,
        "app-a",
        batches.bodies.get(i),
        now,
        lane.priority(),
        AppTelemetryClient.mergeKey(lane, context),
        AppTelemetryClient::mergeBatches
      );
    }
  }

  private static java.util.List<String> names(EventOutbox.Entry entry) throws Exception {
    JSONArray items = new JSONObject(entry.body).getJSONArray("items");
    java.util.List<String> result = new java.util.ArrayList<>();
    for (int i = 0; i < items.length(); i++) result.add(items.getJSONObject(i).getString("name"));
    return result;
  }

  @Test
  public void pendingBatchesTakeInItemsOfTheSameKindAndContext() throws Exception {
    File directory = temporaryFolder.newFolder();
    EventOutbox outbox = new EventOutbox(directory, EventOutbox.Limits.APP_TELEMETRY);
    JSONObject context = context();
    add(outbox, new JSONArray().put(event(1)), context, 0);
    add(outbox, new JSONArray().put(event(2)).put(event(3)), context, 10_000);
    EventOutbox.Entry first = outbox.ready(10_000);
    assertEquals(java.util.Arrays.asList("tap_1", "tap_2", "tap_3"), names(first));
    // The batch being delivered keeps its body; new items start a new batch.
    add(outbox, new JSONArray().put(event(4)), context, 11_000);
    outbox.complete(first.id, 202, null, 12_000, 0.5);
    EventOutbox.Entry second = outbox.ready(12_000);
    assertEquals(java.util.Arrays.asList("tap_4"), names(second));
    outbox.complete(second.id, 500, null, 12_000, 0.5);
    // A batch waiting for a retry takes in new items; errors and other contexts do not join it.
    add(outbox, new JSONArray().put(event(5)), context, 13_000);
    add(outbox, new JSONArray().put(item(1, 10)), context, 14_000);
    JSONObject other = context().put("sessionId", "another-launch");
    add(outbox, new JSONArray().put(event(6)), other, 15_000);
    // Over an hour later, or over 50 items, a new batch starts.
    add(outbox, new JSONArray().put(event(7)), other, 15_000 + EventOutbox.MERGE_WINDOW);
    JSONArray fifty = new JSONArray();
    for (int i = 0; i < 50; i++) fifty.put(event(100 + i));
    add(outbox, fifty, other, 16_000 + EventOutbox.MERGE_WINDOW);

    EventOutbox reopened = new EventOutbox(directory, EventOutbox.Limits.APP_TELEMETRY);
    java.util.List<java.util.List<String>> batches = new java.util.ArrayList<>();
    long now = 10_000_000;
    for (EventOutbox.Entry entry; (entry = reopened.ready(now)) != null; now += 1000) {
      batches.add(names(entry));
      reopened.complete(entry.id, 202, null, now, 0.5);
    }
    assertEquals(5, batches.size());
    assertEquals(java.util.Arrays.asList("tap_4", "tap_5"), batches.get(0));
    assertEquals(java.util.Arrays.asList("TypeError"), batches.get(1));
    assertEquals(java.util.Arrays.asList("tap_6"), batches.get(2));
    assertEquals(java.util.Arrays.asList("tap_7"), batches.get(3));
    assertEquals(50, batches.get(4).size());
  }

  private static String batch(String id) throws Exception {
    return new JSONObject().put("batchId", id).put("items", new JSONArray()).toString();
  }

  @Test
  public void fullOutboxEvictsEventsBeforeErrors() throws Exception {
    EventOutbox outbox = new EventOutbox(
      temporaryFolder.newFolder(),
      EventOutbox.Limits.APP_TELEMETRY
    );
    int count = EventOutbox.Limits.APP_TELEMETRY.count;
    outbox.enqueue(URL, "app-a", batch("error-0"), 0, 1, null, null);
    for (int i = 1; i < count; i++) outbox.enqueue(
      URL,
      "app-a",
      batch("event-" + i),
      0,
      0,
      null,
      null
    );
    // Full: a new error evicts the oldest event, not the older error.
    outbox.enqueue(URL, "app-a", batch("error-1"), 0, 1, null, null);
    assertEquals("error-0", outbox.ready(0).id);
    outbox.complete("error-0", 202, null, 0, 0.5);
    assertEquals("event-2", outbox.ready(0).id);

    // Full of errors: events are refused, errors still replace the oldest error.
    EventOutbox errors = new EventOutbox(
      temporaryFolder.newFolder(),
      EventOutbox.Limits.APP_TELEMETRY
    );
    for (int i = 0; i < count; i++) errors.enqueue(URL, "app-a", batch("e-" + i), 0, 1, null, null);
    try {
      errors.enqueue(URL, "app-a", batch("late-event"), 0, 0, null, null);
      fail("An event must not evict an error");
    } catch (java.io.IOException expected) {
      // expected
    }
    errors.enqueue(URL, "app-a", batch("e-new"), 0, 1, null, null);
    assertEquals("e-1", errors.ready(0).id);
  }
}
