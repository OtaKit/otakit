package com.otakit.updater;

final class WebViewActivation {

  @FunctionalInterface
  interface PathActivator {
    void activate(String path);
  }

  private WebViewActivation() {}

  static void activate(
    String path,
    String builtinAssetPath,
    PathActivator setServerBasePath,
    PathActivator setServerAssetPath
  ) {
    // Capacitor's Android setters both switch the hosted files and enqueue the
    // WebView navigation. Calling WebView.reload() as well causes two navigations.
    if (path == null || path.isEmpty()) {
      setServerAssetPath.activate(builtinAssetPath);
    } else {
      setServerBasePath.activate(path);
    }
  }
}
