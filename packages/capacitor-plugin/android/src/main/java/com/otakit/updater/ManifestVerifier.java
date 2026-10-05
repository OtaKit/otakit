package com.otakit.updater;

import android.util.Base64;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.List;

final class ManifestVerifier {

  static final class KeyEntry {

    final String kid;
    final byte[] derData;

    KeyEntry(String kid, byte[] derData) {
      this.kid = kid;
      this.derData = derData;
    }
  }

  private ManifestVerifier() {}

  static final class VerificationException extends Exception {

    final String reason;

    VerificationException(String reason) {
      super("Manifest verification failed: " + reason);
      this.reason = reason;
    }
  }

  /**
   * Verify a manifest signature using ES256 (ECDSA P-256 + SHA-256).
   *
   * @throws Exception on verification failure (unknown kid, expired, invalid signature).
   */
  static void verify(
    String appId,
    String channel,
    String version,
    String sha256,
    int size,
    String runtimeVersion,
    String strategy,
    boolean forceImmediate,
    ManifestClient.ManifestEncryption encryption,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    String payload = buildCanonicalPayload(
      "MANIFEST",
      bundlePayloadLines(
        appId,
        channel,
        version,
        sha256,
        size,
        runtimeVersion,
        strategy,
        forceImmediate,
        encryption
      ),
      signature
    );
    verifyCanonicalPayload(payload, signature, trustedKeys);
  }

  /**
   * Verify a manifest's rollout block (plugin 3.1+). Same key and format as the top level under
   * its own header, plus the rollout lines; must match the server's buildRolloutPayload
   * byte-for-byte.
   */
  static void verifyRollout(
    String appId,
    String channel,
    ManifestClient.ManifestRollout rollout,
    String stableSha256,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    ManifestClient.LatestManifest manifest = rollout.manifest;
    List<String> lines = bundlePayloadLines(
      appId,
      channel,
      manifest.version,
      manifest.sha256,
      manifest.size,
      manifest.runtimeVersion,
      manifest.strategy,
      manifest.forceImmediate,
      manifest.encryption
    );
    lines.add("percent:" + rollout.percent);
    lines.add("releaseId:" + manifest.releaseId);
    lines.add("stableSha256:" + stableSha256);
    lines.add("notesSha256:null");
    verifyCanonicalPayload(
      buildCanonicalPayload("ROLLOUT", lines, signature),
      signature,
      trustedKeys
    );
  }

  /**
   * Verify a manifest entry's notes block (plugin 3.3+). It binds the text (by hash) to its
   * release, bundle and lane; must match the server's buildNotesPayload byte-for-byte.
   */
  static void verifyNotes(
    String appId,
    String channel,
    String releaseId,
    String sha256,
    String text,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    List<String> lines = new ArrayList<>();
    lines.add("appId:" + appId);
    lines.add("channel:" + (channel != null ? channel : "null"));
    lines.add("releaseId:" + releaseId);
    lines.add("sha256:" + sha256);
    lines.add("notesSha256:" + sha256Hex(text));
    verifyCanonicalPayload(
      buildCanonicalPayload("NOTES", lines, signature),
      signature,
      trustedKeys
    );
  }

  /** Lowercase hex SHA-256 of the UTF-8 bytes, as the server computes it. */
  static String sha256Hex(String text) {
    try {
      byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(
        text.getBytes(java.nio.charset.StandardCharsets.UTF_8)
      );
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte value : digest) hex.append(String.format("%02x", value));
      return hex.toString();
    } catch (java.security.NoSuchAlgorithmException error) {
      throw new IllegalStateException(error);
    }
  }

  private static void verifyCanonicalPayload(
    String payload,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    try {
      verifyPayload(payload, signature, trustedKeys);
    } catch (VerificationException error) {
      throw error;
    } catch (Exception error) {
      VerificationException failure = new VerificationException("signature_invalid");
      failure.initCause(error);
      throw failure;
    }
  }

  private static void verifyPayload(
    String payload,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    // Check expiry
    long now = System.currentTimeMillis() / 1000;
    if (signature.exp <= now) {
      throw new VerificationException("signature_expired");
    }

    // Find matching key
    KeyEntry keyEntry = null;
    for (KeyEntry entry : trustedKeys) {
      if (entry.kid.equals(signature.kid)) {
        keyEntry = entry;
        break;
      }
    }
    if (keyEntry == null) {
      throw new VerificationException("signature_unknown_key");
    }

    // Decode base64url signature
    byte[] sigBytes = base64UrlDecode(signature.sig);

    // Verify with java.security
    X509EncodedKeySpec keySpec = new X509EncodedKeySpec(keyEntry.derData);
    KeyFactory keyFactory = KeyFactory.getInstance("EC");
    PublicKey verificationKey = keyFactory.generatePublic(keySpec);

    Signature verifier = Signature.getInstance("SHA256withECDSA");
    verifier.initVerify(verificationKey);
    verifier.update(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));

    if (!verifier.verify(sigBytes)) {
      throw new VerificationException("signature_invalid");
    }
  }

  /**
   * Encode the encryption block for the canonical payload.
   * Must match the server's encodeEncryptionForPayload exactly.
   */
  private static String encodeEncryptionForPayload(ManifestClient.ManifestEncryption encryption) {
    if (encryption == null) {
      return "null";
    }
    return (
      encryption.alg +
      "|" +
      encryption.kid +
      "|" +
      encryption.wrapNonce +
      "|" +
      encryption.wrappedDek +
      "|" +
      encryption.nonce
    );
  }

  /**
   * Canonical payload v2 — must match the server's buildCanonicalPayload / buildRolloutPayload
   * (console/lib/manifest-signing.ts) and the iOS mirror byte-for-byte.
   */
  static String buildCanonicalPayload(
    String header,
    List<String> bundleLines,
    ManifestClient.ManifestSignature signature
  ) {
    List<String> lines = new ArrayList<>();
    lines.add(header);
    lines.addAll(bundleLines);
    lines.add("kid:" + signature.kid);
    lines.add("iat:" + signature.iat);
    lines.add("exp:" + signature.exp);
    return String.join("\n", lines);
  }

  static List<String> bundlePayloadLines(
    String appId,
    String channel,
    String version,
    String sha256,
    int size,
    String runtimeVersion,
    String strategy,
    boolean forceImmediate,
    ManifestClient.ManifestEncryption encryption
  ) {
    List<String> lines = new ArrayList<>();
    lines.add("appId:" + appId);
    lines.add("channel:" + (channel != null ? channel : "null"));
    lines.add("version:" + version);
    lines.add("sha256:" + sha256);
    lines.add("size:" + size);
    lines.add("runtimeVersion:" + (runtimeVersion != null ? runtimeVersion : "null"));
    lines.add("strategy:" + strategy);
    lines.add("forceImmediate:" + (forceImmediate ? "true" : "false"));
    lines.add("encryption:" + encodeEncryptionForPayload(encryption));
    return lines;
  }

  private static byte[] base64UrlDecode(String input) {
    // Convert base64url to standard base64
    String base64 = input.replace('-', '+').replace('_', '/');
    int remainder = base64.length() % 4;
    if (remainder > 0) {
      base64 += "====".substring(remainder);
    }
    return Base64.decode(base64, Base64.DEFAULT);
  }
}
