package com.otakit.updater;

import android.util.Base64;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
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
      appId,
      channel,
      version,
      sha256,
      size,
      runtimeVersion,
      strategy,
      forceImmediate,
      encryption,
      signature.kid,
      signature.iat,
      signature.exp
    );
    verifyPayload(payload, signature, trustedKeys);
  }

  private static void verifyPayload(
    String payload,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    // Check expiry
    long now = System.currentTimeMillis() / 1000;
    if (signature.exp <= now) {
      throw new IllegalStateException("Manifest signature expired");
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
      throw new IllegalStateException("Unknown signing key ID: " + signature.kid);
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
      throw new IllegalStateException("Manifest signature verification failed");
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
   * Canonical payload v2 — must match the server's buildCanonicalPayload
   * (console/lib/manifest-signing.ts) and the iOS mirror byte-for-byte.
   */
  private static String buildCanonicalPayload(
    String appId,
    String channel,
    String version,
    String sha256,
    int size,
    String runtimeVersion,
    String strategy,
    boolean forceImmediate,
    ManifestClient.ManifestEncryption encryption,
    String kid,
    int iat,
    int exp
  ) {
    return (
      "MANIFEST\n" +
      "appId:" +
      appId +
      "\n" +
      "channel:" +
      (channel != null ? channel : "null") +
      "\n" +
      "version:" +
      version +
      "\n" +
      "sha256:" +
      sha256 +
      "\n" +
      "size:" +
      size +
      "\n" +
      "runtimeVersion:" +
      (runtimeVersion != null ? runtimeVersion : "null") +
      "\n" +
      "strategy:" +
      strategy +
      "\n" +
      "forceImmediate:" +
      (forceImmediate ? "true" : "false") +
      "\n" +
      "encryption:" +
      encodeEncryptionForPayload(encryption) +
      "\n" +
      "kid:" +
      kid +
      "\n" +
      "iat:" +
      iat +
      "\n" +
      "exp:" +
      exp
    );
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
