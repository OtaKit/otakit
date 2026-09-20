package com.otakit.updater;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.ContextWrapper;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.robolectric.RuntimeEnvironment;

final class CoordinatorFixture {

  final BundleStore store;
  final File root;
  final Context context;
  final UpdaterCoordinator coordinator;
  UpdaterCoordinator.Trial trial;

  CoordinatorFixture(File root) {
    this.root = root;
    context = new ContextWrapper(RuntimeEnvironment.getApplication()) {
      @Override
      public Context getApplicationContext() {
        return this;
      }

      @Override
      public File getFilesDir() {
        return root;
      }
    };
    store = new BundleStore(context, "1.0", "1", null);
    coordinator = new UpdaterCoordinator(store);
  }

  File indexFile(String id) {
    return new File(store.bundleDirectory(id), "index.html");
  }

  boolean indexExists(String id) {
    return indexFile(id).isFile();
  }

  boolean isUsable(BundleInfo bundle) {
    return bundle.isBuiltin() || indexExists(bundle.id);
  }

  interface ThrowingWork {
    void run() throws Exception;
  }

  BundleStore reopenStore() {
    return new BundleStore(context, "1.0", "1", null);
  }

  void withReadOnlyState(ThrowingWork work) throws Exception {
    assertTrue(root.setWritable(false, false));
    try {
      work.run();
    } finally {
      assertTrue(root.setWritable(true, true));
    }
  }

  void withReadOnlyMetadata(String id, ThrowingWork work) throws Exception {
    File directory = store.bundleDirectory(id);
    File metadata = new File(directory, "bundle.json");
    assertTrue(metadata.setWritable(false, false));
    assertTrue(directory.setWritable(false, false));
    try {
      work.run();
    } finally {
      assertTrue(directory.setWritable(true, true));
      assertTrue(metadata.setWritable(true, true));
    }
  }

  void stage(String id) throws Exception {
    File directory = store.bundleDirectory(id);
    assertTrue(directory.mkdirs() || directory.isDirectory());
    Files.write(indexFile(id).toPath(), id.getBytes(StandardCharsets.UTF_8));
    BundleInfo bundle = new BundleInfo(
      id,
      id,
      null,
      BundleStatus.PENDING,
      System.currentTimeMillis(),
      "hash-" + id,
      directory.getAbsolutePath(),
      null,
      "release-" + id
    );
    coordinator.cleanupBundles(coordinator.stageDownloadedBundle(bundle));
  }

  UpdaterCoordinator.ApplyPreparation apply(String id) throws Exception {
    stage(id);
    var result = coordinator.prepareApplyStaged(bundle -> true, this::isUsable);
    if (result.trial != null) trial = result.trial;
    coordinator.cleanupBundles(result.cleanupBundleIds);
    return result;
  }

  void installHealthy(String id) throws Exception {
    assertTrue(apply(id).didApply());
    var ready = coordinator.prepareNotifyAppReady(trial.activationId);
    assertNotNull(ready.eventPayload);
    coordinator.cleanupBundles(ready.cleanupBundleIds);
  }
}
