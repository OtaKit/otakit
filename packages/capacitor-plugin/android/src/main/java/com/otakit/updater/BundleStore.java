package com.otakit.updater;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

final class BundleStore {

  private static final String PREFS_NAME = "otakit_updater_state";
  private static final String KEY_CURRENT = "current_bundle_id";
  private static final String KEY_FALLBACK = "fallback_bundle_id";
  private static final String KEY_STAGED = "staged_bundle_id";
  private static final String KEY_LAST_FAILED_BUNDLE_INFO = "last_failed_bundle_info";
  private static final String KEY_LAST_RESOLVED_RUNTIME_KEY = "last_resolved_runtime_key";
  private static final String KEY_OVERRIDE_CHANNEL = "override_channel";

  private final Context context;
  private final SharedPreferences prefs;
  private final File bundlesDirectory;
  private final File filesCacheDirectory;
  private final String builtinVersion;
  private final String nativeBuild;
  private final String appRuntimeVersion;

  BundleStore(
    Context context,
    String builtinVersion,
    String nativeBuild,
    String appRuntimeVersion
  ) {
    this.context = context.getApplicationContext();
    this.prefs = this.context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    this.builtinVersion = builtinVersion;
    this.nativeBuild = nativeBuild;
    this.appRuntimeVersion = appRuntimeVersion;
    this.bundlesDirectory = new File(this.context.getFilesDir(), "otakit_bundles");
    if (!bundlesDirectory.exists()) {
      //noinspection ResultOfMethodCallIgnored
      bundlesDirectory.mkdirs();
    }
    this.filesCacheDirectory = new File(this.context.getFilesDir(), "otakit_files");
    if (!filesCacheDirectory.exists()) {
      //noinspection ResultOfMethodCallIgnored
      filesCacheDirectory.mkdirs();
    }
  }

  /** Content-addressed file cache for the deltas strategy ({@code otakit_files/<sha256>}). */
  File getFilesCacheDirectory() {
    return filesCacheDirectory;
  }

  String getNativeBuild() {
    return nativeBuild;
  }

  String getBuiltinVersion() {
    return builtinVersion;
  }

  SharedPreferences getPrefs() {
    return prefs;
  }

  BundleInfo builtinBundle() {
    return new BundleInfo(
      "builtin",
      builtinVersion,
      appRuntimeVersion,
      BundleStatus.BUILTIN,
      null,
      null,
      null,
      null,
      null
    );
  }

  File bundleDirectory(String id) {
    return new File(bundlesDirectory, id);
  }

  private File metadataFile(String id) {
    return new File(bundleDirectory(id), "bundle.json");
  }

  synchronized void saveBundle(BundleInfo bundle) throws Exception {
    if (bundle.isBuiltin()) {
      return;
    }

    File directory = bundleDirectory(bundle.id);
    if (!directory.exists() && !directory.mkdirs()) {
      throw new IllegalStateException("Failed to create bundle directory");
    }

    byte[] bytes = bundle.toJSONObject().toString().getBytes(StandardCharsets.UTF_8);
    writeAtomically(metadataFile(bundle.id), bytes);
  }

  synchronized BundleInfo getBundle(String id) {
    if ("builtin".equals(id)) {
      return builtinBundle();
    }

    File metadata = metadataFile(id);
    try {
      byte[] bytes = new AtomicFile(metadata).readFully();
      JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
      return BundleInfo.fromJSONObject(json);
    } catch (Exception ignored) {
      return null;
    }
  }

  synchronized boolean bundleExists(String id) {
    return getBundle(id) != null;
  }

  private File stateFile() {
    return new File(context.getFilesDir(), "otakit-state.json");
  }

  private static void writeAtomically(File file, byte[] bytes) throws Exception {
    AtomicFile atomic = new AtomicFile(file);
    FileOutputStream output = null;
    try {
      output = atomic.startWrite();
      output.write(bytes);
      output.getFD().sync();
      atomic.finishWrite(output);
      output = null;
      if (!Arrays.equals(atomic.readFully(), bytes)) {
        throw new java.io.IOException("Atomic updater state write did not complete");
      }
    } catch (Exception error) {
      if (output != null) atomic.failWrite(output);
      throw error;
    }
  }

  private JSONObject readCoreState() throws Exception {
    File file = stateFile();
    if (file.exists() || new File(file.getPath() + ".bak").exists()) {
      JSONObject state = new JSONObject(
        new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8)
      );
      if (state.getInt("version") != 1) throw new IllegalStateException(
        "Unsupported updater state"
      );
      return state;
    }
    JSONObject state = new JSONObject();
    state.put("version", 1);
    state.put("currentId", prefs.getString(KEY_CURRENT, null));
    state.put("fallbackId", prefs.getString(KEY_FALLBACK, null));
    state.put("stagedId", prefs.getString(KEY_STAGED, null));
    String failed = prefs.getString(KEY_LAST_FAILED_BUNDLE_INFO, null);
    if (failed != null) {
      try {
        state.put("lastFailed", new JSONObject(failed));
      } catch (JSONException ignored) {}
    }
    return state;
  }

  private JSONObject readCoreStateOrEmpty() {
    try {
      return readCoreState();
    } catch (Exception error) {
      return new JSONObject();
    }
  }

  private void writeCoreState(JSONObject state) throws Exception {
    writeAtomically(stateFile(), state.toString().getBytes(StandardCharsets.UTF_8));
  }

  private void setCoreValue(String key, Object value) {
    try {
      JSONObject state = readCoreState();
      state.put(key, value);
      writeCoreState(state);
    } catch (Exception error) {
      throw new IllegalStateException("Could not persist updater state", error);
    }
  }

  synchronized void setCoreState(
    String currentId,
    String fallbackId,
    String stagedId,
    BundleInfo lastFailed
  ) {
    try {
      readCoreState();
      JSONObject state = new JSONObject();
      state.put("version", 1);
      state.put("currentId", currentId);
      state.put("fallbackId", fallbackId);
      state.put("stagedId", stagedId);
      if (lastFailed != null) state.put("lastFailed", lastFailed.toJSONObject());
      writeCoreState(state);
    } catch (Exception error) {
      throw new IllegalStateException("Could not persist updater state", error);
    }
  }

  synchronized BundleInfo getCurrentBundle() {
    String id = getCurrentBundleId();
    BundleInfo bundle = id == null ? null : getBundle(id);
    return bundle != null ? bundle : builtinBundle();
  }

  synchronized java.util.Set<String> protectedBundleIds() throws Exception {
    JSONObject state = readCoreState();
    java.util.Set<String> ids = new java.util.HashSet<>();
    for (String key : new String[] { "currentId", "fallbackId", "stagedId" }) {
      String id = state.optString(key, null);
      if (id != null) ids.add(id);
    }
    return ids;
  }

  synchronized String getCurrentBundleId() {
    return readCoreStateOrEmpty().optString("currentId", null);
  }

  synchronized void setCurrentBundleId(String id) {
    setCoreValue("currentId", id);
  }

  synchronized BundleInfo getFallbackBundle() {
    String id = getFallbackBundleId();
    BundleInfo bundle = id == null ? null : getBundle(id);
    return bundle != null ? bundle : builtinBundle();
  }

  synchronized String getFallbackBundleId() {
    return readCoreStateOrEmpty().optString("fallbackId", null);
  }

  synchronized void setFallbackBundleId(String id) {
    setCoreValue("fallbackId", id);
  }

  synchronized String getStagedBundleId() {
    return readCoreStateOrEmpty().optString("stagedId", null);
  }

  synchronized void setStagedBundleId(String id) {
    setCoreValue("stagedId", id);
  }

  synchronized void setLastFailedBundle(BundleInfo bundle) {
    try {
      setCoreValue("lastFailed", bundle == null ? null : bundle.toJSONObject());
    } catch (JSONException error) {
      throw new IllegalStateException(error);
    }
  }

  synchronized BundleInfo getLastFailedBundle() {
    JSONObject failed = readCoreStateOrEmpty().optJSONObject("lastFailed");
    return failed == null ? null : BundleInfo.fromJSONObject(failed);
  }

  synchronized String getOverrideChannel() {
    return prefs.getString(KEY_OVERRIDE_CHANNEL, null);
  }

  synchronized void setOverrideChannel(String channel) {
    SharedPreferences.Editor editor = prefs.edit();
    if (channel == null) {
      editor.remove(KEY_OVERRIDE_CHANNEL);
    } else {
      editor.putString(KEY_OVERRIDE_CHANNEL, channel);
    }
    editor.commit();
  }

  synchronized String getLastResolvedRuntimeKey() {
    return prefs.getString(KEY_LAST_RESOLVED_RUNTIME_KEY, null);
  }

  synchronized void setLastResolvedRuntimeKey(String runtimeKey) {
    SharedPreferences.Editor editor = prefs.edit();
    if (runtimeKey == null) {
      // null clears the key so the next cold start is treated as unresolved again
      editor.remove(KEY_LAST_RESOLVED_RUNTIME_KEY);
    } else {
      editor.putString(KEY_LAST_RESOLVED_RUNTIME_KEY, runtimeKey);
    }
    editor.commit();
  }

  synchronized void markStatus(String bundleId, BundleStatus status) {
    BundleInfo existing = getBundle(bundleId);
    if (existing == null) {
      return;
    }
    try {
      saveBundle(existing.withStatus(status));
    } catch (Exception error) {
      throw new IllegalStateException("Could not persist bundle status", error);
    }
  }

  synchronized void deleteBundle(String id) throws Exception {
    if ("builtin".equals(id)) {
      return;
    }

    setCoreState(
      id.equals(getCurrentBundleId()) ? null : getCurrentBundleId(),
      id.equals(getFallbackBundleId()) ? null : getFallbackBundleId(),
      id.equals(getStagedBundleId()) ? null : getStagedBundleId(),
      getLastFailedBundle()
    );
    deleteRecursively(bundleDirectory(id));
  }

  synchronized List<BundleInfo> listDownloadedBundleInfos() {
    List<BundleInfo> result = new ArrayList<>();
    File[] entries = bundlesDirectory.listFiles();
    if (entries != null) {
      Arrays.sort(entries, Comparator.comparing(File::getName));
      for (File entry : entries) {
        BundleInfo bundle = getBundle(entry.getName());
        if (bundle != null) {
          result.add(bundle);
        }
      }
    }
    return result;
  }

  synchronized JSArray listDownloadedBundles() {
    List<BundleInfo> result = listDownloadedBundleInfos();
    JSArray array = new JSArray();
    for (BundleInfo bundle : result) {
      array.put(bundle.toJSObject());
    }
    return array;
  }

  private void deleteRecursively(File target) throws Exception {
    if (!target.exists()) {
      return;
    }
    if (target.isDirectory()) {
      File[] children = target.listFiles();
      if (children != null) {
        for (File child : children) {
          deleteRecursively(child);
        }
      }
    }
    if (!target.delete()) {
      throw new IllegalStateException("Failed to delete " + target.getAbsolutePath());
    }
  }
}
