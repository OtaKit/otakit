package com.otakit.updater;

import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * A/B tests (plugin 3.4+). The JavaScript side reads the experiments from the signed config and
 * picks variants; native supplies what must stay on the device: buckets from the assignment secret
 * (never sent or exposed), and a record of the reports the device made, so each is made at most
 * once.
 */
final class Experiments {

  static final int MAX_EXPERIMENTS = 20;
  /** Reports are kept for the newest 50 experiments. */
  static final int LIMIT = 50;
  static final String PREFS_KEY = "otakit_experiment_reports";

  private static final Pattern ID = Pattern.compile(
    "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
  );
  private static final Pattern GOAL = Pattern.compile("^[A-Za-z0-9_.:-]{1,64}$");
  private static final Pattern LETTER_OR_DIGIT = Pattern.compile("[A-Za-z0-9]");

  private Experiments() {}

  /**
   * Buckets 1-100 for an experiment's traffic and variant, independent of each other and of
   * rollouts (same function, other keys).
   */
  static int[] buckets(String secret, String experimentId) {
    return new int[] {
      Rollout.bucket(secret, "exp:" + experimentId + ":traffic"),
      Rollout.bucket(secret, "exp:" + experimentId + ":variant"),
    };
  }

  static boolean isExperimentId(String value) {
    return value != null && ID.matcher(value).matches();
  }

  /** exposure, error, or conversion:goal_event_name. */
  static boolean isReport(String value) {
    if (value == null) return false;
    if (value.equals("exposure") || value.equals("error")) return true;
    if (!value.startsWith("conversion:")) return false;
    String goal = value.substring("conversion:".length());
    return GOAL.matcher(goal).matches() && LETTER_OR_DIGIT.matcher(goal).find();
  }

  /** The reports this device made per experiment, in SharedPreferences. */
  static final class Reports {

    interface Store {
      boolean store() throws Exception;
    }

    /**
     * Shared by every plugin instance in the process (more than one bridge), so a report is never
     * made twice.
     */
    private static final Object LOCK = new Object();

    private final SharedPreferences prefs;

    Reports(SharedPreferences prefs) {
      this.prefs = prefs;
    }

    Map<String, List<String>> reported(List<String> experimentIds) {
      synchronized (LOCK) {
        return reportedLocked(experimentIds);
      }
    }

    private Map<String, List<String>> reportedLocked(List<String> experimentIds) {
      JSONObject records = load();
      Map<String, List<String>> result = new HashMap<>();
      for (String id : experimentIds) {
        JSONObject record = records.optJSONObject(id);
        if (record == null) continue;
        JSONArray reports = record.optJSONArray("reports");
        List<String> list = new ArrayList<>();
        for (int i = 0; reports != null && i < reports.length(); i++) list.add(
          reports.optString(i)
        );
        result.put(id, list);
      }
      return result;
    }

    /**
     * Runs store and records the report, unless the device already made it or has not made
     * requires. True when the report was stored now.
     */
    boolean record(String experimentId, String report, String requires, long now, Store store) {
      synchronized (LOCK) {
        return recordLocked(experimentId, report, requires, now, store);
      }
    }

    private boolean recordLocked(
      String experimentId,
      String report,
      String requires,
      long now,
      Store store
    ) {
      try {
        JSONObject records = load();
        JSONObject existing = records.optJSONObject(experimentId);
        JSONArray reports = existing != null ? existing.optJSONArray("reports") : null;
        if (contains(reports, report)) return false;
        if (requires != null && !contains(reports, requires)) return false;
        if (!store.store()) return false;
        JSONObject record =
          existing != null
            ? existing
            : new JSONObject().put("reports", new JSONArray()).put("firstAt", now);
        record.getJSONArray("reports").put(report);
        records.put(experimentId, record);
        prune(records);
        prefs.edit().putString(PREFS_KEY, records.toString()).commit();
        return true;
      } catch (Exception error) {
        return false;
      }
    }

    private static boolean contains(JSONArray list, String value) {
      for (int i = 0; list != null && i < list.length(); i++) {
        if (value.equals(list.optString(i))) return true;
      }
      return false;
    }

    private static void prune(JSONObject records) {
      while (records.length() > LIMIT) {
        String oldest = null;
        long oldestAt = Long.MAX_VALUE;
        for (Iterator<String> keys = records.keys(); keys.hasNext(); ) {
          String key = keys.next();
          JSONObject record = records.optJSONObject(key);
          long at = record != null ? record.optLong("firstAt", 0) : 0;
          if (at < oldestAt) {
            oldestAt = at;
            oldest = key;
          }
        }
        if (oldest == null) return;
        records.remove(oldest);
      }
    }

    private JSONObject load() {
      try {
        String stored = prefs.getString(PREFS_KEY, null);
        return stored == null ? new JSONObject() : new JSONObject(stored);
      } catch (Exception error) {
        return new JSONObject();
      }
    }
  }
}
