package com.otakit.updater;

import android.net.Uri;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Preview links (plugin config {@code previewLinks: true}).
 *
 * <p>{@code <scheme>://otakit-preview?token=<token>} opens a preview and {@code
 * <scheme>://otakit-preview?exit=1} ends it. A preview serves one bundle's signed manifest on the
 * hidden channel {@code __preview_<token>}; manifest paths are public, so the token is the
 * capability. Must match Preview.swift and console/lib/preview-links.ts.
 */
final class Preview {

  static final String CHANNEL_PREFIX = "__preview";
  static final String HOST = "otakit-preview";
  /** Local safety net: a preview ends after this long even if its manifest was never removed. */
  static final long MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000;

  private static final Pattern TOKEN = Pattern.compile("[a-z2-7]{26}");

  private Preview() {}

  /** A parsed preview link: a token to start, or an exit request. */
  static final class Link {

    final String token;
    final boolean exit;

    private Link(String token, boolean exit) {
      this.token = token;
      this.exit = exit;
    }
  }

  static Link parse(Uri uri) {
    if (uri == null || uri.getHost() == null || !HOST.equalsIgnoreCase(uri.getHost())) {
      return null;
    }
    if (uri.isOpaque()) return null;
    if ("1".equals(uri.getQueryParameter("exit"))) {
      return new Link(null, true);
    }
    String token = uri.getQueryParameter("token");
    return isToken(token) ? new Link(token, false) : null;
  }

  static boolean isToken(String value) {
    return value != null && TOKEN.matcher(value).matches();
  }

  static String channel(String token) {
    return CHANNEL_PREFIX + "_" + token;
  }

  static boolean isPreviewChannel(String channel) {
    return channel != null && channel.startsWith(CHANNEL_PREFIX);
  }

  /** Device events report preview installs without the token. */
  static String reportedChannel(String channel) {
    return isPreviewChannel(channel) ? CHANNEL_PREFIX : channel;
  }

  /** The active preview, persisted so it survives restarts. */
  static final class State {

    final String token;
    final long startedAtMs;

    State(String token, long startedAtMs) {
      this.token = token;
      this.startedAtMs = startedAtMs;
    }

    String channel() {
      return Preview.channel(token);
    }

    boolean isTooOld(long nowMs) {
      return nowMs - startedAtMs > MAX_AGE_MS;
    }

    String toJson() throws Exception {
      return new JSONObject().put("token", token).put("startedAt", startedAtMs).toString();
    }

    static State fromJson(String json) {
      if (json == null) return null;
      try {
        JSONObject object = new JSONObject(json);
        String token = object.optString("token", null);
        long startedAt = object.optLong("startedAt", -1);
        return isToken(token) && startedAt > 0 ? new State(token, startedAt) : null;
      } catch (Exception error) {
        return null;
      }
    }
  }
}
