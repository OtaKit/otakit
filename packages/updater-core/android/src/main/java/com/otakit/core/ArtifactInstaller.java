package com.otakit.core;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;
import org.json.JSONArray;
import org.json.JSONObject;

/** RN-only installation. Validate the complete inventory before creating payload files. */
public final class ArtifactInstaller {

  public static final long MAX_BYTES = 100 * 1024 * 1024;
  private final JSONObject folding;

  public ArtifactInstaller(byte[] caseFoldingData) throws Exception {
    folding = new JSONObject(new String(caseFoldingData, StandardCharsets.UTF_8));
  }

  private String comparisonKey(String value) throws Exception {
    String normalized = Normalizer.normalize(value, Normalizer.Form.NFD);
    StringBuilder result = new StringBuilder();
    for (int offset = 0; offset < normalized.length(); ) {
      int codepoint = normalized.codePointAt(offset);
      String character = new String(Character.toChars(codepoint));
      result.append(folding.has(character) ? folding.getString(character) : character);
      offset += Character.charCount(codepoint);
    }
    return Normalizer.normalize(result, Normalizer.Form.NFD);
  }

  public void validatePaths(List<String> paths) throws Exception {
    if (paths.size() < 2 || paths.size() > 5000) throw invalid();
    Map<String, String> spellings = new HashMap<>();
    Set<String> directories = new HashSet<>();
    for (String path : paths) {
      if (
        path.isEmpty() ||
        path.getBytes(StandardCharsets.UTF_8).length > 512 ||
        path.indexOf('\\') >= 0 ||
        path.matches("(?s).*[\\x00-\\x1f\\x7f].*") ||
        !new String(path.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8).equals(path)
      ) throw invalid();
      String[] parts = path.split("/", -1);
      String spelling = "";
      for (int i = 0; i < parts.length; i++) {
        String part = parts[i];
        if (
          part.isEmpty() ||
          part.equals(".") ||
          part.equals("..") ||
          part.getBytes(StandardCharsets.UTF_8).length > 255
        ) throw invalid();
        spelling += (i == 0 ? "" : "/") + part;
        String key = comparisonKey(spelling);
        boolean directory = i < parts.length - 1;
        if (
          i == 0 &&
          (key.equals("bundle.json") ||
            key.equals("otakit_files.json") ||
            key.equals("otakit-embedded.json"))
        ) throw invalid();
        if (
          spellings.containsKey(key) &&
          (!spellings.get(key).equals(spelling) || !directory || !directories.contains(key))
        ) throw invalid();
        spellings.put(key, spelling);
        if (directory) directories.add(key);
      }
    }
    if (!paths.contains("index.bundle") || !paths.contains("otakit-bundle.json")) throw invalid();
  }

  public void validateDeltaInventory(JSONObject manifest) throws Exception {
    JSONArray files = manifest.getJSONArray("files");
    List<String> paths = new ArrayList<>();
    long total = 0;
    Map<String, Long> sizes = new HashMap<>();
    for (int i = 0; i < files.length(); i++) {
      JSONObject file = files.getJSONObject(i);
      String path = RNManifest.string(file, "path");
      String hash = RNManifest.string(file, "sha256");
      long size = RNManifest.integer(file, "size");
      if (
        !hash.matches("[a-f0-9]{64}") ||
        size < 0 ||
        size > MAX_BYTES - total ||
        (sizes.containsKey(hash) && sizes.get(hash) != size) ||
        ((path.equals("index.bundle") || path.equals("otakit-bundle.json")) && size == 0)
      ) throw invalid();
      paths.add(path);
      sizes.put(hash, size);
      total += size;
    }
    validatePaths(paths);
    if (
      total != RNManifest.integer(manifest, "size") ||
      !inventoryHash(files).equals(manifest.getString("contentHash"))
    ) throw invalid();
  }

  public JSONArray installZip(
    File archive,
    File root,
    JSONObject manifest,
    Map<String, byte[]> keys,
    String rnVersion,
    int bytecodeVersion
  ) throws Exception {
    byte[] bytes = readBounded(archive.toPath(), MAX_BYTES);
    if (
      bytes.length != RNManifest.integer(manifest, "size") ||
      !hash(bytes).equals(manifest.getString("sha256"))
    ) throw invalid();
    if (!manifest.isNull("encryption")) {
      JSONObject e = manifest.getJSONObject("encryption");
      byte[] key = keys.get(e.getString("kid"));
      if (
        key == null ||
        key.length != 32 ||
        !hash(key).substring(0, 16).equals(e.getString("kid")) ||
        !e.getString("alg").equals("AES-256-GCM")
      ) throw invalid();
      byte[] dek = decrypt(
        key,
        Base64.getDecoder().decode(e.getString("wrapNonce")),
        Base64.getDecoder().decode(e.getString("wrappedDek"))
      );
      if (dek.length != 32) throw invalid();
      bytes = decrypt(dek, Base64.getDecoder().decode(e.getString("nonce")), bytes);
    }
    Path temporary = Files.createTempFile(archive.toPath().getParent(), "otakit-plain-", ".zip");
    try {
      Files.write(temporary, bytes);
      try (ZipFile zip = new ZipFile(temporary.toFile())) {
        if (zip.isEncrypted() || zip.isSplitArchive()) throw invalid();
        List<FileHeader> headers = zip.getFileHeaders();
        List<String> paths = new ArrayList<>();
        long total = 0;
        if (headers.size() > 5000) throw invalid();
        for (FileHeader header : headers) {
          byte[] attributes = header.getExternalFileAttributes();
          int type =
            attributes == null || attributes.length != 4
              ? 0
              : (((attributes[3] & 0xff) << 8) | (attributes[2] & 0xff)) & 0170000;
          if (
            header.isDirectory() ||
            header.isEncrypted() ||
            header.getDiskNumberStart() != 0 ||
            (type != 0 && type != 0100000) ||
            (attributes != null && attributes.length == 4 && (attributes[0] & 0x10) != 0) ||
            header.getUncompressedSize() < 0 ||
            header.getUncompressedSize() > MAX_BYTES - total
          ) throw invalid();
          total += header.getUncompressedSize();
          paths.add(header.getFileName());
        }
        validatePaths(paths);
        Path canonical = root.getCanonicalFile().toPath();
        try (java.util.stream.Stream<Path> entries = Files.list(canonical)) {
          if (entries.findAny().isPresent()) throw invalid();
        }
        for (FileHeader header : headers) {
          Path destination = canonical.resolve(header.getFileName());
          if (
            destination.toString().getBytes(StandardCharsets.UTF_8).length + 1 > 4096
          ) throw invalid();
          Files.createDirectories(destination.getParent());
          long written = 0;
          try (
            InputStream input = zip.getInputStream(header);
            OutputStream output = Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW)
          ) {
            byte[] chunk = new byte[8192];
            int length;
            while ((length = input.read(chunk)) != -1) {
              if (length > header.getUncompressedSize() - written) throw invalid();
              output.write(chunk, 0, length);
              written += length;
            }
          }
          if (written != header.getUncompressedSize()) throw invalid();
        }
        return verifyDirectory(root, manifest, rnVersion, bytecodeVersion, paths);
      }
    } finally {
      Files.deleteIfExists(temporary);
    }
  }

  public JSONArray verifyDirectory(
    File directory,
    JSONObject manifest,
    String rnVersion,
    int bytecodeVersion,
    List<String> expectedPaths
  ) throws Exception {
    Path root = directory.getCanonicalFile().toPath();
    if (expectedPaths == null && manifest.has("files")) {
      expectedPaths = new ArrayList<>();
      JSONArray files = manifest.getJSONArray("files");
      for (int i = 0; i < files.length(); i++) expectedPaths.add(
        files.getJSONObject(i).getString("path")
      );
    }
    Map<String, String> original = new HashMap<>();
    if (expectedPaths != null) {
      validatePaths(expectedPaths);
      for (String path : expectedPaths)
        original.put(Normalizer.normalize(path, Normalizer.Form.NFD), path);
    }
    JSONArray files = new JSONArray();
    long total = 0;
    List<String> actualPaths = new ArrayList<>();
    try (java.util.stream.Stream<Path> entries = Files.walk(root)) {
      java.util.Iterator<Path> iterator = entries.iterator();
      while (iterator.hasNext()) {
        Path file = iterator.next();
        BasicFileAttributes attributes = Files.readAttributes(
          file,
          BasicFileAttributes.class,
          LinkOption.NOFOLLOW_LINKS
        );
        if (
          attributes.isSymbolicLink() || (!attributes.isDirectory() && !attributes.isRegularFile())
        ) throw invalid();
        if (attributes.isDirectory()) continue;
        if (
          attributes.size() < 0 || attributes.size() > MAX_BYTES - total || files.length() >= 5000
        ) throw invalid();
        String diskPath = root.relativize(file).toString().replace(File.separatorChar, '/');
        String path =
          expectedPaths == null
            ? diskPath
            : original.get(Normalizer.normalize(diskPath, Normalizer.Form.NFD));
        if (path == null) throw invalid();
        byte[] bytes = readBounded(file, MAX_BYTES - total);
        total += bytes.length;
        files.put(
          new JSONObject().put("path", path).put("sha256", hash(bytes)).put("size", bytes.length)
        );
        actualPaths.add(path);
      }
    }
    validatePaths(actualPaths);
    if (
      (expectedPaths != null && expectedPaths.size() != files.length()) ||
      !inventoryHash(files).equals(manifest.getString("contentHash"))
    ) throw invalid();
    if (manifest.getString("strategy").equals("deltas")) {
      validateDeltaInventory(manifest);
      Map<String, JSONObject> declared = new HashMap<>();
      JSONArray entries = manifest.getJSONArray("files");
      for (int i = 0; i < entries.length(); i++) declared.put(
        entries.getJSONObject(i).getString("path"),
        entries.getJSONObject(i)
      );
      if (total != manifest.getLong("size") || declared.size() != files.length()) throw invalid();
      for (int i = 0; i < files.length(); i++) {
        JSONObject actual = files.getJSONObject(i);
        JSONObject expected = declared.get(actual.getString("path"));
        if (
          expected == null ||
          actual.getLong("size") != expected.getLong("size") ||
          !actual.getString("sha256").equals(expected.getString("sha256"))
        ) throw invalid();
      }
    }
    JSONObject descriptor = new JSONObject(
      new String(
        readBounded(root.resolve("otakit-bundle.json"), 256 * 1024),
        StandardCharsets.UTF_8
      )
    );
    if (
      !RNManifest.string(descriptor, "format").equals("otakit-rn") ||
      RNManifest.integer(descriptor, "formatVersion") != 1 ||
      !RNManifest.string(descriptor, "framework").equals("react-native") ||
      !RNManifest.string(descriptor, "entryPoint").equals("index.bundle") ||
      !RNManifest.string(descriptor, "engine").equals("hermes") ||
      !RNManifest.string(descriptor, "bundleFormat").equals("hermes-bytecode") ||
      !RNManifest.string(descriptor, "reactNativeVersion").equals(rnVersion)
    ) throw invalid();
    for (String field : new String[] { "platform", "runtimeVersion", "version" })
      if (!RNManifest.string(descriptor, field).equals(manifest.getString(field))) throw invalid();
    byte[] bytecode = readBounded(root.resolve("index.bundle"), MAX_BYTES);
    byte[] magic = { (byte) 0xc6, 0x1f, (byte) 0xbc, 0x03, (byte) 0xc1, 0x03, 0x19, 0x1f };
    if (bytecode.length < 12) throw invalid();
    for (int i = 0; i < magic.length; i++) if (bytecode[i] != magic[i]) throw invalid();
    long version = 0;
    for (int i = 0; i < 4; i++) version |= (long) (bytecode[i + 8] & 0xff) << (8 * i);
    if (version != bytecodeVersion) throw invalid();
    if (descriptor.has("expo")) {
      JSONObject expo = descriptor.getJSONObject("expo");
      if (!expo.getString("configFile").equals("expo-config.json")) throw invalid();
      new JSONObject(
        new String(
          readBounded(root.resolve("expo-config.json"), 256 * 1024),
          StandardCharsets.UTF_8
        )
      );
      if (
        expo.has("domRoot") &&
        (!expo.getString("domRoot").equals("www.bundle") ||
          actualPaths
            .stream()
            .noneMatch(path -> path.startsWith("www.bundle/") && path.endsWith(".html")))
      ) throw invalid();
    }
    return files;
  }

  public static byte[] readBounded(Path path, long limit) throws Exception {
    try (
      InputStream input = Files.newInputStream(path);
      ByteArrayOutputStream output = new ByteArrayOutputStream()
    ) {
      byte[] chunk = new byte[8192];
      int length;
      while ((length = input.read(chunk)) != -1) {
        if (length > limit - output.size()) throw invalid();
        output.write(chunk, 0, length);
      }
      return output.toByteArray();
    }
  }

  public static String hash(byte[] bytes) throws Exception {
    StringBuilder result = new StringBuilder();
    for (byte value : MessageDigest.getInstance("SHA-256").digest(bytes))
      result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
    return result.toString();
  }

  public static String inventoryHash(JSONArray files) throws Exception {
    List<JSONObject> sorted = new ArrayList<>();
    for (int i = 0; i < files.length(); i++) sorted.add(files.getJSONObject(i));
    sorted.sort((left, right) -> {
      byte[] a = left.optString("path").getBytes(StandardCharsets.UTF_8);
      byte[] b = right.optString("path").getBytes(StandardCharsets.UTF_8);
      for (int i = 0; i < Math.min(a.length, b.length); i++) if (
        a[i] != b[i]
      ) return Integer.compare(a[i] & 0xff, b[i] & 0xff);
      return Integer.compare(a.length, b.length);
    });
    StringBuilder canonical = new StringBuilder();
    for (JSONObject file : sorted) {
      if (canonical.length() > 0) canonical.append('\n');
      canonical.append(file.getString("path")).append(':').append(file.getString("sha256"));
    }
    return hash(canonical.toString().getBytes(StandardCharsets.UTF_8));
  }

  private static byte[] decrypt(byte[] key, byte[] nonce, byte[] bytes) throws Exception {
    if (nonce.length != 12 || bytes.length < 16) throw invalid();
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
      Cipher.DECRYPT_MODE,
      new SecretKeySpec(key, "AES"),
      new GCMParameterSpec(128, nonce)
    );
    return cipher.doFinal(bytes);
  }

  private static Exception invalid() {
    return new Exception("INCOMPATIBLE_ARTIFACT");
  }
}
