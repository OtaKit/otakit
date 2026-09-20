package com.otakit.updater;

import static org.junit.Assert.*;

import java.util.concurrent.CancellationException;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class UpdateOwnerTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  @Test
  public void destroyedPluginCannotPublishOrActivateAnUpdate() throws Exception {
    CoordinatorFixture fixture = new CoordinatorFixture(temporaryFolder.newFolder());
    fixture.installHealthy("A");
    fixture.stage("B");
    UpdateOwner owner = new UpdateOwner(() -> true);
    UpdaterPlugin plugin = new UpdaterPlugin(
      new ForegroundDeadline(() -> 0L, (delay, action) -> () -> {}),
      owner
    );
    owner.run(() -> null); // The worker started while its bridge was alive.
    plugin.handleOnDestroy();
    assertThrows(CancellationException.class, () ->
      owner.run(() -> fixture.coordinator.prepareApplyStaged(b -> true, fixture::isUsable))
    );
    assertThrows(CancellationException.class, () ->
      owner.run(() -> {
        fixture.stage("C");
        return null;
      })
    );
    assertEquals("A", fixture.store.getCurrentBundle().id);
    assertEquals("A", fixture.store.getFallbackBundleId());
    assertEquals("B", fixture.store.getStagedBundleId());
    assertTrue(fixture.indexExists("A"));
    assertFalse(fixture.indexExists("C"));
  }

  @Test
  public void unavailableBridgeCannotPublishEvenBeforeDestroyCallback() throws Exception {
    boolean[] available = { true };
    UpdateOwner owner = new UpdateOwner(() -> available[0]);
    owner.run(() -> null);
    available[0] = false;
    assertThrows(CancellationException.class, () ->
      owner.run(() -> {
        fail("Must not enter state transition");
        return null;
      })
    );
  }

  @Test
  public void liveOwnerCanStageActivateAndConfirm() throws Exception {
    CoordinatorFixture fixture = new CoordinatorFixture(temporaryFolder.newFolder());
    UpdateOwner owner = new UpdateOwner(() -> true);
    owner.run(() -> {
      fixture.installHealthy("A");
      return null;
    });
    assertEquals(BundleStatus.SUCCESS, fixture.store.getCurrentBundle().status);
  }
}
