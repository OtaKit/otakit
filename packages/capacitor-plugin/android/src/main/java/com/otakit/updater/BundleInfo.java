package com.otakit.updater;

import com.getcapacitor.JSObject;
import org.json.JSONException;
import org.json.JSONObject;

class BundleInfo {

  final String id;
  final String version;
  final String runtimeVersion;
  final BundleStatus status;
  final Long downloadedAt;
  final String sha256;
  final String path;
  final String channel;
  final String releaseId;

  BundleInfo(
    String id,
    String version,
    String runtimeVersion,
    BundleStatus status,
    Long downloadedAt,
    String sha256,
    String path,
    String channel,
    String releaseId
  ) {
    this.id = id;
    this.version = version;
    this.runtimeVersion = runtimeVersion;
    this.status = status;
    this.downloadedAt = downloadedAt;
    this.sha256 = sha256;
    this.path = path;
    this.channel = channel;
    this.releaseId = releaseId;
  }

  boolean isBuiltin() {
    return "builtin".equals(id);
  }

  JSObject toJSObject() {
    JSObject object = new JSObject();
    object.put("id", id);
    object.put("version", version);
    if (runtimeVersion != null) {
      object.put("runtimeVersion", runtimeVersion);
    }
    object.put("status", status.value());
    if (downloadedAt != null) {
      object.put("downloadedAt", DateUtils.toIsoString(downloadedAt));
    }
    if (sha256 != null) {
      object.put("sha256", sha256);
    }
    if (channel != null) {
      object.put("channel", channel);
    }
    if (releaseId != null) {
      object.put("releaseId", releaseId);
    }
    return object;
  }

  JSONObject toJSONObject() throws JSONException {
    JSONObject object = new JSONObject();
    object.put("id", id);
    object.put("version", version);
    if (runtimeVersion != null) {
      object.put("runtimeVersion", runtimeVersion);
    }
    object.put("status", status.value());
    if (downloadedAt != null) {
      object.put("downloadedAt", downloadedAt);
    }
    if (sha256 != null) {
      object.put("sha256", sha256);
    }
    if (channel != null) {
      object.put("channel", channel);
    }
    if (releaseId != null) {
      object.put("releaseId", releaseId);
    }
    if (path != null) {
      object.put("path", path);
    }
    return object;
  }

  static BundleInfo fromJSONObject(JSONObject object) {
    String id = object.optString("id", "builtin");
    String version = object.optString("version", "0.0.0");
    String runtimeVersion = object.has("runtimeVersion")
      ? object.optString("runtimeVersion", null)
      : null;
    BundleStatus status = BundleStatus.from(object.optString("status", "pending"));
    Long downloadedAt = object.has("downloadedAt") ? object.optLong("downloadedAt") : null;
    String sha256 = object.has("sha256") ? object.optString("sha256", null) : null;
    String channel = object.has("channel") ? object.optString("channel", null) : null;
    String releaseId = object.has("releaseId") ? object.optString("releaseId", null) : null;
    String path = object.has("path") ? object.optString("path", null) : null;
    return new BundleInfo(
      id,
      version,
      runtimeVersion,
      status,
      downloadedAt,
      sha256,
      path,
      channel,
      releaseId
    );
  }

  BundleInfo withStatus(BundleStatus nextStatus) {
    return new BundleInfo(
      id,
      version,
      runtimeVersion,
      nextStatus,
      downloadedAt,
      sha256,
      path,
      channel,
      releaseId
    );
  }
}
