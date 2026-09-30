package com.otakit.updater;

import static org.junit.Assert.*;

import android.net.Uri;
import java.util.Arrays;
import java.util.HashSet;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Preview link parsing and state must match Preview.swift and console/lib/preview-links.ts.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PreviewTest {

  private static final String TOKEN = "abcdefghijklmnopqrstuvwxyz";

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private CoordinatorFixture fixture;

  @Before
  public void setUp() throws Exception {
    fixture = new CoordinatorFixture(temporaryFolder.newFolder());
  }

  private static Preview.Link link(String url) {
    return Preview.parse(Uri.parse(url));
  }

  @Test
  public void parsesStartAndExitLinksOnAnyScheme() {
    assertEquals(TOKEN, link("myapp://otakit-preview?token=" + TOKEN).token);
    assertEquals(TOKEN, link("com.example.app://OTAKIT-PREVIEW?utm=x&token=" + TOKEN).token);
    assertTrue(link("myapp://otakit-preview?exit=1").exit);
    assertTrue(link("myapp://otakit-preview?exit=1&token=" + TOKEN).exit);
    assertFalse(link("myapp://otakit-preview?token=" + TOKEN).exit);
  }

  @Test
  public void ignoresEveryOtherLink() {
    for (String url : new String[] {
      "myapp://otakit-preview",
      "myapp://otakit-preview?token=",
      "myapp://otakit-preview?token=ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "myapp://otakit-preview?token=" + TOKEN + "a",
      "myapp://otakit-preview?token=abc0efghijklmnopqrstuvwxyz",
      "myapp://otakit-preview?exit=0",
      "myapp://other?token=" + TOKEN,
      "https://example.com/otakit-preview?token=" + TOKEN,
      "myapp:otakit-preview?token=" + TOKEN,
      "myapp://checkout?order=1",
    }) {
      assertNull(url, link(url));
    }
    assertNull(Preview.parse(null));
  }

  @Test
  public void namesTheHiddenChannelAndKeepsTheTokenOutOfEvents() {
    String channel = Preview.channel(TOKEN);
    assertEquals("__preview_abcdefghijklmnopqrstuvwxyz", channel);
    assertTrue(Preview.isPreviewChannel(channel));
    assertFalse(Preview.isPreviewChannel("production"));
    assertFalse(Preview.isPreviewChannel(null));
    for (String lookalike : new String[] {
      "__preview",
      "__previews",
      "__preview-qa",
      "__preview_short",
    }) {
      assertFalse(lookalike, Preview.isPreviewChannel(lookalike));
      assertEquals(lookalike, Preview.reportedChannel(lookalike));
    }
    assertEquals("__preview", Preview.reportedChannel(channel));
    assertEquals("production", Preview.reportedChannel("production"));
    assertNull(Preview.reportedChannel(null));
  }

  @Test
  public void previewStatePersistsAndExpiresLocallyAfterThirtyDays() {
    long startedAt = 1_790_000_000_000L;
    Preview.State state = new Preview.State(TOKEN, startedAt);

    assertNull(fixture.store.getPreview());
    fixture.store.setPreview(state);
    Preview.State reopened = fixture.reopenStore().getPreview();
    assertEquals(TOKEN, reopened.token);
    assertEquals(startedAt, reopened.startedAtMs);
    assertEquals(Preview.channel(TOKEN), reopened.channel());
    assertFalse(state.isTooOld(startedAt + 29L * 24 * 60 * 60 * 1000));
    assertTrue(state.isTooOld(startedAt + 31L * 24 * 60 * 60 * 1000));

    fixture.store.setPreview(null);
    assertNull(fixture.reopenStore().getPreview());
  }

  @Test
  public void ignoresCorruptStoredState() {
    assertNull(Preview.State.fromJson("{not json"));
    assertNull(Preview.State.fromJson("{\"token\":\"short\",\"startedAt\":1}"));
    assertNull(Preview.State.fromJson("{\"token\":\"" + TOKEN + "\"}"));
    assertNull(Preview.State.fromJson(null));
  }

  private static final String PREVIEW_CHANNEL = Preview.channel(TOKEN);

  @Test
  public void aHealthyPreviewKeepsTheBundleFromBeforeItAsFallback() throws Exception {
    fixture.installHealthy("A");
    fixture.installHealthy("P", PREVIEW_CHANNEL);

    assertEquals("P", fixture.store.getCurrentBundle().id);
    assertEquals("A", fixture.store.getFallbackBundle().id);
    assertTrue(fixture.indexExists("A"));
  }

  @Test
  public void leavingAPreviewReturnsToTheBundleFromBeforeIt() throws Exception {
    fixture.installHealthy("A");
    fixture.installHealthy("P", PREVIEW_CHANNEL);
    fixture.stage("Q", PREVIEW_CHANNEL);

    UpdaterCoordinator.LeavePreviewPreparation leave = fixture.coordinator.prepareLeavePreview(
      fixture::isUsable
    );

    assertEquals(fixture.store.getBundle("A").path, leave.activationPath);
    assertEquals(new HashSet<>(Arrays.asList("P", "Q")), new HashSet<>(leave.cleanupBundleIds));
    assertEquals("A", fixture.store.getCurrentBundle().id);
    assertEquals("A", fixture.store.getFallbackBundle().id);
    assertNull(fixture.store.getStagedBundleId());
    fixture.coordinator.cleanupBundles(leave.cleanupBundleIds);
    assertTrue(fixture.indexExists("A"));
    assertFalse(fixture.indexExists("P"));
  }

  @Test
  public void leavingAPreviewWithNothingBeforeItUsesTheBuiltinBundle() throws Exception {
    fixture.installHealthy("P", PREVIEW_CHANNEL);

    UpdaterCoordinator.LeavePreviewPreparation leave = fixture.coordinator.prepareLeavePreview(
      fixture::isUsable
    );

    assertNull(leave.activationPath);
    assertEquals(Arrays.asList("P"), leave.cleanupBundleIds);
    assertTrue(fixture.store.getCurrentBundle().isBuiltin());
    assertTrue(fixture.store.getFallbackBundle().isBuiltin());
  }

  @Test
  public void aReleaseAppliedOverAPreviewKeepsTheEarlierFallback() throws Exception {
    fixture.installHealthy("A");
    fixture.installHealthy("P", PREVIEW_CHANNEL);

    assertTrue(fixture.apply("R").didApply());
    assertEquals("A", fixture.store.getFallbackBundle().id);
    assertFalse(fixture.indexExists("P"));

    var ready = fixture.coordinator.prepareNotifyAppReady(fixture.trial.activationId);
    fixture.coordinator.cleanupBundles(ready.cleanupBundleIds);
    assertEquals("R", fixture.store.getFallbackBundle().id);
    assertFalse(fixture.indexExists("A"));
  }

  @Test
  public void leavingAPreviewFailsClosedWhenStateCannotBeWritten() throws Exception {
    fixture.installHealthy("A");
    fixture.installHealthy("P", PREVIEW_CHANNEL);

    fixture.withReadOnlyState(() ->
      assertThrows(Exception.class, () ->
        fixture.coordinator.prepareLeavePreview(fixture::isUsable)
      )
    );
    assertEquals("P", fixture.reopenStore().getCurrentBundle().id);
    assertTrue(fixture.indexExists("P"));
  }

  @Test
  public void trialIsOverOnceTheAppIsReady() throws Exception {
    assertFalse(fixture.coordinator.isCurrentInTrial());
    fixture.installHealthy("A");
    assertFalse(fixture.coordinator.isCurrentInTrial());
  }
}
