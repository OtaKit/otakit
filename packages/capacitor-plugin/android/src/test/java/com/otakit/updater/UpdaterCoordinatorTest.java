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
  public void telemetryKeepsInstallationIdentityAcrossReadinessAndRestartRollback()
    throws Exception {
    String installed = BundleStore.newInstallationId();
    fixture.apply(installed);
    var applied = fixture.coordinator.prepareNotifyAppReady(
      fixture.trial.activationId
    ).eventPayload;
    assertEquals(installed, applied.attemptId);
    assertEquals("readiness", applied.phase);
    assertEquals(installed, fixture.reopenStore().getCurrentBundle().attemptId());
    String failed = BundleStore.newInstallationId();
    fixture.apply(failed);
    var restarted = new UpdaterCoordinator(fixture.reopenStore());
    var startup = restarted.normalizeStartupState(fixture::isUsable);
    assertEquals(failed, startup.eventPayload.attemptId);
    assertEquals("rollback", startup.eventPayload.phase);
  }

  @Test
  public void legacyBundleDoesNotInventAnAttemptIdentity() throws Exception {
    fixture.apply("legacy-release");
    assertNull(
      fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId).eventPayload.attemptId
    );
  }

  @Test
  public void readinessAcknowledgesOnlyOnce() throws Exception {
    fixture.apply("A");
    var ready = fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId);
    assertEquals("applied", ready.eventPayload.action);
    assertEquals(BundleStatus.SUCCESS, fixture.store.getCurrentBundle().status);
    assertNull(fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId).eventPayload);
  }

  @Test
  public void stagingCannotOverwriteReferencedBundleMetadata() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    fixture.stage("C");
    for (String id : new String[] { "A", "B", "C" }) {
      var existing = fixture.store.getBundle(id);
      assertThrows(Exception.class, () ->
        fixture.coordinator.stageDownloadedBundle(existing.withStatus(BundleStatus.ERROR))
      );
      assertEquals(existing.status, fixture.store.getBundle(id).status);
      assertTrue(fixture.indexExists(id));
    }
    assertEquals("B", fixture.store.getCurrentBundleId());
    assertEquals("A", fixture.store.getFallbackBundleId());
    assertEquals("C", fixture.store.getStagedBundleId());
    var rollback = fixture.coordinator.prepareRollback(
      fixture.trial,
      "notify_timeout",
      fixture::isUsable
    );
    assertEquals(fixture.store.bundleDirectory("A").getAbsolutePath(), rollback.activationPath);
  }

  @Test
  public void oldOrUntaggedDocumentCannotConfirmNewTrial() throws Exception {
    fixture.installHealthy("A");
    String oldDocument = fixture.trial.activationId;
    fixture.apply("B");
    for (String identity : new String[] { oldDocument, null }) {
      var stale = fixture.coordinator.prepareNotifyAppReady(identity);
      assertNull(stale.eventPayload);
      assertTrue(stale.cleanupBundleIds.isEmpty());
      assertEquals(BundleStatus.TRIAL, fixture.store.getCurrentBundle().status);
      assertEquals("A", fixture.store.getFallbackBundleId());
    }
    assertNotNull(
      fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId).eventPayload
    );
  }

  @Test
  public void timeoutAfterReadinessDoesNotRollBackSuccess() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    var ready = fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId);
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
  public void freshInstallationIdPreservesReleaseMatching() throws Exception {
    String first = BundleStore.newInstallationId();
    String second = BundleStore.newInstallationId();
    assertNotEquals(first, second);
    fixture.installHealthy(first);
    var latest = new ManifestClient.LatestManifest(
      first,
      null,
      "hash-" + first,
      0,
      null,
      "release-" + first,
      "zip",
      false,
      null,
      null
    );
    assertEquals(
      "no_update",
      fixture.coordinator.classifyLatestManifest(latest, null, fixture::isUsable).kind
    );
    fixture.apply("B");
    fixture.stage(second);
    var incoming = new BundleInfo(
      second,
      first,
      null,
      BundleStatus.PENDING,
      System.currentTimeMillis(),
      latest.sha256,
      fixture.store.bundleDirectory(second).getAbsolutePath(),
      null,
      latest.releaseId
    );
    fixture.store.saveBundle(incoming);
    var classification = fixture.coordinator.classifyLatestManifest(
      latest,
      null,
      fixture::isUsable
    );
    assertEquals("already_staged", classification.kind);
    assertEquals(second, classification.bundle.id);
    assertEquals(BundleStatus.SUCCESS, fixture.store.getBundle(first).status);
    assertTrue(fixture.indexExists(first));
  }

  @Test
  public void failedStagingCleanupPreservesCurrentAndSuccessfulStaging() throws Exception {
    fixture.installHealthy("A");
    String orphan = BundleStore.newInstallationId();
    fixture.withReadOnlyState(() -> assertThrows(Exception.class, () -> fixture.stage(orphan)));
    fixture.coordinator.cleanupBundles(java.util.Collections.singletonList(orphan));
    assertFalse(fixture.indexExists(orphan));
    assertTrue(fixture.indexExists("A"));
    String staged = BundleStore.newInstallationId();
    fixture.stage(staged);
    fixture.coordinator.cleanupBundles(java.util.Collections.singletonList(staged));
    assertTrue(fixture.indexExists(staged));
    assertEquals(staged, fixture.store.getStagedBundleId());
  }

  @Test
  public void failedReadinessWritePreservesHealthyFallback() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    fixture.withReadOnlyMetadata("B", () -> {
      assertThrows(Exception.class, () ->
        fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId)
      );
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
    var ready = fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId);
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
    var ready = fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId);
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
