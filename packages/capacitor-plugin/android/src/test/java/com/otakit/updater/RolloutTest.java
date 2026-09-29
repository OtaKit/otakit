package com.otakit.updater;

import static org.junit.Assert.*;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Cross-implementation vectors shared with console/lib/manifest-signing.test.ts and
 * RolloutTests.swift: the fixture was signed by the server's payload builders, so any drift
 * between the three fails here.
 */
@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 34)
public class RolloutTest {

  private static final String APP_ID = "7bb828f1-797c-4d07-8254-068cac664f69";
  private static final String STABLE_RELEASE_ID = "0f5c1f55-9d3a-4a36-9b0e-6d7f2b1c0a01";
  private static final String ROLLING_RELEASE_ID = "f32627ca-9e8c-4358-90d8-bde732400081";
  private static final ManifestVerifier.KeyEntry VECTOR_KEY = new ManifestVerifier.KeyEntry(
    "rollout-test-key",
    java.util.Base64.getDecoder().decode(
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5baepIzUs2xSVqfJIjpzSlW5qPYH7WRpYKc+GESnncgO+5+a1eEpDet39AAocMdRIM4fM5z+/WGIlQiqeK3LfA=="
    )
  );
  private static final String MANIFEST_JSON = """
    {
      "version": "1.4.1",
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111",
      "size": 123,
      "runtimeVersion": "2026.10",
      "releaseId": "0f5c1f55-9d3a-4a36-9b0e-6d7f2b1c0a01",
      "strategy": "zip",
      "forceImmediate": false,
      "encryption": null,
      "channel": "production",
      "signature": {
        "kid": "rollout-test-key",
        "sig": "MEYCIQDc7L5nYPzyKYIL-42ou9LK5f5QBuP2OMAbDUsQgBZK2QIhAJpFW7IKkiWS3FxXXwfgksWJapHUWzx4us8q_bzn1vMC",
        "iat": 1790000000,
        "exp": 2145916800
      },
      "url": "https://cdn.otakit.app/bundles/stable.zip",
      "rollout": {
        "version": "1.4.2",
        "sha256": "2222222222222222222222222222222222222222222222222222222222222222",
        "size": 130,
        "runtimeVersion": "2026.10",
        "releaseId": "f32627ca-9e8c-4358-90d8-bde732400081",
        "strategy": "zip",
        "forceImmediate": true,
        "encryption": {
          "alg": "A256GCM",
          "kid": "bundle-key",
          "wrapNonce": "d3JhcE5vbmNl",
          "wrappedDek": "d3JhcHBlZERlaw",
          "nonce": "bm9uY2U"
        },
        "percent": 10,
        "stableSha256": "1111111111111111111111111111111111111111111111111111111111111111",
        "signature": {
          "kid": "rollout-test-key",
          "sig": "MEUCIQCotWyY41G-mCIwoYMSpRlbgUC_zCRmVG9TaGNDZ2JdWAIgH4mQtFOVrDjNoXUVZZHYtGey-KA77jTWw2q7n-fI9TU",
          "iat": 1790000000,
          "exp": 2145916800
        },
        "url": "https://cdn.otakit.app/bundles/rolling.zip"
      }
    }
    """;

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private static ManifestClient.ParsedManifest parse(String json) throws Exception {
    return parse(json, Collections.singletonList(VECTOR_KEY));
  }

  private static ManifestClient.ParsedManifest parse(
    String json,
    List<ManifestVerifier.KeyEntry> keys
  ) throws Exception {
    return ManifestClient.parse(json, APP_ID, "production", false, keys);
  }

  private interface RolloutMutation {
    void apply(JSONObject rollout) throws Exception;
  }

  private static String mutateRollout(RolloutMutation mutation) throws Exception {
    JSONObject manifest = new JSONObject(MANIFEST_JSON);
    mutation.apply(manifest.getJSONObject("rollout"));
    return manifest.toString();
  }

  private static String rolloutAsArray() throws Exception {
    JSONObject manifest = new JSONObject(MANIFEST_JSON);
    manifest.put("rollout", new org.json.JSONArray().put(manifest.getJSONObject("rollout")));
    return manifest.toString();
  }

  private static String zeros(int count) {
    return String.join("", Collections.nCopies(count, "0"));
  }

  @Test
  public void verifiesServerSignedStableAndRollingReleases() throws Exception {
    ManifestClient.ParsedManifest parsed = parse(MANIFEST_JSON);

    assertEquals(STABLE_RELEASE_ID, parsed.stable.releaseId);
    assertNull(parsed.rolloutFailure);
    assertNotNull(parsed.rollout);
    assertEquals(10, parsed.rollout.percent);
    assertEquals(ROLLING_RELEASE_ID, parsed.rollout.manifest.releaseId);
    assertEquals("1.4.2", parsed.rollout.manifest.version);
    assertEquals("https://cdn.otakit.app/bundles/rolling.zip", parsed.rollout.manifest.url);
    assertTrue(parsed.rollout.manifest.forceImmediate);
    assertEquals("bundle-key", parsed.rollout.manifest.encryption.kid);
  }

  @Test
  public void rolloutPayloadMatchesTheServerByteForByte() {
    List<String> lines = ManifestVerifier.bundlePayloadLines(
      APP_ID,
      "production",
      "1.4.2",
      String.join("", Collections.nCopies(64, "2")),
      130,
      "2026.10",
      "zip",
      true,
      new ManifestClient.ManifestEncryption(
        "A256GCM",
        "bundle-key",
        "d3JhcE5vbmNl",
        "d3JhcHBlZERlaw",
        "bm9uY2U"
      )
    );
    lines.add("percent:10");
    lines.add("releaseId:" + ROLLING_RELEASE_ID);
    lines.add("stableSha256:" + String.join("", Collections.nCopies(64, "1")));
    lines.add("notesSha256:null");
    String payload = ManifestVerifier.buildCanonicalPayload(
      "ROLLOUT",
      lines,
      new ManifestClient.ManifestSignature("rollout-test-key", "", 1790000000, 2145916800)
    );
    assertEquals(
      String.join(
        "\n",
        "ROLLOUT",
        "appId:7bb828f1-797c-4d07-8254-068cac664f69",
        "channel:production",
        "version:1.4.2",
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        "size:130",
        "runtimeVersion:2026.10",
        "strategy:zip",
        "forceImmediate:true",
        "encryption:A256GCM|bundle-key|d3JhcE5vbmNl|d3JhcHBlZERlaw|bm9uY2U",
        "percent:10",
        "releaseId:f32627ca-9e8c-4358-90d8-bde732400081",
        "stableSha256:1111111111111111111111111111111111111111111111111111111111111111",
        "notesSha256:null",
        "kid:rollout-test-key",
        "iat:1790000000",
        "exp:2145916800"
      ),
      payload
    );
  }

  @Test
  public void invalidRolloutBlockFallsBackToStableAndReportsWhy() throws Exception {
    Object[][] cases = {
      {
        mutateRollout(rollout -> rollout.put("percent", 50)),
        "signature",
        "rollout_signature_invalid",
      },
      {
        mutateRollout(rollout -> rollout.put("releaseId", "other")),
        "signature",
        "rollout_signature_invalid",
      },
      {
        mutateRollout(rollout -> rollout.remove("signature")),
        "signature",
        "rollout_signature_missing",
      },
      {
        mutateRollout(rollout ->
          rollout.put("stableSha256", String.join("", Collections.nCopies(64, "3")))
        ),
        "check",
        "rollout_invalid",
      },
      { mutateRollout(rollout -> rollout.put("percent", 100)), "check", "rollout_invalid" },
      { mutateRollout(rollout -> rollout.put("percent", 0)), "check", "rollout_invalid" },
      { mutateRollout(rollout -> rollout.put("percent", "10")), "check", "rollout_invalid" },
      {
        mutateRollout(rollout -> rollout.put("url", "http://cdn.otakit.app/bundles/rolling.zip")),
        "check",
        "rollout_invalid",
      },
      { rolloutAsArray(), "check", "rollout_invalid" },
    };
    for (Object[] testCase : cases) {
      ManifestClient.ParsedManifest parsed = parse((String) testCase[0]);
      String detail = (String) testCase[2];
      assertEquals(detail, STABLE_RELEASE_ID, parsed.stable.releaseId);
      assertNull(detail, parsed.rollout);
      assertEquals(detail, testCase[1], parsed.rolloutFailure.phase);
      assertEquals(detail, parsed.rolloutFailure.detail);
    }
  }

  @Test
  public void unconfiguredKeysSkipVerificationLikeTheTopLevel() throws Exception {
    ManifestClient.ParsedManifest parsed = parse(
      mutateRollout(rollout -> rollout.remove("signature")),
      Collections.emptyList()
    );
    assertEquals(10, parsed.rollout.percent);
    assertNull(parsed.rolloutFailure);
  }

  @Test
  public void tamperedTopLevelStillFailsTheWholeCheck() {
    ManifestVerifier.VerificationException failure = assertThrows(
      ManifestVerifier.VerificationException.class,
      () -> parse(new JSONObject(MANIFEST_JSON).put("size", 124).toString())
    );
    assertEquals("signature_invalid", failure.reason);
  }

  @Test
  public void bucketVectorsMatchTheOtherImplementations() {
    Object[][] vectors = {
      { "00112233445566778899aabbccddeeff", "rollout:" + ROLLING_RELEASE_ID, 7 },
      { "00112233445566778899aabbccddeeff", "rollout:" + STABLE_RELEASE_ID, 8 },
      { "ffeeddccbbaa99887766554433221100", "rollout:" + ROLLING_RELEASE_ID, 32 },
      { "0123456789abcdef0123456789abcdef", "rollout:release-1", 80 },
      { zeros(30) + "2f", "rollout:" + ROLLING_RELEASE_ID, 10 },
      { zeros(30) + "c0", "rollout:" + ROLLING_RELEASE_ID, 11 },
    };
    for (Object[] vector : vectors) {
      assertEquals(
        Arrays.toString(vector),
        (int) vector[2],
        Rollout.bucket((String) vector[0], (String) vector[1])
      );
    }
  }

  @Test
  public void selectsTheRollingReleaseOnlyWithinThePercent() throws Exception {
    ManifestClient.ParsedManifest parsed = parse(MANIFEST_JSON);

    Rollout.Selection inside = Rollout.select(parsed, zeros(30) + "2f");
    assertEquals(ROLLING_RELEASE_ID, inside.manifest.releaseId);
    assertEquals(ROLLING_RELEASE_ID, inside.state.releaseId);
    assertEquals("1.4.2", inside.state.version);
    assertEquals(10, inside.state.percent);
    assertEquals(10, inside.state.bucket);
    assertTrue(inside.state.included);

    Rollout.Selection outside = Rollout.select(parsed, zeros(30) + "c0");
    assertEquals(STABLE_RELEASE_ID, outside.manifest.releaseId);
    assertEquals(11, outside.state.bucket);
    assertFalse(outside.state.included);

    Rollout.Selection noRollout = Rollout.select(
      new ManifestClient.ParsedManifest(parsed.stable, null, null),
      "any"
    );
    assertEquals(STABLE_RELEASE_ID, noRollout.manifest.releaseId);
    assertNull(noRollout.state);
  }

  @Test
  public void bucketsAreUniformAndIndependentBetweenRollouts() {
    int devices = 50_000;
    int[] counts = new int[101];
    int inFirst = 0;
    int inBoth = 0;
    for (int index = 0; index < devices; index++) {
      String secret = String.format("%032x", index);
      int first = Rollout.bucket(secret, "rollout:first");
      int second = Rollout.bucket(secret, "rollout:second");
      counts[first]++;
      if (first <= 10) inFirst++;
      if (first <= 10 && second <= 10) inBoth++;
    }
    assertEquals(0, counts[0]);
    for (int bucket = 1; bucket <= 100; bucket++) {
      // 500 expected per bucket; ±5 standard deviations.
      assertTrue(
        "bucket " + bucket + ": " + counts[bucket],
        counts[bucket] >= 388 && counts[bucket] <= 612
      );
    }
    assertTrue(String.valueOf(inFirst), inFirst >= 4_750 && inFirst <= 5_250);
    // Independent rollouts share about 10% × 10% of devices, not the same 10%.
    assertTrue(String.valueOf(inBoth), inBoth >= 400 && inBoth <= 600);
  }

  @Test
  public void assignmentSecretPersistsPerInstallation() throws Exception {
    CoordinatorFixture fixture = new CoordinatorFixture(temporaryFolder.newFolder());

    String secret = fixture.store.assignmentSecret();
    assertEquals(32, secret.length());
    assertEquals(secret, fixture.store.assignmentSecret());
    assertEquals(secret, fixture.reopenStore().assignmentSecret());

    // A reinstall clears app preferences and draws a new secret.
    fixture.store.getPrefs().edit().clear().commit();
    assertNotEquals(secret, fixture.store.assignmentSecret());
  }
}
