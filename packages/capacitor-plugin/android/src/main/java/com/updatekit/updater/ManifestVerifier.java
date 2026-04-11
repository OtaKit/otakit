package com.updatekit.updater;

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
    String platform,
    String version,
    String sha256,
    int size,
    String runtimeVersion,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    String payload = buildCanonicalPayload(
      appId,
      channel,
      platform,
      version,
      sha256,
      size,
      runtimeVersion,
      signature.kid,
      signature.iat,
      signature.exp
    );
    verifyPayload(payload, signature, trustedKeys);
  }

  static void verifyLegacy(
    String appId,
    String channel,
    String platform,
    String version,
    String sha256,
    int size,
    ManifestClient.ManifestSignature signature,
    List<KeyEntry> trustedKeys
  ) throws Exception {
    String payload = buildLegacyCanonicalPayload(
      appId,
      channel,
      platform,
      version,
      sha256,
      size,
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

  private static String buildCanonicalPayload(
    String appId,
    String channel,
    String platform,
    String version,
    String sha256,
    int size,
    String runtimeVersion,
    String kid,
    int iat,
    int exp
  ) {
    return (
      "MANIFEST_V2\n" +
      "appId:" +
      appId +
      "\n" +
      "channel:" +
      (channel != null ? channel : "null") +
      "\n" +
      "platform:" +
      platform +
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

  private static String buildLegacyCanonicalPayload(
    String appId,
    String channel,
    String platform,
    String version,
    String sha256,
    int size,
    String kid,
    int iat,
    int exp
  ) {
    return (
      "MANIFEST_V1\n" +
      "appId:" +
      appId +
      "\n" +
      "channel:" +
      (channel != null ? channel : "null") +
      "\n" +
      "platform:" +
      platform +
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
      "minNativeBuild:null" +
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
