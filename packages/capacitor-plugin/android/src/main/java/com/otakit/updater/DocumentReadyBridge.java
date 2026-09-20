package com.otakit.updater;

import android.net.Uri;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import org.json.JSONObject;

/** Captures the activation in the document's bridge before application JavaScript runs. */
final class DocumentReadyBridge {

  private ScriptHandler script;

  static void requireSupported() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      throw new IllegalStateException(
        "Update Android System WebView before applying OtaKit updates: document-start scripts are unavailable"
      );
    }
  }

  private static String origin(String appUrl) {
    return Uri.parse(appUrl).buildUpon().path(null).fragment(null).clearQuery().build().toString();
  }

  static void preflight(WebView webView, String appUrl) {
    requireSupported();
    // Validate this WebView and origin before publishing a trial in persistent state.
    WebViewCompat.addDocumentStartJavaScript(
      webView,
      "",
      Collections.singleton(origin(appUrl))
    ).remove();
  }

  static String source(String activationId) {
    return String.format(
      java.util.Locale.ROOT,
      """
      (() => {
        if (window !== window.top) return;
        const cap = window.Capacitor;
        if (!cap || typeof cap.toNative !== 'function') return;
        const original = cap.toNative;
        const activationId = %s;
        cap.toNative = function(plugin, method, options, callback) {
          if (plugin === 'OtaKit' && method === 'notifyAppReady') {
            options = Object.assign({}, options, { _otakitActivationId: activationId });
          }
          return original.call(this, plugin, method, options, callback);
        };
      })();
      """,
      JSONObject.quote(activationId)
    );
  }

  void install(WebView webView, String appUrl, String activationId) {
    requireSupported();
    // Register before removing the old script so registration failure preserves it.
    ScriptHandler replacement = WebViewCompat.addDocumentStartJavaScript(
      webView,
      source(activationId),
      Collections.singleton(origin(appUrl))
    );
    if (script != null) script.remove();
    script = replacement;
  }
}
