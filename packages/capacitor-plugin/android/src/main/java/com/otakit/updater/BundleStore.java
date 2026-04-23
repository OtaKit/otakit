package com.otakit.updater;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import java.io.File;
import java.io.FileInputStream;
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

  private final Context context;
  private final SharedPreferences prefs;
  private final File bundlesDirectory;
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
    try (FileOutputStream output = new FileOutputStream(metadataFile(bundle.id), false)) {
      output.write(bytes);
    }
  }

  synchronized BundleInfo getBundle(String id) {
    if ("builtin".equals(id)) {
      return builtinBundle();
    }

    File metadata = metadataFile(id);
    if (!metadata.exists()) {
      return null;
    }

    try (FileInputStream input = new FileInputStream(metadata)) {
      byte[] bytes = readAllBytes(input);
      JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
      return BundleInfo.fromJSONObject(json);
    } catch (Exception ignored) {
      return null;
    }
  }

  private static byte[] readAllBytes(FileInputStream input) throws Exception {
    java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
    byte[] chunk = new byte[8192];
    int read;
    while ((read = input.read(chunk)) != -1) {
      buffer.write(chunk, 0, read);
    }
    return buffer.toByteArray();
  }

  synchronized boolean bundleExists(String id) {
    return getBundle(id) != null;
  }

  synchronized BundleInfo getCurrentBundle() {
    String currentId = prefs.getString(KEY_CURRENT, null);
    if (currentId == null) {
      return builtinBundle();
    }
    BundleInfo current = getBundle(currentId);
    return current != null ? current : builtinBundle();
  }

  synchronized String getCurrentBundleId() {
    return prefs.getString(KEY_CURRENT, null);
  }

  synchronized void setCurrentBundleId(String id) {
    SharedPreferences.Editor editor = prefs.edit();
    if (id == null) {
      editor.remove(KEY_CURRENT);
    } else {
      editor.putString(KEY_CURRENT, id);
    }
    editor.commit();
  }

  synchronized BundleInfo getFallbackBundle() {
    String fallbackId = prefs.getString(KEY_FALLBACK, null);
    if (fallbackId == null) {
      return builtinBundle();
    }
    BundleInfo fallback = getBundle(fallbackId);
    return fallback != null ? fallback : builtinBundle();
  }

  synchronized String getFallbackBundleId() {
    return prefs.getString(KEY_FALLBACK, null);
  }

  synchronized void setFallbackBundleId(String id) {
    SharedPreferences.Editor editor = prefs.edit();
    if (id == null) {
      editor.remove(KEY_FALLBACK);
    } else {
      editor.putString(KEY_FALLBACK, id);
    }
    editor.commit();
  }

  synchronized String getStagedBundleId() {
    return prefs.getString(KEY_STAGED, null);
  }

  synchronized void setStagedBundleId(String id) {
    SharedPreferences.Editor editor = prefs.edit();
    if (id == null) {
      editor.remove(KEY_STAGED);
    } else {
      editor.putString(KEY_STAGED, id);
    }
    editor.commit();
  }

  synchronized void setLastFailedBundle(BundleInfo bundle) {
    SharedPreferences.Editor editor = prefs.edit();
    if (bundle == null) {
      editor.remove(KEY_LAST_FAILED_BUNDLE_INFO);
    } else {
      try {
        editor.putString(KEY_LAST_FAILED_BUNDLE_INFO, bundle.toJSONObject().toString());
      } catch (JSONException ignored) {
        editor.remove(KEY_LAST_FAILED_BUNDLE_INFO);
      }
    }
    editor.apply();
  }

  synchronized BundleInfo getLastFailedBundle() {
    String json = prefs.getString(KEY_LAST_FAILED_BUNDLE_INFO, null);
    if (json == null) {
      return null;
    }
    try {
      return BundleInfo.fromJSONObject(new JSONObject(json));
    } catch (Exception e) {
      return null;
    }
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
    } catch (Exception ignored) {}
  }

  synchronized void deleteBundle(String id) throws Exception {
    if ("builtin".equals(id)) {
      return;
    }

    File directory = bundleDirectory(id);
    deleteRecursively(directory);

    if (id.equals(getStagedBundleId())) {
      setStagedBundleId(null);
    }
    if (id.equals(prefs.getString(KEY_CURRENT, null))) {
      setCurrentBundleId(null);
    }
    if (id.equals(prefs.getString(KEY_FALLBACK, null))) {
      setFallbackBundleId(null);
    }
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
