package com.otakit.updater;

import static org.junit.Assert.*;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class UpdaterCoordinatorTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private CoordinatorFixture fixture;

  @Before
  public void setUp() throws Exception {
    fixture = new CoordinatorFixture(temporaryFolder.newFolder());
  }

  @Test
  public void readinessAcknowledgesOnlyOnce() throws Exception {
    fixture.apply("A");
    var ready = fixture.coordinator.prepareNotifyAppReady();
    assertEquals("applied", ready.eventPayload.action);
    assertEquals(BundleStatus.SUCCESS, fixture.store.getCurrentBundle().status);
    assertNull(fixture.coordinator.prepareNotifyAppReady().eventPayload);
  }

  @Test
  public void timeoutAfterReadinessDoesNotRollBackSuccess() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    var ready = fixture.coordinator.prepareNotifyAppReady();
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds);
    var rollback = fixture.coordinator.prepareRollback(
      fixture.trial,
      "notify_timeout",
      fixture::isUsable
    );
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds);
    assertFalse(rollback.didRollback);
    assertNull(rollback.eventPayload);
    assertEquals("B", fixture.store.getCurrentBundle().id);
    assertEquals(BundleStatus.SUCCESS, fixture.store.getCurrentBundle().status);
    assertTrue(fixture.indexExists("B"));
  }

  @Test
  public void failedReadinessWritePreservesHealthyFallback() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    fixture.withReadOnlyMetadata("B", () -> {
      assertThrows(Exception.class, () -> fixture.coordinator.prepareNotifyAppReady());
      assertEquals(BundleStatus.TRIAL, fixture.store.getCurrentBundle().status);
      assertEquals("A", fixture.store.getFallbackBundle().id);
      assertTrue(fixture.indexExists("A"));
    });
  }

  @Test
  public void failedTrialWriteDoesNotSwitchCurrentBundle() throws Exception {
    fixture.installHealthy("A");
    fixture.stage("B");
    fixture.withReadOnlyMetadata("B", () -> {
      assertThrows(Exception.class, () ->
        fixture.coordinator.prepareApplyStaged(bundle -> true, fixture::isUsable)
      );
      assertEquals("A", fixture.store.getCurrentBundle().id);
      assertEquals("B", fixture.store.getStagedBundleId());
      assertTrue(fixture.indexExists("A"));
    });
  }

  @Test
  public void oldTimeoutDoesNotAffectNewTrial() throws Exception {
    fixture.installHealthy("A");
    var oldTrial = fixture.apply("B").trial;
    var ready = fixture.coordinator.prepareNotifyAppReady();
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds);
    fixture.apply("C");
    var stale = fixture.coordinator.prepareRollback(oldTrial, "notify_timeout", fixture::isUsable);
    assertFalse(stale.didRollback);
    assertTrue(stale.cleanupBundleIds.isEmpty());
    assertEquals("C", fixture.store.getCurrentBundle().id);
    assertEquals(BundleStatus.TRIAL, fixture.store.getCurrentBundle().status);
  }

  @Test
  public void oldTimeoutDoesNotAffectRetryOfSameBundle() throws Exception {
    fixture.installHealthy("A");
    var oldTrial = fixture.apply("B").trial;
    var failed = fixture.coordinator.prepareRollback(oldTrial, "notify_timeout", fixture::isUsable);
    fixture.coordinator.cleanupBundles(failed.cleanupBundleIds);
    var retry = fixture.apply("B").trial;
    assertNotEquals(oldTrial.activationId, retry.activationId);
    var stale = fixture.coordinator.prepareRollback(oldTrial, "notify_timeout", fixture::isUsable);
    assertFalse(stale.didRollback);
    assertEquals("B", fixture.store.getCurrentBundle().id);
    var actual = fixture.coordinator.prepareRollback(retry, "notify_timeout", fixture::isUsable);
    assertTrue(actual.didRollback);
    assertEquals("A", fixture.store.getCurrentBundle().id);
    var duplicate = fixture.coordinator.prepareRollback(retry, "notify_timeout", fixture::isUsable);
    assertFalse(duplicate.didRollback);
  }

  @Test
  public void rollbackRestoresHealthyBundleAndRemovesFailedTrial() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    var rollback = fixture.coordinator.prepareRollback(
      fixture.trial,
      "notify_timeout",
      fixture::isUsable
    );
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds);
    assertTrue(rollback.didRollback);
    assertEquals("A", fixture.store.getCurrentBundle().id);
    assertEquals(BundleStatus.SUCCESS, fixture.store.getCurrentBundle().status);
    assertTrue(fixture.indexExists("A"));
    assertFalse(fixture.indexExists("B"));
    assertEquals(fixture.store.bundleDirectory("A").getAbsolutePath(), rollback.activationPath);
  }

  @Test
  public void startupRejectsIncompleteStagedBundle() throws Exception {
    fixture.installHealthy("A");
    fixture.stage("B");
    assertTrue(fixture.indexFile("B").delete());
    var startup = fixture.coordinator.normalizeStartupState(fixture::isUsable);
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds);
    assertNull(fixture.store.getStagedBundleId());
    assertEquals("A", fixture.store.getCurrentBundle().id);
    assertTrue(fixture.indexExists("A"));
  }

  @Test
  public void secondActivationWaitsForCurrentTrialAndPreservesHealthyFallback() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    var second = fixture.apply("C");
    assertFalse(second.didApply());
    assertEquals("B", fixture.store.getCurrentBundle().id);
    assertEquals("A", fixture.store.getFallbackBundle().id);
    assertEquals("C", fixture.store.getStagedBundleId());
    var rollback = fixture.coordinator.prepareRollback(
      fixture.trial,
      "notify_timeout",
      fixture::isUsable
    );
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds);
    var startup = fixture.coordinator.normalizeStartupState(fixture::isUsable);
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds);
    assertEquals("A", fixture.store.getCurrentBundle().id);
    assertTrue(fixture.indexExists("A"));
  }

  @Test
  public void legacySelfFallbackRestoresBuiltinInsteadOfDeletingActivationTarget()
    throws Exception {
    fixture.apply("B");
    fixture.store.setFallbackBundleId("B");
    var startup = fixture.coordinator.normalizeStartupState(fixture::isUsable);
    fixture.coordinator.cleanupBundles(startup.cleanupBundleIds);
    assertNull(startup.activationPath);
    assertTrue(fixture.store.getCurrentBundle().isBuiltin());
    assertNull(fixture.store.getFallbackBundleId());
  }

  @Test
  public void deferredUpdateCanApplyAfterReadiness() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    assertFalse(fixture.apply("C").didApply());
    var ready = fixture.coordinator.prepareNotifyAppReady();
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds);
    var applied = fixture.coordinator.prepareApplyStaged(bundle -> true, fixture::isUsable);
    assertTrue(applied.didApply());
    assertEquals("C", fixture.store.getCurrentBundle().id);
    assertEquals("B", fixture.store.getFallbackBundle().id);
    assertEquals(BundleStatus.SUCCESS, fixture.store.getFallbackBundle().status);
    assertTrue(fixture.indexExists("B"));
  }

  @Test
  public void rollbackNeverRestoresAnUnconfirmedFallback() throws Exception {
    fixture.apply("B");
    fixture.stage("C");
    fixture.store.setFallbackBundleId("C");
    var rollback = fixture.coordinator.prepareRollback(
      fixture.trial,
      "notify_timeout",
      fixture::isUsable
    );
    fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds);
    assertNull(rollback.activationPath);
    assertTrue(fixture.store.getCurrentBundle().isBuiltin());
  }

  @Test
  public void cleanupRechecksReferencesBeforeDeleting() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    fixture.stage("C");
    fixture.coordinator.cleanupBundles(java.util.Arrays.asList("A", "B", "C", "builtin"));
    assertTrue(fixture.indexExists("A"));
    assertTrue(fixture.indexExists("B"));
    assertTrue(fixture.indexExists("C"));
  }
}
