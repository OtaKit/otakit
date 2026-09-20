package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class BundlePersistenceTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private CoordinatorFixture fixture;

  @Before
  public void setUp() throws Exception {
    fixture = new CoordinatorFixture(temporaryFolder.newFolder());
  }

  @Test
  public void failedActivationCommitSurvivesRestartAndCanRetry() throws Exception {
    fixture.installHealthy("A");
    fixture.stage("B");
    fixture.withReadOnlyState(() -> {
      assertThrows(Exception.class, () ->
        fixture.coordinator.prepareApplyStaged(b -> true, fixture::isUsable)
      );
      assertEquals(BundleStatus.TRIAL, fixture.store.getBundle("B").status);
    });
    var reopened = fixture.reopenStore();
    assertEquals("A", reopened.getCurrentBundle().id);
    assertEquals("A", reopened.getFallbackBundle().id);
    assertEquals("B", reopened.getStagedBundleId());
    var coordinator = new UpdaterCoordinator(reopened);
    var startup = coordinator.normalizeStartupState(fixture::isUsable);
    assertNull(startup.eventPayload);
    assertEquals(reopened.bundleDirectory("A").getAbsolutePath(), startup.activationPath);
    assertTrue(coordinator.prepareApplyStaged(b -> true, fixture::isUsable).didApply());
  }

  @Test
  public void failedReadinessCommitKeepsFallbackAndCanRetryExactlyOnce() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    fixture.withReadOnlyState(() -> {
      assertThrows(Exception.class, () ->
        fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId)
      );
      assertEquals(BundleStatus.SUCCESS, fixture.store.getCurrentBundle().status);
      assertEquals("A", fixture.reopenStore().getFallbackBundle().id);
      assertTrue(fixture.indexExists("A"));
    });
    var ready = fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId);
    assertEquals("applied", ready.eventPayload.action);
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds);
    assertFalse(fixture.indexExists("A"));
    assertTrue(fixture.indexExists("B"));
    assertNull(fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId).eventPayload);
  }

  @Test
  public void failedRollbackCommitKeepsBothBundlesAndCanRetry() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    var trial = fixture.trial;
    fixture.withReadOnlyState(() -> {
      assertThrows(Exception.class, () ->
        fixture.coordinator.prepareRollback(trial, "notify_timeout", fixture::isUsable)
      );
      var reopened = fixture.reopenStore();
      assertEquals("B", reopened.getCurrentBundle().id);
      assertEquals(BundleStatus.TRIAL, reopened.getCurrentBundle().status);
      assertEquals("A", reopened.getFallbackBundle().id);
      assertNull(reopened.getLastFailedBundle());
      assertTrue(fixture.indexExists("A"));
      assertTrue(fixture.indexExists("B"));
    });
    var rollback = fixture.coordinator.prepareRollback(trial, "notify_timeout", fixture::isUsable);
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds);
    assertTrue(rollback.didRollback);
    var reopened = fixture.reopenStore();
    assertEquals("A", reopened.getCurrentBundle().id);
    assertEquals("B", reopened.getLastFailedBundle().id);
    assertEquals(BundleStatus.ERROR, reopened.getLastFailedBundle().status);
    assertTrue(fixture.indexExists("A"));
    assertFalse(fixture.indexExists("B"));
  }

  @Test
  public void legacyPreferencesMigrateOnFirstWrite() throws Exception {
    assertTrue(
      fixture.store
        .getPrefs()
        .edit()
        .putString("current_bundle_id", "A")
        .putString("fallback_bundle_id", "A")
        .putString("staged_bundle_id", "B")
        .commit()
    );
    assertEquals("A", fixture.store.getCurrentBundleId());
    fixture.store.setStagedBundleId("C");
    assertTrue(fixture.store.getPrefs().edit().putString("current_bundle_id", "obsolete").commit());
    var reopened = fixture.reopenStore();
    assertEquals("A", reopened.getCurrentBundleId());
    assertEquals("A", reopened.getFallbackBundleId());
    assertEquals("C", reopened.getStagedBundleId());
  }

  @Test
  public void corruptStateCannotAuthorizeMutationOrCleanup() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    Files.write(
      new File(fixture.root, "otakit-state.json").toPath(),
      "{truncated".getBytes(StandardCharsets.UTF_8)
    );
    assertThrows(Exception.class, () ->
      fixture.coordinator.normalizeStartupState(fixture::isUsable)
    );
    assertThrows(Exception.class, () -> fixture.store.setCurrentBundleId("C"));
    fixture.coordinator.cleanupBundles(Arrays.asList("A", "B"));
    assertTrue(fixture.indexExists("A"));
    assertTrue(fixture.indexExists("B"));
  }

  @Test
  public void metadataRecoversLegacyAtomicFileBackup() throws Exception {
    fixture.installHealthy("A");
    File metadata = new File(fixture.store.bundleDirectory("A"), "bundle.json");
    Files.move(metadata.toPath(), new File(metadata.getPath() + ".bak").toPath());
    Files.write(metadata.toPath(), "{interrupted".getBytes(StandardCharsets.UTF_8));
    assertEquals(BundleStatus.SUCCESS, fixture.reopenStore().getBundle("A").status);
  }
}
