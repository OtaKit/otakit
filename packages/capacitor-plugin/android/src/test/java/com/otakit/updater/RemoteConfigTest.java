package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.IOException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Remote config (plugin 3.4+). The three files are shared with console/lib/manifest-signing.test.ts
 * and RemoteConfigTests.swift: a channel's config, a base config with experiments, and a signed
 * deletion.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class RemoteConfigTest {

  private static final String APP_ID = "7bb828f1-797c-4d07-8254-068cac664f69";
  private static final ManifestVerifier.KeyEntry KEY = new ManifestVerifier.KeyEntry(
    "config-test-key",
    java.util.Base64.getDecoder().decode(
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJP8NHG8t4uUu8RVw+lnnn7J3YJMMM2deHqJxIZo5O1PlZF7qB24YJ83c2Tv9fyh7fEQirqhkEs+/pBK/2kbCWQ=="
    )
  );
  private static final List<ManifestVerifier.KeyEntry> KEYS = Collections.singletonList(KEY);
  static final String PRODUCTION =
    "{\"appId\": \"7bb828f1-797c-4d07-8254-068cac664f69\", \"channel\": \"production\", \"version\": 12, \"deleted\": false, \"valuesJson\": \"{\\\"checkoutEnabled\\\":false,\\\"helpUrl\\\":\\\"https://example.com/help\\\",\\\"banner\\\":\\\"Zur\\u00fcck um 14:00 \\u2713\\\",\\\"limits\\\":{\\\"upload\\\":25}}\", \"experimentsJson\": null, \"updatedAt\": \"2026-10-14T09:00:00.000Z\", \"signature\": {\"kid\": \"config-test-key\", \"sig\": \"MEQCIGKAWvjrlu5QVltyCqufCS3j8Zre2H7UTTdmWJVTKv6AAiB3ciiNfJvV5ECQ921CICtxqkreY_BqXvzmSAssbeJ2xQ\", \"iat\": 1790000000, \"exp\": 2145916800}}";
  static final String BASE =
    "{\"appId\": \"7bb828f1-797c-4d07-8254-068cac664f69\", \"channel\": null, \"version\": 3, \"deleted\": false, \"valuesJson\": \"{\\\"paywallTitle\\\":\\\"Go Pro\\\",\\\"maxItems\\\":5}\", \"experimentsJson\": \"[{\\\"key\\\":\\\"paywall_copy\\\",\\\"traffic\\\":100,\\\"variants\\\":[{\\\"key\\\":\\\"control\\\",\\\"weight\\\":50,\\\"overrides\\\":{}},{\\\"key\\\":\\\"b\\\",\\\"weight\\\":50,\\\"overrides\\\":{\\\"paywallTitle\\\":\\\"Unlock everything\\\"}}],\\\"runtimeVersions\\\":null,\\\"goal\\\":\\\"purchase_completed\\\"}]\", \"updatedAt\": \"2026-10-14T09:00:00.000Z\", \"signature\": {\"kid\": \"config-test-key\", \"sig\": \"MEUCIFMd1Xs9YBZdJTqjxHwH-rye9EpZQ8y_6t2hh-jZ0KqMAiEA9O5vqX-pGvezd8i3V3-_JpZh6-7GYdW5BzHZnD5JOZs\", \"iat\": 1790000000, \"exp\": 2145916800}}";
  static final String BETA_DELETED =
    "{\"appId\": \"7bb828f1-797c-4d07-8254-068cac664f69\", \"channel\": \"beta\", \"version\": 14, \"deleted\": true, \"valuesJson\": \"{}\", \"experimentsJson\": null, \"updatedAt\": \"2026-10-14T09:00:00.000Z\", \"signature\": {\"kid\": \"config-test-key\", \"sig\": \"MEQCIFaQbv-YUZmF2TRAaRjDDoPfVJc78Sl2I66w3QIHhWF7AiB3iKMXz4PsB59qBK5Mca1tMKRXyxI4VPiAJ8aHq9b2XQ\", \"iat\": 1790000000, \"exp\": 2145916800}}";
  private static final String BASE_PATH = "/config/" + APP_ID + "/__base__/config.json";
  private static final String PRODUCTION_PATH = "/config/" + APP_ID + "/production/config.json";
  private static final String BETA_PATH = "/config/" + APP_ID + "/beta/config.json";

  @Rule
  public TemporaryFolder temporary = new TemporaryFolder();

  /** Answers config requests from a table, recording what was asked. */
  static final class StubTransport implements RemoteConfig.Transport {

    final Map<String, RemoteConfig.Response> replies = new HashMap<>();
    final List<String> paths = new ArrayList<>();
    final List<String> etags = new ArrayList<>();

    void reply(String path, int status, String body, String etag) {
      replies.put(path, new RemoteConfig.Response(status, body, etag));
    }

    @Override
    public RemoteConfig.Response get(URL url, String etag) throws IOException {
      paths.add(url.getPath());
      etags.add(etag);
      RemoteConfig.Response reply = replies.get(url.getPath());
      if (reply == null) throw new IOException("no stub");
      return reply;
    }
  }

  private StubTransport transport;

  @Before
  public void setUp() {
    transport = new StubTransport();
  }

  private RemoteConfig.Client client() throws IOException {
    return new RemoteConfig.Client(
      new RemoteConfig.Store(new java.io.File(temporary.getRoot(), "config")),
      transport
    );
  }

  private static RemoteConfig.Context context(
    String channel,
    List<ManifestVerifier.KeyEntry> keys
  ) {
    return new RemoteConfig.Context("https://cdn.test", APP_ID, channel, keys, false);
  }

  private static String tamper(String json, String field, Object value) throws Exception {
    JSONObject object = new JSONObject(json);
    if (value == null) object.remove(field);
    else object.put(field, value);
    return object.toString();
  }

  @Test
  public void verifiesTheSharedVectors() throws Exception {
    RemoteConfig.ConfigFile production = RemoteConfig.parse(PRODUCTION, APP_ID, "production", KEYS);
    assertEquals(12, production.version);
    assertFalse(production.deleted);
    assertEquals(
      "{\"checkoutEnabled\":false,\"helpUrl\":\"https://example.com/help\",\"banner\":\"Zur\u00fcck um 14:00 \u2713\",\"limits\":{\"upload\":25}}",
      production.valuesJson
    );
    assertNull(production.experimentsJson);

    RemoteConfig.ConfigFile base = RemoteConfig.parse(BASE, APP_ID, null, KEYS);
    assertNull(base.channel);
    assertEquals(3, base.version);
    assertTrue(base.experimentsJson.startsWith("[{\"key\":\"paywall_copy\""));

    RemoteConfig.ConfigFile deleted = RemoteConfig.parse(BETA_DELETED, APP_ID, "beta", KEYS);
    assertTrue(deleted.deleted);
    assertEquals(14, deleted.version);
  }

  @Test
  public void refusesTamperedOrMisplacedFiles() throws Exception {
    String[][] cases = {
      { tamper(PRODUCTION, "valuesJson", "{\"checkoutEnabled\":true}"), "production" },
      { tamper(PRODUCTION, "version", 13), "production" },
      { tamper(BETA_DELETED, "deleted", false), "beta" },
      { tamper(BASE, "experimentsJson", JSONObject.NULL), null },
      { tamper(PRODUCTION, "signature", null), "production" },
      { PRODUCTION, "beta" },
      { PRODUCTION, null },
    };
    for (String[] item : cases) {
      try {
        RemoteConfig.parse(item[0], APP_ID, item[1], KEYS);
        fail("accepted " + item[0]);
      } catch (Exception expected) {
        // refused
      }
    }
    try {
      RemoteConfig.parse(PRODUCTION, "other-app", "production", KEYS);
      fail("accepted another app's config");
    } catch (RemoteConfig.InvalidConfigException expected) {
      assertEquals("wrong_app", expected.reason);
    }
  }

  @Test
  public void checksShapeAndSize() throws Exception {
    try {
      RemoteConfig.parse(
        tamper(PRODUCTION, "valuesJson", "[1,2]"),
        APP_ID,
        "production",
        Collections.emptyList()
      );
      fail("accepted an array");
    } catch (RemoteConfig.InvalidConfigException expected) {
      assertEquals("invalid_values", expected.reason);
    }
    try {
      RemoteConfig.parse(
        tamper(BASE, "experimentsJson", "{}"),
        APP_ID,
        null,
        Collections.emptyList()
      );
      fail("accepted experiments that are not a list");
    } catch (RemoteConfig.InvalidConfigException expected) {
      assertEquals("invalid_experiments", expected.reason);
    }
    try {
      RemoteConfig.parse(
        tamper(PRODUCTION, "version", 12.5),
        APP_ID,
        "production",
        Collections.emptyList()
      );
      fail("accepted a fractional version");
    } catch (RemoteConfig.InvalidConfigException expected) {
      assertEquals("invalid_version", expected.reason);
    }
    StringBuilder huge = new StringBuilder();
    while (huge.length() <= RemoteConfig.MAX_BYTES) huge.append("          ");
    try {
      RemoteConfig.parse(huge.toString(), APP_ID, null, Collections.emptyList());
      fail("accepted an oversized file");
    } catch (RemoteConfig.InvalidConfigException expected) {
      assertEquals("too_large", expected.reason);
    }
    // Without keys (self-hosted, intentionally unsigned) a well-formed file is accepted.
    assertEquals(
      12,
      RemoteConfig.parse(
        tamper(PRODUCTION, "signature", null),
        APP_ID,
        "production",
        Collections.emptyList()
      ).version
    );
  }

  @Test
  public void parsesSignatureTimesBeyond2038() throws Exception {
    JSONObject signature = new JSONObject()
      .put("kid", "k")
      .put("sig", "s")
      .put("iat", 4102444800L)
      .put("exp", 4133980800L);
    ManifestClient.ManifestSignature parsed = ManifestClient.parseSignature(signature);
    assertEquals(4102444800L, parsed.iat);
    assertEquals(4133980800L, parsed.exp);
    assertTrue(
      ManifestVerifier.buildCanonicalPayload("CONFIG", new ArrayList<>(), parsed).endsWith(
        "iat:4102444800\nexp:4133980800"
      )
    );
  }

  @Test
  public void readsTheChannelConfigAndPersistsIt() throws Exception {
    transport.reply(PRODUCTION_PATH, 200, PRODUCTION, "\"v12\"");
    RemoteConfig.Client first = client();
    assertEquals("none", first.snapshot(APP_ID, "production").toMap().get("source"));

    RemoteConfig.RefreshResult result = first.refresh(context("production", KEYS));
    assertNull(result.error);
    assertTrue(result.changed);
    assertEquals(12L, result.snapshot.file.version);
    assertEquals("remote", result.snapshot.toMap().get("source"));
    assertEquals("production", result.snapshot.toMap().get("channel"));

    // A new process reads the saved copy without the network.
    RemoteConfig.Snapshot restarted = client().snapshot(APP_ID, "production");
    assertEquals(12L, restarted.file.version);
    assertEquals("cache", restarted.toMap().get("source"));

    // An unchanged file is confirmed with the ETag.
    transport.reply(PRODUCTION_PATH, 304, "", null);
    RemoteConfig.RefreshResult again = first.refresh(context("production", KEYS));
    assertFalse(again.changed);
    assertEquals("\"v12\"", transport.etags.get(transport.etags.size() - 1));
  }

  @Test
  public void fallsBackToTheBaseConfigWithoutChannelConfig() throws Exception {
    transport.reply(BETA_PATH, 404, "", null);
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.RefreshResult result = client().refresh(context("beta", KEYS));
    assertEquals(3L, result.snapshot.file.version);
    assertNull(result.snapshot.file.channel);
    assertNotNull(result.snapshot.file.experimentsJson);
    assertEquals(java.util.Arrays.asList(BETA_PATH, BASE_PATH), transport.paths);
  }

  @Test
  public void aSignedDeletionSendsTheChannelToTheBaseConfig() throws Exception {
    transport.reply(BETA_PATH, 200, BETA_DELETED, null);
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.RefreshResult result = client().refresh(context("beta", KEYS));
    assertEquals(3L, result.snapshot.file.version);
    assertNull(result.snapshot.file.channel);
  }

  @Test
  public void refusesAnOlderVersionThanOneItAccepted() throws Exception {
    transport.reply(PRODUCTION_PATH, 200, PRODUCTION, null);
    RemoteConfig.Client configClient = client();
    configClient.refresh(context("production", KEYS));
    // Unsigned, so the replay rule shows on its own (a signed older file fails verification anyway).
    transport.reply(PRODUCTION_PATH, 200, tamper(PRODUCTION, "version", 11), null);
    RemoteConfig.RefreshResult replayed = configClient.refresh(
      context("production", Collections.emptyList())
    );
    assertEquals(12L, replayed.snapshot.file.version);
    assertFalse(replayed.changed);
  }

  @Test
  public void keepsTheVerifiedCopyWhenTheFileGoesMissingOrTheNetworkFails() throws Exception {
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.Client configClient = client();
    configClient.refresh(context(null, KEYS));

    transport.reply(BASE_PATH, 404, "", null);
    RemoteConfig.RefreshResult missing = configClient.refresh(context(null, KEYS));
    assertEquals(3L, missing.snapshot.file.version);
    assertNull(missing.error);

    transport.reply(BASE_PATH, 503, "", null);
    RemoteConfig.RefreshResult failed = configClient.refresh(context(null, KEYS));
    assertEquals(3L, failed.snapshot.file.version);
    assertEquals("http_503", failed.error);

    transport.reply(BASE_PATH, 200, "{ not json", null);
    RemoteConfig.RefreshResult broken = configClient.refresh(context(null, KEYS));
    assertEquals(3L, broken.snapshot.file.version);
    assertEquals("invalid_config", broken.error);
  }

  @Test
  public void answersFromTheDeviceWhileAFetchIsStillRunning() throws Exception {
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.Client configClient = client();
    configClient.refresh(context(null, KEYS));

    java.util.concurrent.CountDownLatch requested = new java.util.concurrent.CountDownLatch(1);
    java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
    RemoteConfig.Client slow = new RemoteConfig.Client(
      new RemoteConfig.Store(new java.io.File(temporary.getRoot(), "config")),
      (url, etag) -> {
        requested.countDown();
        try {
          release.await();
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
        }
        return new RemoteConfig.Response(304, "", null);
      }
    );
    Thread fetch = new Thread(() -> slow.refresh(context(null, KEYS)));
    fetch.start();
    assertTrue(requested.await(5, java.util.concurrent.TimeUnit.SECONDS));
    long started = System.nanoTime();
    assertEquals(3L, slow.snapshot(APP_ID, null).file.version);
    assertTrue(slow.shouldSkip(0) == false);
    assertTrue(System.nanoTime() - started < 1_000_000_000L);
    release.countDown();
    fetch.join(5000);
  }

  @Test
  public void startsOverForAnotherApp() throws Exception {
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.Client configClient = client();
    configClient.refresh(context(null, KEYS));
    String otherApp = "11111111-2222-4333-8444-555555555555";
    transport.reply(
      "/config/" + otherApp + "/__base__/config.json",
      200,
      tamper(tamper(BASE, "appId", otherApp), "version", 1),
      null
    );
    RemoteConfig.RefreshResult switched = configClient.refresh(
      new RemoteConfig.Context("https://cdn.test", otherApp, null, Collections.emptyList(), false)
    );
    // Version 1 is accepted: the other app's counters did not carry over.
    assertEquals(1L, switched.snapshot.file.version);
    assertNull(configClient.snapshot(APP_ID, null).file);
  }

  @Test
  public void usesTheBaseCopyWhenAChannelIsDeletedAndTheBaseFetchFails() throws Exception {
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.Client configClient = client();
    configClient.refresh(context(null, KEYS));
    transport.reply(BETA_PATH, 200, BETA_DELETED, null);
    transport.reply(BASE_PATH, 503, "", null);
    RemoteConfig.RefreshResult result = configClient.refresh(context("beta", KEYS));
    assertEquals("http_503", result.error);
    assertEquals(3L, result.snapshot.file.version);
    assertNull(result.snapshot.file.channel);
  }

  @Test
  public void aNewChannelShowsTheBaseConfigUntilItsFirstFetch() throws Exception {
    transport.reply(BASE_PATH, 200, BASE, null);
    RemoteConfig.Client configClient = client();
    configClient.refresh(context(null, KEYS));
    assertEquals(3L, configClient.snapshot(APP_ID, "production").file.version);
    assertTrue(configClient.shouldSkip(600_000));
    assertFalse(configClient.shouldSkip(0));
  }
}
