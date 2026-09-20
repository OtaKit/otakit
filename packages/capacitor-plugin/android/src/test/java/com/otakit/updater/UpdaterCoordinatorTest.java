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
  public void rollbackRestoresHealthyBundleAndRemovesFailedTrial() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    var rollback = fixture.coordinator.prepareRollback("notify_timeout", fixture::isUsable);
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
}
