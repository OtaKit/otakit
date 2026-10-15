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
}
