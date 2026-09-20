package com.otakit.updater;

import static org.junit.Assert.*;

import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CancellationException;
import org.junit.Test;

public class CheckFailureTest {

  @Test
  public void failedCheckIsReportedOnceAndStillThrowsOriginalError() throws Exception {
    List<CheckFailure> reports = new ArrayList<>();
    SocketTimeoutException original = new SocketTimeoutException(
      "https://secret.test?token=secret"
    );
    Exception thrown = assertThrows(SocketTimeoutException.class, () ->
      CheckFailure.observe(
        () -> {
          throw original;
        },
        reports::add
      )
    );
    assertSame(original, thrown);
    assertEquals(1, reports.size());
    assertEquals("check", reports.get(0).phase);
    assertEquals("manifest_network_SocketTimeoutException", reports.get(0).detail);
    assertFalse(reports.get(0).detail.contains("secret"));
  }

  @Test
  public void successfulNoUpdateAndCancellationDoNotEmitErrors() throws Exception {
    List<CheckFailure> reports = new ArrayList<>();
    assertNull(CheckFailure.observe(() -> null, reports::add));
    assertEquals("manifest", CheckFailure.observe(() -> "manifest", reports::add));
    assertThrows(CancellationException.class, () ->
      CheckFailure.observe(
        () -> {
          throw new CancellationException();
        },
        reports::add
      )
    );
    assertTrue(reports.isEmpty());
  }

  @Test
  public void httpFailureIncludesOnlyStatus() {
    CheckFailure error = CheckFailure.from(new ManifestClient.HttpFailure(503));
    assertEquals("manifest_http_503", error.detail);
    assertEquals("check", error.phase);
  }

  @Test
  public void realVerifierExpiryAndUnknownKeyRemainTerminalAndAreDistinguishable()
    throws Exception {
    for (boolean expired : new boolean[] { true, false }) {
      List<CheckFailure> reports = new ArrayList<>();
      ManifestClient.ManifestSignature signature = new ManifestClient.ManifestSignature(
        "private-key-label",
        "invalid-signature",
        0,
        expired ? 0 : (int) (System.currentTimeMillis() / 1000 + 600)
      );
      assertThrows(ManifestVerifier.VerificationException.class, () ->
        CheckFailure.observe(
          () -> {
            ManifestVerifier.verify(
              "app-a",
              null,
              "1.0",
              "hash",
              1,
              null,
              "zip",
              false,
              null,
              signature,
              java.util.Collections.emptyList()
            );
            return null;
          },
          reports::add
        )
      );
      assertEquals(1, reports.size());
      assertEquals("signature", reports.get(0).phase);
      assertEquals(expired ? "signature_expired" : "signature_unknown_key", reports.get(0).detail);
      assertFalse(reports.get(0).detail.contains("private-key-label"));
    }
  }
}
