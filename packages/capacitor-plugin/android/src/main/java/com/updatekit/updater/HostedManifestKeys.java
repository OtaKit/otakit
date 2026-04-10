package com.updatekit.updater;

import android.util.Base64;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class HostedManifestKeys {

  private static final String MANAGED_SERVER_URL = "https://www.otakit.app/api/v1";

  private HostedManifestKeys() {}

  static boolean matchesManagedServer(String updateUrl) {
    if (updateUrl == null) {
      return false;
    }

    String normalized = updateUrl.trim().replaceAll("/+$", "").toLowerCase(Locale.ROOT);
    return normalized.equals(MANAGED_SERVER_URL)
        || normalized.equals("https://otakit.app/api/v1");
  }

  static List<ManifestVerifier.KeyEntry> createDefaultKeys() {
    ArrayList<ManifestVerifier.KeyEntry> keys = new ArrayList<>();
    keys.add(
      new ManifestVerifier.KeyEntry(
        "hosted-2026-04-02-ce611e6d",
        Base64.decode(
          "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAELg6eAj2+7aZ1FJnYUNMjOtWuQLJMomXkPvmeTQ3gXyabpLTDX0m3iWYO3cEOXqIR6NphGC6csS2T5bCtXwIBFw==",
          Base64.DEFAULT
        )
      )
    );
    return keys;
  }
}
