package com.otakit.updater;

import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class ManifestClient {

  static final class HttpFailure extends Exception {

    final int status;

    HttpFailure(int status) {
      super("Latest request failed (" + status + ")");
      this.status = status;
    }
  }

  private static final String BASE_CHANNEL_KEY = "__base__";
  private static final String DEFAULT_RUNTIME_KEY = "__default__";

  static final class ManifestSignature {

    final String kid;
    final String sig;
    final int iat;
    final int exp;

    ManifestSignature(String kid, String sig, int iat, int exp) {
      this.kid = kid;
      this.sig = sig;
      this.iat = iat;
      this.exp = exp;
    }
  }

  static final class ManifestEncryption {

    final String alg;
    final String kid;
    final String wrapNonce;
    final String wrappedDek;
    final String nonce;

    ManifestEncryption(String alg, String kid, String wrapNonce, String wrappedDek, String nonce) {
      this.alg = alg;
      this.kid = kid;
      this.wrapNonce = wrapNonce;
      this.wrappedDek = wrappedDek;
      this.nonce = nonce;
    }
  }

  static final class ManifestFileEntry {

    final String path;
    final String sha256;
    final long size;
    final String url;

    ManifestFileEntry(String path, String sha256, long size, String url) {
      this.path = path;
      this.sha256 = sha256;
      this.size = size;
      this.url = url;
    }
  }

  static final class LatestManifest {

    final String version;
    /** Bundle zip URL. Present for the zip strategy; null for deltas. */
    final String url;
    /** Zip hash for the zip strategy; canonical filesHash for deltas. */
    final String sha256;
    final int size;
    final String runtimeVersion;
    final String releaseId;
    final String strategy;
    final boolean forceImmediate;
    final ManifestEncryption encryption;
    /** Per-file entries for the deltas strategy; null for zip. */
    final java.util.List<ManifestFileEntry> files;

    LatestManifest(
      String version,
      String url,
      String sha256,
      int size,
      String runtimeVersion,
      String releaseId,
      String strategy,
      boolean forceImmediate,
      ManifestEncryption encryption,
      java.util.List<ManifestFileEntry> files
    ) {
      this.version = version;
      this.url = url;
      this.sha256 = sha256;
      this.size = size;
      this.runtimeVersion = runtimeVersion;
      this.releaseId = releaseId;
      this.strategy = strategy;
      this.forceImmediate = forceImmediate;
      this.encryption = encryption;
      this.files = files;
    }
  }

  /** A rolling release offered to {@code percent} of devices (plugin 3.1+). */
  static final class ManifestRollout {

    final LatestManifest manifest;
    final int percent;

    ManifestRollout(LatestManifest manifest, int percent) {
      this.manifest = manifest;
      this.percent = percent;
    }
  }

  static final class ParsedManifest {

    /** The release every device may take. */
    final LatestManifest stable;
    final ManifestRollout rollout;
    /** Why a rollout block was ignored; devices then stay on {@code stable}. */
    final CheckFailure rolloutFailure;

    ParsedManifest(LatestManifest stable, ManifestRollout rollout, CheckFailure rolloutFailure) {
      this.stable = stable;
      this.rollout = rollout;
      this.rolloutFailure = rolloutFailure;
    }
  }

  private static final class ParsedEntry {

    final LatestManifest manifest;
    final ManifestSignature signature;

    ParsedEntry(LatestManifest manifest, ManifestSignature signature) {
      this.manifest = manifest;
      this.signature = signature;
    }
  }

  private ManifestClient() {}

  static void requireHTTPS(URL url, boolean allowInsecure) throws Exception {
    String protocol = url.getProtocol().toLowerCase();
    if ("https".equals(protocol)) return;
    if (allowInsecure) {
      String host = url.getHost().toLowerCase();
      if ("localhost".equals(host) || "127.0.0.1".equals(host)) return;
    }
    throw new IllegalStateException("URL must use HTTPS: " + url.toString());
  }

  static ParsedManifest fetchLatest(
    String cdnUrl,
    String appId,
    String channel,
    String runtimeVersion,
    boolean allowInsecureUrls,
    java.util.List<ManifestVerifier.KeyEntry> manifestKeys
  ) throws Exception {
    String base = cdnUrl.replaceAll("/+$", "");
    String channelKey =
      channel != null && !channel.trim().isEmpty() ? channel.trim() : BASE_CHANNEL_KEY;
    String runtimeKey =
      runtimeVersion != null && !runtimeVersion.trim().isEmpty()
        ? runtimeVersion.trim()
        : DEFAULT_RUNTIME_KEY;
    Uri baseUri = Uri.parse(base);
    if (baseUri.getScheme() == null || baseUri.getHost() == null) {
      throw new IllegalStateException("Invalid CDN URL");
    }
    Uri urlUri = baseUri
      .buildUpon()
      .appendPath("manifests")
      .appendPath(appId)
      .appendPath(channelKey)
      .appendPath(runtimeKey)
      .appendPath("manifest.json")
      .build();
    URL url = new URL(urlUri.toString());

    requireHTTPS(url, allowInsecureUrls);

    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    try {
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(30_000);

      int status = connection.getResponseCode();
      if (status == 404 || status == 204) {
        return null;
      }
      if (status != 200) {
        throw new HttpFailure(status);
      }

      String payload = readStream(connection.getInputStream());
      return parse(payload, appId, channel, allowInsecureUrls, manifestKeys);
    } finally {
      connection.disconnect();
    }
  }

  /**
   * Parse and verify a manifest body. The top level must be valid; an optional rollout block that
   * fails parsing or verification is dropped (reported in {@code rolloutFailure}) so a bad block
   * can never block updates.
   */
  static ParsedManifest parse(
    String payload,
    String appId,
    String channel,
    boolean allowInsecureUrls,
    java.util.List<ManifestVerifier.KeyEntry> manifestKeys
  ) throws Exception {
    JSONObject json = new JSONObject(payload);
    ParsedEntry stable = parseEntry(json, allowInsecureUrls);

    if (manifestKeys == null || manifestKeys.isEmpty()) {
      android.util.Log.w(
        "OtaKit",
        "No manifest signing keys configured — signature verification is disabled for this request."
      );
    }

    if (manifestKeys != null && !manifestKeys.isEmpty()) {
      if (stable.signature == null) {
        throw new ManifestVerifier.VerificationException("signature_missing");
      }

      ManifestVerifier.verify(
        appId,
        channel,
        stable.manifest.version,
        stable.manifest.sha256,
        stable.manifest.size,
        stable.manifest.runtimeVersion,
        stable.manifest.strategy,
        stable.manifest.forceImmediate,
        stable.manifest.encryption,
        stable.signature,
        manifestKeys
      );
    }

    if (!json.has("rollout") || json.isNull("rollout")) {
      return new ParsedManifest(stable.manifest, null, null);
    }
    try {
      ManifestRollout rollout = parseRollout(
        json.get("rollout"),
        stable.manifest,
        appId,
        channel,
        allowInsecureUrls,
        manifestKeys
      );
      return new ParsedManifest(stable.manifest, rollout, null);
    } catch (Exception error) {
      return new ParsedManifest(stable.manifest, null, CheckFailure.rollout(error));
    }
  }

  private static ManifestRollout parseRollout(
    Object rawValue,
    LatestManifest stable,
    String appId,
    String channel,
    boolean allowInsecureUrls,
    java.util.List<ManifestVerifier.KeyEntry> manifestKeys
  ) throws Exception {
    if (!(rawValue instanceof JSONObject)) {
      throw new IllegalStateException("Rollout block is not an object");
    }
    JSONObject json = (JSONObject) rawValue;
    // Strict types (no string or fraction coercion) to match the iOS parser.
    Object rawPercent = json.opt("percent");
    Object rawStableSha256 = json.opt("stableSha256");
    if (
      !(rawPercent instanceof Integer) ||
      (Integer) rawPercent < 1 ||
      (Integer) rawPercent > 99 ||
      !stable.sha256.equals(rawStableSha256)
    ) {
      throw new IllegalStateException("Rollout block is invalid");
    }
    ParsedEntry entry = parseEntry(json, allowInsecureUrls);
    ManifestRollout rollout = new ManifestRollout(entry.manifest, (Integer) rawPercent);
    if (manifestKeys != null && !manifestKeys.isEmpty()) {
      if (entry.signature == null) {
        throw new ManifestVerifier.VerificationException("signature_missing");
      }
      ManifestVerifier.verifyRollout(
        appId,
        channel,
        rollout,
        stable.sha256,
        entry.signature,
        manifestKeys
      );
    }
    return rollout;
  }

  /** Bundle fields shared by the top level and the rollout block. */
  private static ParsedEntry parseEntry(JSONObject json, boolean allowInsecureUrls)
    throws Exception {
    String version = json.getString("version");
    String sha256 = json.getString("sha256");
    int size = json.getInt("size");

    String responseRuntimeVersion =
      json.has("runtimeVersion") && !json.isNull("runtimeVersion")
        ? json.getString("runtimeVersion").trim()
        : null;
    if (responseRuntimeVersion != null && responseRuntimeVersion.isEmpty()) {
      responseRuntimeVersion = null;
    }

    ManifestSignature signature = parseSignature(json.optJSONObject("signature"));

    String releaseId = null;
    if (json.has("releaseId") && !json.isNull("releaseId")) {
      releaseId = json.getString("releaseId").trim();
    }
    if (releaseId != null && releaseId.isEmpty()) {
      releaseId = null;
    }
    if (releaseId == null) {
      throw new IllegalStateException("Manifest response missing required releaseId");
    }

    String strategy = "zip";
    if (json.has("strategy") && !json.isNull("strategy")) {
      String rawStrategy = json.getString("strategy").trim();
      if (!rawStrategy.isEmpty()) {
        strategy = rawStrategy;
      }
    }
    // Strict boolean (no string coercion) to match the iOS parser.
    Object rawForceImmediate = json.opt("forceImmediate");
    boolean forceImmediate = Boolean.TRUE.equals(rawForceImmediate);
    ManifestEncryption encryption = parseEncryption(json);

    String downloadUrl = null;
    if (json.has("url") && !json.isNull("url")) {
      String rawUrl = json.getString("url").trim();
      if (!rawUrl.isEmpty()) {
        downloadUrl = rawUrl;
      }
    }

    java.util.List<ManifestFileEntry> files = null;
    if ("deltas".equals(strategy)) {
      files = parseFiles(json, allowInsecureUrls);
    } else {
      if (downloadUrl == null) {
        throw new IllegalStateException("Manifest response missing required url");
      }
      requireHTTPS(new URL(downloadUrl), allowInsecureUrls);
    }

    return new ParsedEntry(
      new LatestManifest(
        version,
        downloadUrl,
        sha256,
        size,
        responseRuntimeVersion,
        releaseId,
        strategy,
        forceImmediate,
        encryption,
        files
      ),
      signature
    );
  }

  private static java.util.List<ManifestFileEntry> parseFiles(
    JSONObject json,
    boolean allowInsecureUrls
  ) throws Exception {
    if (!json.has("files") || json.isNull("files")) {
      throw new IllegalStateException("Delta manifest is missing its file list");
    }
    org.json.JSONArray rawFiles = json.getJSONArray("files");
    if (rawFiles.length() == 0) {
      throw new IllegalStateException("Delta manifest has an empty file list");
    }

    java.util.List<ManifestFileEntry> entries = new java.util.ArrayList<>(rawFiles.length());
    for (int index = 0; index < rawFiles.length(); index++) {
      JSONObject rawFile = rawFiles.getJSONObject(index);
      if (!rawFile.has("path") || !rawFile.has("sha256") || !rawFile.has("url")) {
        throw new IllegalStateException("Delta manifest file entry is missing required fields");
      }
      String path = rawFile.getString("path");
      String fileSha256 = rawFile.getString("sha256");
      String fileUrl = rawFile.getString("url");
      long fileSize = rawFile.optLong("size", -1);
      requireHTTPS(new URL(fileUrl), allowInsecureUrls);
      entries.add(new ManifestFileEntry(path, fileSha256, fileSize, fileUrl));
    }
    return entries;
  }

  private static ManifestEncryption parseEncryption(JSONObject json) throws Exception {
    if (!json.has("encryption") || json.isNull("encryption")) {
      return null;
    }
    JSONObject encObj = json.getJSONObject("encryption");
    if (
      !encObj.has("alg") ||
      !encObj.has("kid") ||
      !encObj.has("wrapNonce") ||
      !encObj.has("wrappedDek") ||
      !encObj.has("nonce")
    ) {
      throw new IllegalStateException("Manifest encryption block is missing required fields");
    }
    return new ManifestEncryption(
      encObj.getString("alg"),
      encObj.getString("kid"),
      encObj.getString("wrapNonce"),
      encObj.getString("wrappedDek"),
      encObj.getString("nonce")
    );
  }

  private static String readStream(InputStream input) throws Exception {
    if (input == null) {
      return "";
    }
    try (InputStream stream = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      int read;
      while ((read = stream.read(buffer)) > 0) {
        out.write(buffer, 0, read);
      }
      return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
  }

  private static ManifestSignature parseSignature(JSONObject sigObj) {
    if (sigObj == null) {
      return null;
    }
    if (!sigObj.has("kid") || !sigObj.has("sig") || !sigObj.has("iat") || !sigObj.has("exp")) {
      return null;
    }
    try {
      return new ManifestSignature(
        sigObj.getString("kid"),
        sigObj.getString("sig"),
        sigObj.getInt("iat"),
        sigObj.getInt("exp")
      );
    } catch (org.json.JSONException e) {
      return null;
    }
  }
}
