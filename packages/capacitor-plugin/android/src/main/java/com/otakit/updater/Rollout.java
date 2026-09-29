package com.otakit.updater;

import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

final class Rollout {

  /** What the last manifest check decided about a lane's active rollout. */
  static final class State {

    final String releaseId;
    final String version;
    final int percent;
    final int bucket;
    final boolean included;

    State(String releaseId, String version, int percent, int bucket, boolean included) {
      this.releaseId = releaseId;
      this.version = version;
      this.percent = percent;
      this.bucket = bucket;
      this.included = included;
    }

    JSObject toJSObject() {
      JSObject result = new JSObject();
      result.put("releaseId", releaseId);
      result.put("version", version);
      result.put("percent", percent);
      result.put("bucket", bucket);
      result.put("included", included);
      return result;
    }
  }

  static final class Selection {

    final ManifestClient.LatestManifest manifest;
    final State state;

    Selection(ManifestClient.LatestManifest manifest, State state) {
      this.manifest = manifest;
      this.state = state;
    }
  }

  private Rollout() {}

  /**
   * The device's number from 1 to 100 for one rollout. Derived from a secret that never leaves
   * the device, so it is sticky for that rollout and independent between rollouts. Must match
   * Rollout.swift.
   */
  static int bucket(String secret, String key) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(
        (secret + ":" + key).getBytes(StandardCharsets.UTF_8)
      );
      long value =
        ((digest[0] & 0xFFL) << 24) |
        ((digest[1] & 0xFFL) << 16) |
        ((digest[2] & 0xFFL) << 8) |
        (digest[3] & 0xFFL);
      return (int) (value % 100) + 1;
    } catch (java.security.NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 is unavailable", error);
    }
  }

  /**
   * The manifest this device should follow: the rolling release when its bucket is within the
   * percent, otherwise the stable release.
   */
  static Selection select(ManifestClient.ParsedManifest parsed, String secret) {
    ManifestClient.ManifestRollout rollout = parsed.rollout;
    if (rollout == null) {
      return new Selection(parsed.stable, null);
    }
    int bucket = bucket(secret, "rollout:" + rollout.manifest.releaseId);
    boolean included = bucket <= rollout.percent;
    State state = new State(
      rollout.manifest.releaseId,
      rollout.manifest.version,
      rollout.percent,
      bucket,
      included
    );
    return new Selection(included ? rollout.manifest : parsed.stable, state);
  }
}
