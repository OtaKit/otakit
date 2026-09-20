package com.otakit.updater;

import java.util.concurrent.Callable;
import java.util.concurrent.CancellationException;

/** Bounded diagnostics: never include manifest bodies, URLs, signatures, or key IDs. */
final class CheckFailure {

  final String phase;
  final String detail;

  private CheckFailure(String phase, String detail) {
    this.phase = phase;
    this.detail = detail;
  }

  static CheckFailure from(Exception error) {
    if (
      error instanceof CancellationException || Thread.currentThread().isInterrupted()
    ) return null;
    if (error instanceof ManifestVerifier.VerificationException) {
      return new CheckFailure("signature", ((ManifestVerifier.VerificationException) error).reason);
    }
    if (error instanceof ManifestClient.HttpFailure) {
      return new CheckFailure(
        "check",
        "manifest_http_" + ((ManifestClient.HttpFailure) error).status
      );
    }
    if (error instanceof org.json.JSONException) return new CheckFailure(
      "check",
      "manifest_invalid"
    );
    if (error instanceof java.io.IOException) {
      return new CheckFailure("check", "manifest_network_" + error.getClass().getSimpleName());
    }
    return new CheckFailure("check", "manifest_check_failed");
  }

  interface Reporter {
    void report(CheckFailure failure) throws Exception;
  }

  static <T> T observe(Callable<T> operation, Reporter reporter) throws Exception {
    try {
      return operation.call();
    } catch (Exception error) {
      CheckFailure failure = from(error);
      if (failure != null) reporter.report(failure);
      throw error;
    }
  }
}
