package com.otakit.updater;

import android.net.Uri;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Remote config (plugin 3.4+): fetch, verify and keep the app's config. Mirrors RemoteConfig.swift;
 * the file format and signature are console/lib/config-files.ts.
 */
final class RemoteConfig {

  static final String BASE_KEY = "__base__";
  /** Config files are at most 16 KiB of values; anything this big is not one. */
  static final int MAX_BYTES = 64 * 1024;

  private RemoteConfig() {}

  static String key(String channel) {
    return channel != null ? channel : BASE_KEY;
  }

  /** A verified config file: one channel's values, or a signed deletion of them. */
  static final class ConfigFile {

    final String appId;
    /** Channel of the file; null for the base channel. */
    final String channel;
    final long version;
    final boolean deleted;
    /** Exactly the signed text: a JSON object. */
    final String valuesJson;
    /** Exactly the signed text: a JSON array, or null without experiments. */
    final String experimentsJson;
    final String updatedAt;

    ConfigFile(
      String appId,
      String channel,
      long version,
      boolean deleted,
      String valuesJson,
      String experimentsJson,
      String updatedAt
    ) {
      this.appId = appId;
      this.channel = channel;
      this.version = version;
      this.deleted = deleted;
      this.valuesJson = valuesJson;
      this.experimentsJson = experimentsJson;
      this.updatedAt = updatedAt;
    }

    JSONObject toJson() throws JSONException {
      JSONObject json = new JSONObject();
      json.put("appId", appId);
      json.put("channel", channel != null ? channel : JSONObject.NULL);
      json.put("version", version);
      json.put("deleted", deleted);
      json.put("valuesJson", valuesJson);
      json.put("experimentsJson", experimentsJson != null ? experimentsJson : JSONObject.NULL);
      json.put("updatedAt", updatedAt != null ? updatedAt : JSONObject.NULL);
      return json;
    }

    static ConfigFile fromJson(JSONObject json) throws JSONException {
      return new ConfigFile(
        json.getString("appId"),
        json.isNull("channel") ? null : json.getString("channel"),
        json.getLong("version"),
        json.getBoolean("deleted"),
        json.getString("valuesJson"),
        json.isNull("experimentsJson") ? null : json.getString("experimentsJson"),
        json.isNull("updatedAt") ? null : json.optString("updatedAt", null)
      );
    }
  }

  static final class InvalidConfigException extends Exception {

    final String reason;

    InvalidConfigException(String reason) {
      super("Invalid remote config: " + reason);
      this.reason = reason;
    }
  }

  /**
   * Parse and verify a config file fetched for {@code channel}. With trusted keys (hosted default
   * or configured) an unsigned or tampered file is refused, as for manifests.
   */
  static ConfigFile parse(
    String payload,
    String appId,
    String channel,
    List<ManifestVerifier.KeyEntry> trustedKeys
  ) throws Exception {
    if (payload.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
      throw new InvalidConfigException("too_large");
    }
    Object root = new JSONTokener(payload).nextValue();
    if (!(root instanceof JSONObject)) throw new InvalidConfigException("invalid_config");
    JSONObject json = (JSONObject) root;
    if (!appId.equals(json.opt("appId"))) throw new InvalidConfigException("wrong_app");
    String fileChannel;
    if (!json.has("channel") || json.isNull("channel")) {
      fileChannel = null;
    } else if (json.get("channel") instanceof String) {
      fileChannel = json.getString("channel");
    } else {
      throw new InvalidConfigException("wrong_channel");
    }
    if (fileChannel == null ? channel != null : !fileChannel.equals(channel)) {
      throw new InvalidConfigException("wrong_channel");
    }
    Object rawVersion = json.opt("version");
    if (!(rawVersion instanceof Integer || rawVersion instanceof Long)) {
      throw new InvalidConfigException("invalid_version");
    }
    long version = ((Number) rawVersion).longValue();
    if (version < 1) throw new InvalidConfigException("invalid_version");
    Object rawDeleted = json.opt("deleted");
    if (rawDeleted != null && !(rawDeleted instanceof Boolean)) {
      throw new InvalidConfigException("invalid_config");
    }
    boolean deleted = rawDeleted != null && (Boolean) rawDeleted;
    Object rawValues = json.opt("valuesJson");
    if (
      !(rawValues instanceof String) ||
      !(new JSONTokener((String) rawValues).nextValue() instanceof JSONObject)
    ) {
      throw new InvalidConfigException("invalid_values");
    }
    String valuesJson = (String) rawValues;
    String experimentsJson = null;
    if (json.has("experimentsJson") && !json.isNull("experimentsJson")) {
      Object rawExperiments = json.get("experimentsJson");
      if (
        !(rawExperiments instanceof String) ||
        !(new JSONTokener((String) rawExperiments).nextValue() instanceof JSONArray)
      ) {
        throw new InvalidConfigException("invalid_experiments");
      }
      experimentsJson = (String) rawExperiments;
    }

    if (trustedKeys == null || trustedKeys.isEmpty()) {
      android.util.Log.w(
        "OtaKit",
        "No manifest signing keys configured — remote config is not verified."
      );
    } else {
      ManifestClient.ManifestSignature signature = ManifestClient.parseSignature(
        json.optJSONObject("signature")
      );
      if (signature == null) throw new InvalidConfigException("missing_signature");
      ManifestVerifier.verifyConfig(
        appId,
        channel,
        version,
        deleted,
        valuesJson,
        experimentsJson,
        signature,
        trustedKeys
      );
    }
    return new ConfigFile(
      appId,
      channel,
      version,
      deleted,
      valuesJson,
      experimentsJson,
      json.isNull("updatedAt") ? null : json.optString("updatedAt", null)
    );
  }

  /** What the app reads: the config of its channel or the base config it falls back to. */
  static final class Snapshot {

    final ConfigFile file;
    /** When the file was last fetched or confirmed unchanged (ms since 1970), or null. */
    final Long fetchedAt;
    /** True when this process fetched or confirmed it; false for the saved copy. */
    final boolean fresh;

    Snapshot(ConfigFile file, Long fetchedAt, boolean fresh) {
      this.file = file;
      this.fetchedAt = fetchedAt;
      this.fresh = fresh;
    }

    boolean differs(Snapshot other) {
      return (
        !equal(valuesJson(), other.valuesJson()) ||
        !equal(
          file != null ? file.experimentsJson : null,
          other.file != null ? other.file.experimentsJson : null
        ) ||
        !equal(
          file != null ? file.version : null,
          other.file != null ? other.file.version : null
        ) ||
        !equal(file != null ? file.channel : null, other.file != null ? other.file.channel : null)
      );
    }

    private String valuesJson() {
      return file != null ? file.valuesJson : null;
    }

    private static boolean equal(Object left, Object right) {
      return left == null ? right == null : left.equals(right);
    }

    /** The shape getConfig, refreshConfig and configChanged pass to JavaScript. */
    Map<String, Object> toMap() {
      Map<String, Object> map = new HashMap<>();
      map.put("valuesJson", file != null ? file.valuesJson : JSONObject.NULL);
      map.put(
        "experimentsJson",
        file != null && file.experimentsJson != null ? file.experimentsJson : JSONObject.NULL
      );
      map.put("version", file != null ? (Object) file.version : JSONObject.NULL);
      map.put("channel", file != null && file.channel != null ? file.channel : JSONObject.NULL);
      map.put("fetchedAt", fetchedAt != null ? isoString(fetchedAt) : JSONObject.NULL);
      map.put("source", file == null ? "none" : fresh ? "remote" : "cache");
      return map;
    }

    private static String isoString(long milliseconds) {
      SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
      format.setTimeZone(TimeZone.getTimeZone("UTC"));
      return format.format(new Date(milliseconds));
    }
  }

  /**
   * Persisted state, one atomic JSON file: the last verified file per source channel, which source
   * each app channel resolved to, and the highest version accepted per source (replay protection
   * survives restarts and deletions).
   */
  static final class State {

    static final class Source {

      ConfigFile file;
      String etag;
      long fetchedAt;

      Source(ConfigFile file, String etag, long fetchedAt) {
        this.file = file;
        this.etag = etag;
        this.fetchedAt = fetchedAt;
      }
    }

    /** The app this state belongs to; another appId starts over. */
    String appId;
    final Map<String, Source> sources = new HashMap<>();
    /** App channel key → the source key it uses, or "" for no config. */
    final Map<String, String> resolved = new HashMap<>();
    final Map<String, Long> maxVersions = new HashMap<>();
    long lastFetchAt = 0;

    JSONObject toJson() throws JSONException {
      JSONObject json = new JSONObject();
      JSONObject sourcesJson = new JSONObject();
      for (Map.Entry<String, Source> entry : sources.entrySet()) {
        JSONObject source = new JSONObject();
        source.put("file", entry.getValue().file.toJson());
        source.put("etag", entry.getValue().etag != null ? entry.getValue().etag : JSONObject.NULL);
        source.put("fetchedAt", entry.getValue().fetchedAt);
        sourcesJson.put(entry.getKey(), source);
      }
      json.put("sources", sourcesJson);
      json.put("resolved", new JSONObject(resolved));
      json.put("maxVersions", new JSONObject(maxVersions));
      json.put("lastFetchAt", lastFetchAt);
      json.put("appId", appId != null ? appId : JSONObject.NULL);
      return json;
    }

    static State fromJson(JSONObject json) throws JSONException {
      State state = new State();
      JSONObject sourcesJson = json.optJSONObject("sources");
      if (sourcesJson != null) {
        for (Iterator<String> keys = sourcesJson.keys(); keys.hasNext(); ) {
          String key = keys.next();
          JSONObject source = sourcesJson.getJSONObject(key);
          state.sources.put(
            key,
            new Source(
              ConfigFile.fromJson(source.getJSONObject("file")),
              source.isNull("etag") ? null : source.optString("etag", null),
              source.optLong("fetchedAt", 0)
            )
          );
        }
      }
      JSONObject resolvedJson = json.optJSONObject("resolved");
      if (resolvedJson != null) {
        for (Iterator<String> keys = resolvedJson.keys(); keys.hasNext(); ) {
          String key = keys.next();
          state.resolved.put(key, resolvedJson.getString(key));
        }
      }
      JSONObject maxJson = json.optJSONObject("maxVersions");
      if (maxJson != null) {
        for (Iterator<String> keys = maxJson.keys(); keys.hasNext(); ) {
          String key = keys.next();
          state.maxVersions.put(key, maxJson.getLong(key));
        }
      }
      state.lastFetchAt = json.optLong("lastFetchAt", 0);
      state.appId = json.isNull("appId") ? null : json.optString("appId", null);
      return state;
    }
  }

  static final class Store {

    private final AtomicFile file;

    Store(File directory) {
      //noinspection ResultOfMethodCallIgnored
      directory.mkdirs();
      file = new AtomicFile(new File(directory, "state.json"));
    }

    /**
     * An unreadable file starts over: config falls back to code defaults until the next fetch,
     * which is safer than trusting a damaged copy.
     */
    State load() {
      try {
        return State.fromJson(new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8)));
      } catch (Exception error) {
        return new State();
      }
    }

    void save(State state) throws Exception {
      byte[] bytes = state.toJson().toString().getBytes(StandardCharsets.UTF_8);
      FileOutputStream output = null;
      try {
        output = file.startWrite();
        output.write(bytes);
        output.getFD().sync();
        file.finishWrite(output);
        output = null;
      } catch (Exception error) {
        if (output != null) file.failWrite(output);
        throw error;
      }
    }
  }

  /** One HTTP GET; a seam so tests can answer without a network. */
  interface Transport {
    Response get(URL url, String etag) throws IOException;
  }

  static final class Response {

    final int status;
    final String body;
    final String etag;

    Response(int status, String body, String etag) {
      this.status = status;
      this.body = body;
      this.etag = etag;
    }
  }

  static final class HttpTransport implements Transport {

    @Override
    public Response get(URL url, String etag) throws IOException {
      HttpURLConnection connection = (HttpURLConnection) url.openConnection();
      try {
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(15_000);
        connection.setUseCaches(false);
        if (etag != null) connection.setRequestProperty("If-None-Match", etag);
        int status = connection.getResponseCode();
        String body = "";
        if (status == 200) body = read(connection.getInputStream());
        return new Response(status, body, connection.getHeaderField("ETag"));
      } finally {
        connection.disconnect();
      }
    }

    private static String read(InputStream input) throws IOException {
      try (InputStream stream = input) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = stream.read(buffer)) != -1) {
          out.write(buffer, 0, read);
          if (out.size() > MAX_BYTES) throw new IOException("Remote config is too large");
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
      }
    }
  }

  static final class Context {

    final String cdnUrl;
    final String appId;
    /** The app's channel (setChannel override, else configured); null for base. */
    final String channel;
    final List<ManifestVerifier.KeyEntry> trustedKeys;
    final boolean allowInsecureUrls;

    Context(
      String cdnUrl,
      String appId,
      String channel,
      List<ManifestVerifier.KeyEntry> trustedKeys,
      boolean allowInsecureUrls
    ) {
      this.cdnUrl = cdnUrl;
      this.appId = appId;
      this.channel = channel;
      this.trustedKeys = trustedKeys;
      this.allowInsecureUrls = allowInsecureUrls;
    }
  }

  static final class RefreshResult {

    final Snapshot snapshot;
    final boolean changed;
    final String error;

    RefreshResult(Snapshot snapshot, boolean changed, String error) {
      this.snapshot = snapshot;
      this.changed = changed;
      this.error = error;
    }
  }

  /** Fetches, verifies and keeps the app's remote config. Refreshes run one at a time. */
  /**
   * Fetches, verifies and keeps the app's remote config. Refreshes run one at a time on the
   * plugin's config executor. The state lock is held only to read and apply state, never during
   * a network call, so getConfig() answers at once even while a slow fetch runs.
   */
  static final class Client {

    private final Store store;
    private final Transport transport;
    private final Object lock = new Object();
    private State state;
    /** Source keys fetched or confirmed in this process. */
    private final Set<String> freshSources = new HashSet<>();

    Client(Store store, Transport transport) {
      this.store = store;
      this.transport = transport;
      this.state = store.load();
    }

    /** The config the app sees now, without any network access. */
    Snapshot snapshot(String appId, String channel) {
      synchronized (lock) {
        return snapshotLocked(appId, channel);
      }
    }

    private Snapshot snapshotLocked(String appId, String channel) {
      if (state.appId != null && !state.appId.equals(appId)) return new Snapshot(null, null, false);
      String appKey = key(channel);
      String sourceKey;
      if (state.resolved.containsKey(appKey)) {
        String resolved = state.resolved.get(appKey);
        sourceKey = resolved == null || resolved.isEmpty() ? null : resolved;
      } else {
        // Never fetched for this channel (for example right after setChannel): most channels use
        // the base config, so show that until the fetch.
        sourceKey = state.sources.containsKey(BASE_KEY) ? BASE_KEY : null;
      }
      State.Source source = sourceKey != null ? state.sources.get(sourceKey) : null;
      if (source == null || !source.file.appId.equals(appId) || source.file.deleted) {
        return new Snapshot(null, null, false);
      }
      return new Snapshot(source.file, source.fetchedAt, freshSources.contains(sourceKey));
    }

    /** Whether a resume should skip fetching because the last one was recent. */
    boolean shouldSkip(long intervalMs) {
      synchronized (lock) {
        if (intervalMs <= 0 || state.lastFetchAt <= 0) return false;
        return System.currentTimeMillis() - state.lastFetchAt < intervalMs;
      }
    }

    RefreshResult refresh(Context context) {
      Snapshot before;
      synchronized (lock) {
        if (state.appId == null || !state.appId.equals(context.appId)) {
          // Another app on this install: no file or version counter carries over.
          state = new State();
          state.appId = context.appId;
          freshSources.clear();
        }
        before = snapshotLocked(context.appId, context.channel);
      }
      String error = null;
      String appKey = key(context.channel);
      try {
        String resolvedKey = null;
        if (context.channel != null) {
          State.Source own = fetchSource(context.channel, context);
          if (own != null && !own.file.deleted) {
            resolvedKey = key(context.channel);
          } else {
            // No config of its own (or a signed deletion): use the base copy already on the
            // device even if the base fetch below fails.
            synchronized (lock) {
              state.resolved.put(appKey, BASE_KEY);
            }
          }
        }
        if (resolvedKey == null) {
          State.Source base = fetchSource(null, context);
          resolvedKey = base != null && !base.file.deleted ? BASE_KEY : "";
        }
        synchronized (lock) {
          state.resolved.put(appKey, resolvedKey);
        }
      } catch (Exception failure) {
        error = describe(failure);
        android.util.Log.w("OtaKit", "Remote config refresh failed: " + error);
      }
      Snapshot after;
      synchronized (lock) {
        state.lastFetchAt = System.currentTimeMillis();
        try {
          store.save(state);
        } catch (Exception saveError) {
          android.util.Log.w("OtaKit", "Cannot save remote config", saveError);
        }
        after = snapshotLocked(context.appId, context.channel);
      }
      return new RefreshResult(after, after.differs(before), error);
    }

    /**
     * Fetch one source's file and update the state. Returns the source's current entry, or null
     * when it has never had a file.
     */
    private State.Source fetchSource(String channel, Context context) throws Exception {
      String sourceKey = key(channel);
      State.Source known;
      synchronized (lock) {
        known = state.sources.get(sourceKey);
        if (known != null && !known.file.appId.equals(context.appId)) known = null;
      }
      // Unlocked: the network may take many seconds.
      Response response = transport.get(url(channel, context), known != null ? known.etag : null);
      ConfigFile parsed =
        response.status == 200
          ? parse(response.body, context.appId, channel, context.trustedKeys)
          : null;
      long now = System.currentTimeMillis();
      synchronized (lock) {
        switch (response.status) {
          case 200: {
            Long max = state.maxVersions.get(sourceKey);
            if (max != null && parsed.version < max) {
              // An older file than one already accepted: a stale cache or a replay.
              android.util.Log.w(
                "OtaKit",
                "Ignoring remote config version " +
                  parsed.version +
                  " for " +
                  sourceKey +
                  ": already saw " +
                  max
              );
              return known;
            }
            state.maxVersions.put(
              sourceKey,
              max != null ? Math.max(max, parsed.version) : parsed.version
            );
            State.Source source = new State.Source(parsed, response.etag, now);
            state.sources.put(sourceKey, source);
            freshSources.add(sourceKey);
            return source;
          }
          case 304:
            if (known == null) return null;
            known.fetchedAt = now;
            freshSources.add(sourceKey);
            return known;
          case 403:
          case 404:
            // The server writes a signed deletion instead of removing a file, so a missing file
            // the device has seen before is not trusted to mean "gone". (R2 answers 403 without
            // list access.)
            if (known != null) {
              android.util.Log.w(
                "OtaKit",
                "Remote config for " + sourceKey + " is missing; keeping the last verified copy"
              );
            }
            return known;
          default:
            throw new IOException("http_" + response.status);
        }
      }
    }

    private static URL url(String channel, Context context) throws Exception {
      String base = context.cdnUrl.replaceAll("/+$", "");
      Uri baseUri = Uri.parse(base);
      if (baseUri.getScheme() == null || baseUri.getHost() == null) {
        throw new IllegalStateException("Invalid CDN URL");
      }
      URL url = new URL(
        baseUri
          .buildUpon()
          .appendPath("config")
          .appendPath(context.appId)
          .appendPath(key(channel))
          .appendPath("config.json")
          .build()
          .toString()
      );
      ManifestClient.requireHTTPS(url, context.allowInsecureUrls);
      return url;
    }

    private static String describe(Exception error) {
      if (error instanceof InvalidConfigException) {
        String reason = ((InvalidConfigException) error).reason;
        return "too_large".equals(reason) || "missing_signature".equals(reason)
          ? reason
          : "invalid_config";
      }
      if (error instanceof ManifestVerifier.VerificationException) return "signature_invalid";
      if (error instanceof JSONException) return "invalid_config";
      if (error instanceof IllegalStateException) return "insecure_url";
      String message = error.getMessage();
      if (message != null && message.startsWith("http_")) return message;
      return "network_error";
    }
  }
}
