package com.otakit.updater;

import static org.junit.Assert.*;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.WebViewCompat;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DocumentReadyBridgeTest {

  @Test
  public void documentKeepsItsActivationAcrossReplacementWithRealCapacitorBridge()
    throws Exception {
    var instrumentation = InstrumentationRegistry.getInstrumentation();
    var context = instrumentation.getTargetContext();
    String nativeBridge;
    try (InputStream input = context.getAssets().open("native-bridge.js")) {
      java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int count;
      while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
      nativeBridge = bytes.toString(StandardCharsets.UTF_8.name());
    }
    Recorder recorder = new Recorder();
    AtomicReference<WebView> view = new AtomicReference<>();
    DocumentReadyBridge guard = new DocumentReadyBridge();
    String readyJS = "Capacitor.nativePromise('OtaKit', 'notifyAppReady', {}).catch(() => {});";
    String html = "<html><script>" + readyJS + "</script></html>";
    try {
      instrumentation.runOnMainSync(() -> {
        WebView webView = new WebView(context);
        view.set(webView);
        webView.getSettings().setJavaScriptEnabled(true);
        DocumentReadyBridge.preflight(webView, "https://localhost");
        webView.addJavascriptInterface(recorder, "androidBridge");
        WebViewCompat.addDocumentStartJavaScript(
          webView,
          nativeBridge,
          Collections.singleton("https://localhost")
        );
        guard.install(webView, "https://localhost", "activation-A");
        webView.loadDataWithBaseURL("https://localhost", html, "text/html", "utf-8", null);
      });
      assertEquals("activation-A", recorder.awaitReady());

      recorder.reset();
      instrumentation.runOnMainSync(() -> {
        guard.install(view.get(), "https://localhost", "activation-B");
        view.get().evaluateJavascript(readyJS + "'sent';", null);
      });
      assertEquals(
        "The old document must retain A after B is prepared",
        "activation-A",
        recorder.awaitReady()
      );

      recorder.reset();
      instrumentation.runOnMainSync(() ->
        view.get().loadDataWithBaseURL("https://localhost", html, "text/html", "utf-8", null)
      );
      assertEquals("activation-B", recorder.awaitReady());
    } finally {
      instrumentation.runOnMainSync(() -> {
        if (view.get() != null) view.get().destroy();
      });
    }
  }

  public static final class Recorder {

    private volatile CountDownLatch ready = new CountDownLatch(1);
    private volatile String activationId;
    private volatile Exception failure;

    @JavascriptInterface
    public void postMessage(String message) {
      try {
        JSONObject data = new JSONObject(message);
        if (!"notifyAppReady".equals(data.optString("methodName"))) return;
        activationId = data.getJSONObject("options").optString("_otakitActivationId", null);
      } catch (Exception error) {
        failure = error;
      }
      ready.countDown();
    }

    void reset() {
      activationId = null;
      failure = null;
      ready = new CountDownLatch(1);
    }

    String awaitReady() throws Exception {
      assertTrue(
        "Capacitor readiness message was not delivered",
        ready.await(15, TimeUnit.SECONDS)
      );
      if (failure != null) throw failure;
      return activationId;
    }
  }
}
