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

  @Test
  public void activatingTheBuiltinBundleDropsEveryInstalledBundle() throws Exception {
    fixture.installHealthy("A");
    fixture.apply("B");
    assertTrue(fixture.coordinator.isCurrentInTrial());
    fixture.stage("C");

    java.util.List<String> cleanup = fixture.coordinator.prepareActivateBuiltin();

    assertEquals(new HashSet<>(Arrays.asList("A", "B", "C")), new HashSet<>(cleanup));
    assertTrue(fixture.store.getCurrentBundle().isBuiltin());
    assertTrue(fixture.store.getFallbackBundle().isBuiltin());
    assertNull(fixture.store.getStagedBundleId());
    assertFalse(fixture.coordinator.isCurrentInTrial());
    fixture.coordinator.cleanupBundles(cleanup);
    assertFalse(fixture.indexExists("A"));
    assertFalse(fixture.indexExists("B"));
    assertFalse(fixture.indexExists("C"));
  }

  @Test
  public void activatingTheBuiltinBundleFailsClosedWhenStateCannotBeWritten() throws Exception {
    fixture.installHealthy("A");

    fixture.withReadOnlyState(() ->
      assertThrows(Exception.class, () -> fixture.coordinator.prepareActivateBuiltin())
    );
    assertEquals("A", fixture.reopenStore().getCurrentBundle().id);
    assertTrue(fixture.indexExists("A"));
  }

  @Test
  public void trialIsOverOnceTheAppIsReady() throws Exception {
    assertFalse(fixture.coordinator.isCurrentInTrial());
    fixture.installHealthy("A");
    assertFalse(fixture.coordinator.isCurrentInTrial());
  }
}
