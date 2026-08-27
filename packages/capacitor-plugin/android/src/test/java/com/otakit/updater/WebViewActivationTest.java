package com.otakit.updater;

import static org.junit.Assert.assertEquals;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class WebViewActivationTest {

  @Test
  public void activatesDownloadedBundleExactlyOnce() {
    ActivationRecorder recorder = new ActivationRecorder();

    WebViewActivation.activate(
      "/data/user/0/app/files/bundle",
      "public",
      recorder::setServerBasePath,
      recorder::setServerAssetPath
    );

    assertEquals(1, recorder.totalActivations());
    assertEquals(1, recorder.basePathActivations.get());
    assertEquals(0, recorder.assetPathActivations.get());
    assertEquals("/data/user/0/app/files/bundle", recorder.lastPath.get());
  }

  @Test
  public void activatesBuiltinBundleExactlyOnceForNullPath() {
    assertBuiltinActivation(null);
  }

  @Test
  public void activatesBuiltinBundleExactlyOnceForEmptyPath() {
    assertBuiltinActivation("");
  }

  private void assertBuiltinActivation(String path) {
    ActivationRecorder recorder = new ActivationRecorder();

    WebViewActivation.activate(
      path,
      "public",
      recorder::setServerBasePath,
      recorder::setServerAssetPath
    );

    assertEquals(1, recorder.totalActivations());
    assertEquals(0, recorder.basePathActivations.get());
    assertEquals(1, recorder.assetPathActivations.get());
    assertEquals("public", recorder.lastPath.get());
  }

  private static final class ActivationRecorder {

    final AtomicInteger basePathActivations = new AtomicInteger();
    final AtomicInteger assetPathActivations = new AtomicInteger();
    final AtomicReference<String> lastPath = new AtomicReference<>();

    void setServerBasePath(String path) {
      basePathActivations.incrementAndGet();
      lastPath.set(path);
    }

    void setServerAssetPath(String path) {
      assetPathActivations.incrementAndGet();
      lastPath.set(path);
    }

    int totalActivations() {
      return basePathActivations.get() + assetPathActivations.get();
    }
  }
}
