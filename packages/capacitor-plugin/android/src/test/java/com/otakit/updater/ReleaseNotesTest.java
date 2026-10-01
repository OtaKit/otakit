package com.otakit.updater;

import static org.junit.Assert.*;

import java.util.Collections;
import java.util.List;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * Release notes (plugin 3.3+). The vector is shared with console/lib/manifest-signing.test.ts and
 * ReleaseNotesTests.swift: a complete manifest whose top level, rollout block and both notes
 * blocks are signed.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ReleaseNotesTest {

  private static final String APP_ID = "7bb828f1-797c-4d07-8254-068cac664f69";
  private static final ManifestVerifier.KeyEntry VECTOR_KEY = new ManifestVerifier.KeyEntry(
    "notes-test-key",
    java.util.Base64.getDecoder().decode(
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkGEUgoH9yaIEaWpJltHsu43ogXXdRAwdqNSnw+m14d4Q10mwUUcQ2QFiwHzwQjShpvlC8pY70jK8EnLGPt3JTA=="
    )
  );
  private static final String STABLE_NOTES =
    "Faster checkout.\nPhotos load 2× faster on Android.\tMerci, café 🚀";
  private static final String MANIFEST_JSON = """
    {
      "version": "1.5.0",
      "sha256": "3333333333333333333333333333333333333333333333333333333333333333",
      "size": 140,
      "runtimeVersion": "2026.10",
      "strategy": "zip",
      "forceImmediate": false,
      "encryption": null,
      "releaseId": "5b0e3c1a-6c4f-4b7e-9a1d-2f8e7c6b5a40",
      "channel": "production",
      "signature": {
        "kid": "notes-test-key",
        "sig": "MEYCIQCpkHRddZEHgnEqyvFAP6v0ybbmKeQsGg4-rb30M2QlUQIhAMckbYBJoixOBz3a2oUIITMePtWZx_Cl1tDnXaestZ5l",
        "iat": 1790000000,
        "exp": 2145916800
      },
      "url": "https://cdn.otakit.app/bundles/notes-stable.zip",
      "notes": {
        "text": "Faster checkout.\\nPhotos load 2× faster on Android.\\tMerci, café 🚀",
        "signature": {
          "kid": "notes-test-key",
          "sig": "MEQCICV24IsfkI_axwR-xKFTRi6RMNhdJM3onk3x-leodaiSAiAvR6ki-Cr6h1a7BJqq_3P8I-jtKpwoEHUSHoUQ6tequQ",
          "iat": 1790000000,
          "exp": 2145916800
        }
      },
      "rollout": {
        "version": "1.5.1",
        "sha256": "4444444444444444444444444444444444444444444444444444444444444444",
        "size": 150,
        "runtimeVersion": "2026.10",
        "strategy": "zip",
        "forceImmediate": false,
        "encryption": null,
        "releaseId": "c2d4e6f8-1a3b-4c5d-8e7f-90a1b2c3d4e5",
        "percent": 20,
        "stableSha256": "3333333333333333333333333333333333333333333333333333333333333333",
        "signature": {
          "kid": "notes-test-key",
          "sig": "MEYCIQDqwD5jJLq9Hsp_6JDncZVBcL7drlYB8mqV6-35ID3JJgIhAJmcp1lUYSPO6SFb6EP6ISd6ij834dym1-fAwzoHznC2",
          "iat": 1790000000,
          "exp": 2145916800
        },
        "url": "https://cdn.otakit.app/bundles/notes-rolling.zip",
        "notes": {
          "text": "Beta: new home screen",
          "signature": {
            "kid": "notes-test-key",
            "sig": "MEYCIQD9N9zyNPpXZvpTgKOFEXrPjsThpU3AxPznEWWJKctVhQIhAM-1u2T8Q0JEelCPmND6Zp9Lpnclw4O3xgd0ktxL3CO9",
            "iat": 1790000000,
            "exp": 2145916800
          }
        }
      }
    }
    """;

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private CoordinatorFixture fixture;

  @Before
  public void setUp() throws Exception {
    fixture = new CoordinatorFixture(temporaryFolder.newFolder());
  }

  private static ManifestClient.ParsedManifest parse(
    String json,
    List<ManifestVerifier.KeyEntry> keys
  ) throws Exception {
    return ManifestClient.parse(json, APP_ID, "production", false, keys);
  }

  private static ManifestClient.ParsedManifest parse(String json) throws Exception {
    return parse(json, Collections.singletonList(VECTOR_KEY));
  }

  @Test
  public void verifiesNotesOfTheStableAndRollingReleases() throws Exception {
    ManifestClient.ParsedManifest parsed = parse(MANIFEST_JSON);
    assertEquals(STABLE_NOTES, parsed.stable.notes);
    assertEquals("Beta: new home screen", parsed.rollout.manifest.notes);
  }

  @Test
  public void hashesTheTextLikeTheServer() {
    assertEquals(
      "d7b1791bd8bae54cc46a8a2d0190ef41061c8e1002db1f9b0ca2a707886e2c54",
      ManifestVerifier.sha256Hex(STABLE_NOTES)
    );
  }

  @Test
  public void dropsNotesThatDoNotVerifyButKeepsTheUpdate() throws Exception {
    JSONObject edited = new JSONObject(MANIFEST_JSON);
    edited.getJSONObject("notes").put("text", "Edited in transit");
    JSONObject unsigned = new JSONObject(MANIFEST_JSON);
    unsigned.getJSONObject("notes").put("signature", JSONObject.NULL);

    for (JSONObject json : new JSONObject[] { edited, unsigned }) {
      ManifestClient.ParsedManifest parsed = parse(json.toString());
      assertEquals("1.5.0", parsed.stable.version);
      assertNull(parsed.stable.notes);
      assertEquals("Beta: new home screen", parsed.rollout.manifest.notes);
    }

    // The stable release's notes copied into the rollout block: bound to another release.
    JSONObject moved = new JSONObject(MANIFEST_JSON);
    moved.getJSONObject("rollout").put("notes", moved.getJSONObject("notes"));
    ManifestClient.ParsedManifest parsed = parse(moved.toString());
    assertEquals(STABLE_NOTES, parsed.stable.notes);
    assertNotNull(parsed.rollout);
    assertNull(parsed.rollout.manifest.notes);
  }

  @Test
  public void acceptsNotesWithoutConfiguredKeys() throws Exception {
    assertEquals(STABLE_NOTES, parse(MANIFEST_JSON, Collections.emptyList()).stable.notes);
  }

  @Test
  public void ignoresMissingOrEmptyNotes() throws Exception {
    JSONObject none = new JSONObject(MANIFEST_JSON);
    none.remove("notes");
    JSONObject empty = new JSONObject(MANIFEST_JSON);
    empty.getJSONObject("notes").put("text", "");
    assertNull(parse(none.toString()).stable.notes);
    assertNull(parse(empty.toString()).stable.notes);
  }

  @Test
  public void bundleRecordsKeepNotesAndOldRecordsStillDecode() throws Exception {
    BundleInfo bundle = new BundleInfo(
      "bundle-1",
      "1.5.0",
      null,
      BundleStatus.PENDING,
      null,
      "hash",
      null,
      "production",
      "release-1",
      "Faster checkout."
    );
    assertEquals("Faster checkout.", BundleInfo.fromJSONObject(bundle.toJSONObject()).notes);
    assertEquals("Faster checkout.", bundle.withStatus(BundleStatus.SUCCESS).notes);
    assertEquals("Faster checkout.", bundle.toJSObject().getString("notes"));

    JSONObject legacy = new JSONObject(
      "{\"id\":\"bundle-0\",\"version\":\"1.0.0\",\"status\":\"success\"}"
    );
    assertNull(BundleInfo.fromJSONObject(legacy).notes);
  }

  @Test
  public void remembersSeenReleasesAndKeepsTheNewestTwenty() throws Exception {
    assertFalse(fixture.store.isReleaseNotesSeen("release-1"));
    fixture.store.markReleaseNotesSeen("release-1");
    assertTrue(fixture.reopenStore().isReleaseNotesSeen("release-1"));

    for (int index = 2; index <= 21; index++) {
      fixture.store.markReleaseNotesSeen("release-" + index);
    }
    BundleStore store = fixture.reopenStore();
    assertFalse(store.isReleaseNotesSeen("release-1"));
    assertTrue(store.isReleaseNotesSeen("release-2"));
    assertTrue(store.isReleaseNotesSeen("release-21"));
  }
}
