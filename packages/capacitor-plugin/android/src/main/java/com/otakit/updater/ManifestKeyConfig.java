package com.otakit.updater;

import android.util.Base64;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Empty means intentionally unconfigured; malformed explicit settings must never return empty. */
final class ManifestKeyConfig {

  private ManifestKeyConfig() {}

  static List<ManifestVerifier.KeyEntry> parse(JSONObject config) {
    List<ManifestVerifier.KeyEntry> keys = new ArrayList<>();
    try {
      Object raw = config.opt("manifestKeys");
      if (raw == null) return keys;
      if (!(raw instanceof JSONArray)) return invalid();
      JSONArray entries = (JSONArray) raw;
      if (entries.length() == 0) return keys;
      for (int i = 0; i < entries.length(); i++) {
        JSONObject entry = entries.optJSONObject(i);
        if (entry == null) continue;
        String kid = entry.optString("kid", null);
        String key = entry.optString("key", null);
        if (kid != null && key != null) {
          keys.add(new ManifestVerifier.KeyEntry(kid, Base64.decode(key, Base64.DEFAULT)));
        }
      }
      if (keys.isEmpty()) return invalid();
      return keys;
    } catch (Exception error) {
      return invalid();
    }
  }

  private static List<ManifestVerifier.KeyEntry> invalid() {
    android.util.Log.e(
      "OtaKit",
      "Invalid manifestKeys configuration. Manifest verification will reject all updates."
    );
    return java.util.Collections.singletonList(
      new ManifestVerifier.KeyEntry("_invalid_", new byte[0])
    );
  }
}
