package com.otakit.core;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Map;
import org.json.JSONObject;

/** RN v3 only. Capacitor's existing v2 verifier is unchanged. */
public final class RNManifest {

  public static String canonical(JSONObject m) throws Exception {
    JSONObject signature = m.getJSONObject("signature");
    String encryption = "null";
    if (!m.isNull("encryption")) {
      JSONObject e = m.getJSONObject("encryption");
      encryption =
        string(e, "alg") +
        "|" +
        string(e, "kid") +
        "|" +
        string(e, "wrapNonce") +
        "|" +
        string(e, "wrappedDek") +
        "|" +
        string(e, "nonce");
    }
    return String.join(
      "\n",
      "MANIFEST:3",
      "appId:" + string(m, "appId"),
      "framework:" + string(m, "framework"),
      "platform:" + string(m, "platform"),
      "channel:" + (m.isNull("channel") ? "null" : JSONObject.quote(string(m, "channel"))),
      "version:" + string(m, "version"),
      "sha256:" + string(m, "sha256"),
      "contentHash:" + string(m, "contentHash"),
      "size:" + integer(m, "size"),
      "runtimeVersion:" + string(m, "runtimeVersion"),
      "strategy:" + string(m, "strategy"),
      "forceImmediate:" + m.getBoolean("forceImmediate"),
      "encryption:" + encryption,
      "releaseId:" + string(m, "releaseId"),
      "kid:" + string(signature, "kid"),
      "iat:" + integer(signature, "iat"),
      "exp:" + integer(signature, "exp")
    );
  }

  public static JSONObject verify(
    String json,
    String appId,
    String platform,
    String runtime,
    String channel,
    Map<String, byte[]> keys,
    long now
  ) throws Exception {
    return verify(json, appId, platform, runtime, channel, keys, now, false);
  }

  public static JSONObject verify(
    String json,
    String appId,
    String platform,
    String runtime,
    String channel,
    Map<String, byte[]> keys,
    long now,
    boolean allowExpiredCache
  ) throws Exception {
    if (json.getBytes(StandardCharsets.UTF_8).length > 4 * 1024 * 1024) throw new Exception(
      "Manifest exceeds size limit"
    );
    JSONObject m = new JSONObject(json);
    JSONObject s = m.getJSONObject("signature");
    String actualChannel = m.isNull("channel") ? null : string(m, "channel");
    String strategy = string(m, "strategy");
    if (
      !m.has("channel") ||
      !m.has("encryption") ||
      integer(m, "schemaVersion") != 3 ||
      !"react-native".equals(string(m, "framework")) ||
      !appId.equals(string(m, "appId")) ||
      !platform.equals(string(m, "platform")) ||
      !runtime.equals(string(m, "runtimeVersion")) ||
      !java.util.Objects.equals(channel, actualChannel) ||
      !(m.get("forceImmediate") instanceof Boolean) ||
      integer(m, "size") <= 0 ||
      integer(m, "size") > 100 * 1024 * 1024 ||
      !string(m, "sha256").matches("[a-f0-9]{64}") ||
      !string(m, "contentHash").matches("[a-f0-9]{64}") ||
      string(m, "version").isEmpty() ||
      string(m, "version").length() > 64 ||
      string(m, "version").matches("(?s).*[\\x00-\\x1f\\x7f].*") ||
      (channel != null && !channel.matches("[A-Za-z0-9._-]{1,64}")) ||
      integer(s, "iat") > now + 300 ||
      (!allowExpiredCache && integer(s, "exp") <= now) ||
      integer(s, "exp") <= integer(s, "iat") ||
      (!strategy.equals("zip") && !strategy.equals("deltas"))
    ) throw new Exception("RN manifest target/schema mismatch");
    if (!m.isNull("encryption")) {
      JSONObject e = m.getJSONObject("encryption");
      if (
        !strategy.equals("zip") ||
        !string(e, "alg").equals("AES-256-GCM") ||
        !string(e, "kid").matches("[a-f0-9]{16}") ||
        Base64.getDecoder().decode(string(e, "nonce")).length != 12 ||
        Base64.getDecoder().decode(string(e, "wrapNonce")).length != 12 ||
        Base64.getDecoder().decode(string(e, "wrappedDek")).length != 48
      ) throw new Exception("Invalid RN encryption envelope");
    }
    if (
      strategy.equals("deltas") &&
      (!string(m, "sha256").equals(string(m, "contentHash")) ||
        m.getJSONArray("files").length() < 2 ||
        m.getJSONArray("files").length() > 5000)
    ) throw new Exception("Invalid RN delta identity");
    byte[] key = keys.get(string(s, "kid"));
    if (key == null) throw new Exception("Untrusted RN signing key");
    java.security.interfaces.ECPublicKey publicKey =
      (java.security.interfaces.ECPublicKey) KeyFactory.getInstance("EC").generatePublic(
        new X509EncodedKeySpec(key)
      );
    if (!isP256(publicKey.getParams())) throw new Exception("Expected P-256 signing key");
    Signature verifier = Signature.getInstance("SHA256withECDSA");
    verifier.initVerify(publicKey);
    verifier.update(canonical(m).getBytes(StandardCharsets.UTF_8));
    if (!verifier.verify(Base64.getUrlDecoder().decode(string(s, "sig")))) throw new Exception(
      "Invalid RN manifest signature"
    );
    return m;
  }

  // SEC 2 v2 section 2.4.2, https://www.secg.org/sec2-v2.pdf.
  // Android API 24 supports EC signatures but has no EC AlgorithmParameters provider.
  static boolean isP256(java.security.spec.ECParameterSpec value) {
    java.security.spec.EllipticCurve curve = value.getCurve();
    return (
      curve.getField() instanceof java.security.spec.ECFieldFp &&
      ((java.security.spec.ECFieldFp) curve.getField()).getP().equals(
        hex("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF")
      ) &&
      curve
        .getA()
        .equals(hex("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC")) &&
      curve
        .getB()
        .equals(hex("5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B")) &&
      value
        .getGenerator()
        .getAffineX()
        .equals(hex("6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296")) &&
      value
        .getGenerator()
        .getAffineY()
        .equals(hex("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5")) &&
      value
        .getOrder()
        .equals(hex("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551")) &&
      value.getCofactor() == 1
    );
  }

  private static java.math.BigInteger hex(String value) {
    return new java.math.BigInteger(value, 16);
  }

  static String string(JSONObject object, String key) throws Exception {
    Object value = object.get(key);
    if (!(value instanceof String)) throw new Exception("Expected string field: " + key);
    return (String) value;
  }

  static long integer(JSONObject object, String key) throws Exception {
    Object value = object.get(key);
    if (!(value instanceof Number)) throw new Exception("Expected numeric field: " + key);
    Number number = (Number) value;
    if (
      number.doubleValue() != number.longValue() ||
      Math.abs(number.doubleValue()) > 9007199254740991d
    ) throw new Exception("Invalid numeric field: " + key);
    return number.longValue();
  }
}
