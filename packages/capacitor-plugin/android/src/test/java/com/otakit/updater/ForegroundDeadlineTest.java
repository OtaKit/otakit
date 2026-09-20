package com.otakit.updater;

import static org.junit.Assert.*;

import java.util.ArrayList;
import java.util.List;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ForegroundDeadlineTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  @Test
  public void backgroundTimeDoesNotConsumeRemainingBudget() {
    Clock clock = new Clock();
    ForegroundDeadline deadline = clock.makeDeadline();
    int[] expirations = { 0 };
    deadline.setForeground(true);
    deadline.start(10_000, () -> expirations[0]++);
    Runnable original = clock.last().callback;
    clock.now = 3_000;
    deadline.setForeground(false);
    clock.now = 3_603_000;
    original.run();
    assertEquals(0, expirations[0]);
    deadline.setForeground(true);
    assertEquals(7_000, clock.last().delay);
    clock.now += 7_000;
    clock.last().callback.run();
    assertEquals(1, expirations[0]);
    original.run();
    assertEquals(1, expirations[0]);
  }

  @Test
  public void trialStartedInBackgroundWaitsForForeground() {
    Clock clock = new Clock();
    ForegroundDeadline deadline = clock.makeDeadline();
    boolean[] expired = { false };
    deadline.start(10_000, () -> expired[0] = true);
    clock.now = 1_000_000;
    assertTrue(clock.jobs.isEmpty());
    deadline.setForeground(true);
    assertEquals(10_000, clock.last().delay);
    assertFalse(expired[0]);
    clock.now += 10_000;
    clock.last().callback.run();
    assertTrue(expired[0]);
  }

  @Test
  public void repeatedLifecycleEventsDoNotResetBudget() {
    Clock clock = new Clock();
    ForegroundDeadline deadline = clock.makeDeadline();
    deadline.setForeground(true);
    deadline.start(10_000, () -> {});
    clock.now = 2_000;
    deadline.setForeground(true);
    deadline.setForeground(false);
    clock.now = 50_000;
    deadline.setForeground(false);
    deadline.setForeground(true);
    assertEquals(8_000, clock.last().delay);
    clock.now = 54_000;
    deadline.setForeground(false);
    clock.now = 90_000;
    deadline.setForeground(true);
    assertEquals(4_000, clock.last().delay);
  }

  @Test
  public void cancelledAndReplacedCallbacksCannotExpireNewTrial() {
    Clock clock = new Clock();
    ForegroundDeadline deadline = clock.makeDeadline();
    String[] expired = { "none" };
    deadline.setForeground(true);
    deadline.start(10_000, () -> expired[0] = "A");
    Runnable old = clock.last().callback;
    deadline.cancel();
    deadline.start(10_000, () -> expired[0] = "B");
    clock.now = 10_000;
    old.run();
    assertEquals("none", expired[0]);
    Runnable current = clock.last().callback;
    current.run();
    current.run();
    assertEquals("B", expired[0]);
    deadline.start(10_000, () -> expired[0] = "C");
    Runnable cancelled = clock.last().callback;
    deadline.cancel();
    clock.now = 20_000;
    cancelled.run();
    assertEquals("B", expired[0]);
  }

  @Test
  public void earlySchedulerCallbackWaitsForRemainder() {
    Clock clock = new Clock();
    ForegroundDeadline deadline = clock.makeDeadline();
    boolean[] expired = { false };
    deadline.setForeground(true);
    deadline.start(10_000, () -> expired[0] = true);
    clock.now = 3_000;
    clock.last().callback.run();
    assertFalse(expired[0]);
    assertEquals(7_000, clock.last().delay);
    clock.now = 10_000;
    clock.last().callback.run();
    assertTrue(expired[0]);
  }

  @Test
  public void pluginLifecyclePausesRealTrialAndDestroyCancelsDeadline() throws Exception {
    CoordinatorFixture fixture = new CoordinatorFixture(temporaryFolder.newFolder());
    fixture.installHealthy("A");
    fixture.apply("B");
    var trial = fixture.trial;
    Clock clock = new Clock();
    ForegroundDeadline deadline = clock.makeDeadline();
    UpdaterPlugin plugin = new UpdaterPlugin(deadline);
    plugin.handleOnResume();
    deadline.start(10_000, () -> {
      var rollback = fixture.coordinator.prepareRollback(
        trial,
        "notify_timeout",
        fixture::isUsable
      );
      fixture.coordinator.cleanupBundles(rollback.cleanupBundleIds);
    });
    clock.now = 4_000;
    plugin.handleOnPause();
    clock.now = 600_000;
    clock.last().callback.run();
    assertEquals("B", fixture.store.getCurrentBundle().id);
    assertTrue(fixture.indexExists("A"));
    plugin.handleOnResume();
    assertEquals(6_000, clock.last().delay);
    clock.now = 606_000;
    clock.last().callback.run();
    assertEquals("A", fixture.store.getCurrentBundle().id);
    assertFalse(fixture.indexExists("B"));
    deadline.start(10_000, () -> fail("Destroyed plugin must not run a timeout"));
    Runnable stale = clock.last().callback;
    plugin.handleOnDestroy();
    clock.now += 10_000;
    stale.run();
  }

  private static final class Job {

    final long delay;
    final Runnable callback;

    Job(long delay, Runnable callback) {
      this.delay = delay;
      this.callback = callback;
    }
  }

  private static final class Clock {

    long now;
    final List<Job> jobs = new ArrayList<>();

    Job last() {
      return jobs.get(jobs.size() - 1);
    }

    ForegroundDeadline makeDeadline() {
      return new ForegroundDeadline(
        () -> now,
        (delay, callback) -> {
          jobs.add(new Job(delay, callback));
          return () -> {}; // Deliberately allow tests to deliver stale callbacks.
        }
      );
    }
  }
}
