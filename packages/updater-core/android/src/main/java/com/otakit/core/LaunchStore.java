package com.otakit.core;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Application-lifetime serialized launch state. RN module bindings retain one generation. */
public final class LaunchStore {

  private final File file;
  private final JSONObject builtin;
  private final DirectorySync directorySync;

  public interface DirectorySync {
    void sync(File directory) throws Exception;
  }

  public interface ArtifactVerifier {
    boolean verify(JSONObject artifact) throws Exception;
  }

  private JSONObject state;
  private boolean foreground, guard, began, storageFailed;
  private boolean backgroundWorkObserved;
  private long bootstrap = -1,
    host = -1;
  private long elapsedMillis,
    foregroundSince = -1;

  public LaunchStore(File file, String buildId, JSONObject builtin) throws Exception {
    this(
      file,
      buildId,
      builtin,
      directory -> {
        try (FileChannel channel = FileChannel.open(directory.toPath(), StandardOpenOption.READ)) {
          channel.force(true);
        }
      },
      artifact -> true
    );
  }

  public LaunchStore(
    File file,
    String buildId,
    JSONObject builtin,
    DirectorySync directorySync,
    ArtifactVerifier verifier
  ) throws Exception {
    this.file = file;
    this.builtin = copy(builtin);
    this.directorySync = directorySync;
    state = new JSONObject()
      .put("schemaVersion", 1)
      .put("buildId", buildId)
      .put("generation", 0)
      .put("current", copy(builtin))
      .put("lastGood", copy(builtin))
      .put("failed", new JSONArray())
      .put("events", new JSONArray());
    if (file.exists()) {
      // An I/O error (including protected/unavailable storage) must not erase state.
      String saved = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
      try {
        JSONObject parsed = new JSONObject(saved);
        if (
          parsed.getInt("schemaVersion") == 1 &&
          RNManifest.integer(parsed, "generation") >= 0 &&
          RNManifest.integer(parsed, "generation") < 9007199254740990L &&
          buildId.equals(parsed.getString("buildId")) &&
          compatible(parsed.getJSONObject("current")) &&
          compatible(parsed.getJSONObject("lastGood"))
        ) {
          parsed.getJSONArray("failed");
          parsed.getJSONArray("events");
          state = parsed;
        }
      } catch (Exception error) {
        /* Corrupt state selects the embedded application. */
      }
    }
    JSONObject checked = copy(state);
    for (String key : new String[] { "current", "lastGood", "staged", "previousGood" }) {
      if (!checked.has(key)) continue;
      JSONObject artifact = checked.optJSONObject(key);
      boolean valid = false;
      try {
        valid = artifact != null && verifier.verify(artifact);
      } catch (org.json.JSONException error) {
        /* Invalid pointer, not unavailable storage. */
      }
      if (!valid) {
        if (key.equals("staged") || key.equals("previousGood")) checked.remove(key);
        else checked.put(key, copy(builtin));
      } else if (artifact.optBoolean("embedded")) artifact.put(
        "bundlePath",
        builtin.getString("bundlePath")
      );
    }
    // Keep the original failed trial identity for quarantine and attribution.
    if (state.has("trialGeneration")) checked.put("current", copy(state.getJSONObject("current")));
    state = checked;
    if (state.has("trialGeneration")) {
      JSONObject next = copy(state);
      failTrial(next);
      persist(next);
    } else {
      // Publish verified pointers durably before background collection can remove rejected code.
      persist(checked);
    }
  }

  public synchronized JSONObject state() throws Exception {
    return copy(state);
  }

  public synchronized void stage(JSONObject artifact) throws Exception {
    stageArtifact(artifact, false);
  }

  private void stageArtifact(JSONObject artifact, boolean downloaded) throws Exception {
    if (!compatible(artifact)) throw new Exception("INCOMPATIBLE_ARTIFACT");
    if (failed(artifact.getString("contentHash"))) throw new Exception("QUARANTINED_ARTIFACT");
    JSONObject next = copy(state);
    if (
      artifact
        .getString("contentHash")
        .equals(next.getJSONObject("current").getString("contentHash"))
    ) {
      if (next.has("trialGeneration")) return;
      next.put("current", copy(artifact));
      confirm(next, artifact);
      next.remove("staged");
      persist(next);
      return;
    }
    next.put("staged", copy(artifact));
    if (downloaded) event(next, "downloaded", artifact, null);
    persist(next);
  }

  public synchronized void assertInstance(long generation) throws Exception {
    if (generation != state.getLong("generation") || bootstrap != generation) throw new Exception(
      "STALE_INSTANCE"
    );
  }

  public synchronized void stage(JSONObject artifact, long generation) throws Exception {
    assertInstance(generation);
    stage(artifact);
  }

  public synchronized void stage(JSONObject artifact, long generation, boolean downloaded)
    throws Exception {
    assertInstance(generation);
    stageArtifact(artifact, downloaded);
  }

  public synchronized void recordDownloadFailure(JSONObject artifact, String detail)
    throws Exception {
    if (!compatible(artifact) || artifact.isNull("releaseId")) return;
    JSONObject next = copy(state);
    event(next, "download_error", artifact, detail);
    persist(next);
  }

  public synchronized JSONObject eventForDelivery() throws Exception {
    JSONObject next = copy(state);
    trimEvents(next);
    JSONArray events = next.getJSONArray("events");
    boolean changed = events.length() != state.getJSONArray("events").length();
    if (events.length() > 0 && events.getJSONObject(0).isNull("createdAt")) {
      events.getJSONObject(0).put("createdAt", System.currentTimeMillis() / 1000.0);
      changed = true;
    }
    if (changed) persist(next);
    return events.length() == 0 ? null : copy(events.getJSONObject(0));
  }

  public synchronized void discardEvent(String id, String reason) throws Exception {
    JSONObject next = copy(state);
    JSONArray events = next.getJSONArray("events");
    for (int index = 0; index < events.length(); index++) {
      if (events.getJSONObject(index).getString("id").equals(id)) {
        events.remove(index);
        next.put("droppedEvents", next.optLong("droppedEvents") + 1);
        next.put("lastEventError", reason.substring(0, Math.min(500, reason.length())));
        persist(next);
        return;
      }
    }
  }

  private static void trimEvents(JSONObject state) throws Exception {
    JSONArray before = state.getJSONArray("events");
    JSONArray kept = new JSONArray();
    double now = System.currentTimeMillis() / 1000.0;
    for (int index = 0; index < before.length(); index++) {
      JSONObject event = before.optJSONObject(index);
      if (event == null || event.optString("id").isEmpty()) continue;
      double created = event.optDouble("createdAt", Double.NaN);
      if (
        event.isNull("createdAt") || (Double.isFinite(created) && now - created <= 86400)
      ) kept.put(event);
    }
    while (kept.length() > 256) kept.remove(0);
    if (kept.length() != before.length()) {
      state.put("events", kept);
      state.put("droppedEvents", state.optLong("droppedEvents") + before.length() - kept.length());
      state.put("lastEventError", "Invalid event or retention limit exceeded");
    }
  }

  public synchronized long beginLaunch(
    boolean foreground,
    boolean activateStaged,
    long monotonicMillis
  ) throws Exception {
    if (began) return state.getLong("generation");
    this.foreground = foreground;
    if (!foreground) backgroundWorkObserved = true;
    long generation = select(foreground && !guard && activateStaged, monotonicMillis);
    began = true;
    return generation;
  }

  public synchronized void bindBootstrap(long generation) throws Exception {
    bindLaunch(generation);
  }

  /** Capture the validated launch before recovery can advance to another artifact. */
  public synchronized JSONObject bindLaunch(long generation) throws Exception {
    if (generation != state.getLong("generation")) throw new Exception("STALE_INSTANCE");
    bootstrap = generation;
    return copy(state);
  }

  public synchronized void hostReady(long generation) throws Exception {
    if (generation == state.getLong("generation")) host = generation;
  }

  public synchronized void setForeground(boolean value, long now) {
    account(now);
    foreground = value;
    foregroundSince = value && state.has("trialGeneration") ? now : -1;
  }

  public synchronized void setActivationGuard(boolean active) {
    guard = active;
  }

  public synchronized void observeBackgroundWork(long generation) throws Exception {
    if (generation == state.getLong("generation")) backgroundWorkObserved = true;
  }

  public synchronized void setActivationGuard(boolean active, long generation) throws Exception {
    if (generation == state.getLong("generation") && bootstrap == generation) guard = active;
  }

  public synchronized long apply(long generation, long now) throws Exception {
    if (generation != state.getLong("generation") || bootstrap != generation) throw new Exception(
      "STALE_INSTANCE"
    );
    if (
      !foreground ||
      guard ||
      backgroundWorkObserved ||
      host != generation ||
      state.has("trialGeneration")
    ) throw new Exception("ACTIVATION_DEFERRED");
    if (!state.has("staged")) return generation;
    return select(true, now);
  }

  public synchronized void notifyReady(long generation) throws Exception {
    if (generation != state.getLong("generation") || bootstrap != generation) throw new Exception(
      "STALE_INSTANCE"
    );
    if (!state.has("trialGeneration") || state.getLong("trialGeneration") != generation) return;
    JSONObject next = copy(state);
    confirm(next, next.getJSONObject("current"));
    next.remove("trialGeneration");
    event(next, "applied");
    persist(next);
    foregroundSince = -1;
    elapsedMillis = 0;
  }

  public synchronized boolean checkTimeout(long now, long timeoutMillis) throws Exception {
    account(now);
    return state.has("trialGeneration") && elapsedMillis >= timeoutMillis && failCurrent();
  }

  public synchronized boolean fail(long generation) throws Exception {
    return (
      state.has("trialGeneration") &&
      generation == state.getLong("trialGeneration") &&
      failCurrent()
    );
  }

  public synchronized void acknowledgeEvents(java.util.Set<String> ids) throws Exception {
    JSONObject next = copy(state);
    JSONArray kept = new JSONArray();
    JSONArray events = next.getJSONArray("events");
    for (int i = 0; i < events.length(); i++) if (
      !ids.contains(events.getJSONObject(i).getString("id"))
    ) kept.put(events.getJSONObject(i));
    next.put("events", kept);
    persist(next);
  }

  private long select(boolean activate, long now) throws Exception {
    JSONObject next = copy(state);
    if (next.has("trialGeneration")) failTrial(next);
    long generation = next.getLong("generation") + 1;
    next.put("generation", generation);
    if (activate && next.has("staged")) {
      JSONObject staged = next.getJSONObject("staged");
      if (!compatible(staged) || failed(staged.getString("contentHash"))) throw new Exception(
        "INCOMPATIBLE_ARTIFACT"
      );
      next.put("current", staged);
      next.remove("staged");
      String content = staged.getString("contentHash");
      if (!content.equals(next.getJSONObject("lastGood").getString("contentHash"))) next.put(
        "trialGeneration",
        generation
      );
      else confirm(next, staged);
    } else next.put("current", copy(next.getJSONObject("lastGood")));
    persist(next);
    bootstrap = -1;
    host = -1;
    guard = false;
    elapsedMillis = 0;
    foregroundSince = foreground && next.has("trialGeneration") ? now : -1;
    return generation;
  }

  private boolean failCurrent() throws Exception {
    JSONObject next = copy(state);
    failTrial(next);
    next.put("generation", next.getLong("generation") + 1);
    persist(next);
    bootstrap = -1;
    host = -1;
    guard = false;
    foregroundSince = -1;
    return true;
  }

  private static void failTrial(JSONObject state) throws Exception {
    if (!state.has("trialGeneration")) return;
    state.getJSONArray("failed").put(state.getJSONObject("current").getString("contentHash"));
    event(state, "rollback");
    state.put("current", copy(state.getJSONObject("lastGood")));
    state.remove("trialGeneration");
  }

  private static void confirm(JSONObject state, JSONObject artifact) throws Exception {
    JSONObject lastGood = state.getJSONObject("lastGood");
    if (
      !lastGood.getString("contentHash").equals(artifact.getString("contentHash")) &&
      !lastGood.optBoolean("embedded")
    ) state.put("previousGood", copy(lastGood));
    state.put("lastGood", copy(artifact));
  }

  private static void event(JSONObject state, String type) throws Exception {
    event(state, type, state.getJSONObject("current"), null);
  }

  private static void event(JSONObject state, String type, JSONObject artifact, String detail)
    throws Exception {
    state
      .getJSONArray("events")
      .put(
        new JSONObject()
          .put("id", UUID.randomUUID().toString())
          .put("type", type)
          .put("artifact", copy(artifact))
          .put("createdAt", System.currentTimeMillis() / 1000.0)
          .put(
            "detail",
            detail == null ? JSONObject.NULL : detail.substring(0, Math.min(500, detail.length()))
          )
      );
  }

  private void account(long now) {
    if (foregroundSince >= 0) {
      elapsedMillis += Math.max(0, now - foregroundSince);
      foregroundSince = now;
    }
  }

  private boolean compatible(JSONObject artifact) throws Exception {
    // Recovery needs the original trial hash even when its cached payload is damaged.
    // Reject incomplete pointers before adopting saved state or attempting attribution.
    Object contentHash = artifact.opt("contentHash");
    if (!(contentHash instanceof String) || ((String) contentHash).isEmpty()) return false;
    for (String key : new String[] { "appId", "platform", "runtimeVersion" })
      if (!builtin.getString(key).equals(artifact.getString(key))) return false;
    return true;
  }

  private boolean failed(String hash) throws Exception {
    JSONArray failed = state.getJSONArray("failed");
    for (int i = 0; i < failed.length(); i++) if (hash.equals(failed.getString(i))) return true;
    return false;
  }

  private static JSONObject copy(JSONObject value) throws Exception {
    return new JSONObject(value.toString());
  }

  private void persist(JSONObject next) throws Exception {
    trimEvents(next);
    if (storageFailed) throw new Exception("STORAGE_UNAVAILABLE");
    File directory = file.getParentFile();
    Files.createDirectories(directory.toPath());
    File temporary = new File(directory, "." + UUID.randomUUID() + ".tmp");
    try {
      try (FileOutputStream output = new FileOutputStream(temporary)) {
        output.write(next.toString().getBytes(StandardCharsets.UTF_8));
        output.getFD().sync();
      }
      Files.move(
        temporary.toPath(),
        file.toPath(),
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING
      );
      directorySync.sync(directory);
      state = next;
    } catch (Exception error) {
      storageFailed = true;
      throw error;
    } finally {
      Files.deleteIfExists(temporary.toPath());
    }
  }
}
