package com.otakit.updater;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ExperimentsTest {

  private static final String SECRET = "0123456789abcdef0123456789abcdef";
  private static final String FIRST = "0b1d2c3e-0000-4000-8000-00000000000a";
  private static final String SECOND = "0b1d2c3e-0000-4000-8000-00000000000b";

  @Test
  public void bucketsMatchTheSharedVectors() {
    // Same vectors as the TypeScript and Swift tests: SHA-256("secret:exp:<id>:<use>").
    assertArrayEquals(new int[] { 14, 34 }, Experiments.buckets(SECRET, FIRST));
    assertArrayEquals(new int[] { 84, 13 }, Experiments.buckets(SECRET, SECOND));
  }

  @Test
  public void validatesIdsAndReports() {
    assertTrue(Experiments.isExperimentId(FIRST));
    assertFalse(Experiments.isExperimentId(FIRST.toUpperCase()));
    assertFalse(Experiments.isExperimentId(null));
    for (String report : Arrays.asList(
      "exposure",
      "error",
      "conversion:purchase_completed",
      "conversion:a.b:c-d"
    )) {
      assertTrue(report, Experiments.isReport(report));
    }
    StringBuilder longGoal = new StringBuilder("conversion:");
    for (int i = 0; i < 65; i++) longGoal.append('x');
    for (String report : Arrays.asList(
      "",
      "exposed",
      "conversion:",
      "conversion:..",
      "conversion:has space",
      longGoal.toString()
    )) {
      assertFalse(report, Experiments.isReport(report));
    }
  }

  private static Experiments.Reports reports() {
    SharedPreferences prefs = RuntimeEnvironment.getApplication().getSharedPreferences(
      "otakit_experiments_test_" + System.nanoTime(),
      Context.MODE_PRIVATE
    );
    return new Experiments.Reports(prefs);
  }

  @Test
  public void recordsEachReportOnceAndOnlyAfterItWasStored() {
    Experiments.Reports reports = reports();
    AtomicInteger stored = new AtomicInteger();
    Experiments.Reports.Store store = () -> {
      stored.incrementAndGet();
      return true;
    };
    // A conversion before the exposure is not made; a failed store records nothing.
    assertFalse(reports.record(FIRST, "conversion:buy", "exposure", 1, store));
    assertFalse(reports.record(FIRST, "exposure", null, 1, () -> false));
    assertEquals(0, stored.get());
    assertTrue(reports.record(FIRST, "exposure", null, 1, store));
    assertFalse(reports.record(FIRST, "exposure", null, 2, store));
    assertTrue(reports.record(FIRST, "conversion:buy", "exposure", 3, store));
    assertTrue(reports.record(FIRST, "error", "exposure", 4, store));
    assertEquals(3, stored.get());
    Map<String, List<String>> reported = reports.reported(Arrays.asList(FIRST, SECOND));
    assertEquals(1, reported.size());
    assertEquals(Arrays.asList("exposure", "conversion:buy", "error"), reported.get(FIRST));
  }

  @Test
  public void keepsTheNewest50Experiments() {
    Experiments.Reports reports = reports();
    List<String> ids = new ArrayList<>();
    for (int i = 0; i < 55; i++) {
      String id = String.format("0b1d2c3e-0000-4000-8000-%012d", i);
      ids.add(id);
      assertTrue(reports.record(id, "exposure", null, i, () -> true));
    }
    Map<String, List<String>> kept = reports.reported(ids);
    assertEquals(Experiments.LIMIT, kept.size());
    assertNull(kept.get(ids.get(4)));
    assertNotNull(kept.get(ids.get(5)));
  }

  @Test
  public void reportsGoToTheirOwnLaneKeptOverEvents() throws Exception {
    assertTrue(
      AppTelemetryClient.Lane.REPORT.priority() > AppTelemetryClient.Lane.ERROR.priority()
    );
    assertTrue(AppTelemetryClient.Lane.ERROR.priority() > AppTelemetryClient.Lane.EVENT.priority());
    org.json.JSONObject context = new org.json.JSONObject().put("platform", "android");
    assertNotEquals(
      AppTelemetryClient.mergeKey(AppTelemetryClient.Lane.REPORT, context),
      AppTelemetryClient.mergeKey(AppTelemetryClient.Lane.EVENT, context)
    );
  }
}
