package com.otakit.updater;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Assembles a delta-strategy bundle from per-file content-addressed objects.
 *
 * <p>The content cache ({@code otakit_files/<sha256>}) is the device-side
 * state: previous bundles and the builtin seed populate it, and assembling a
 * new bundle downloads only the cache misses. Mirrors DeltaAssembler.swift.
 */
final class DeltaAssembler {

  // Mirror ZipUtils' extraction limits.
  private static final int MAX_FILES = 10_000;
  private static final long MAX_TOTAL_SIZE = 500_000_000L; // 500 MB
  private static final int MAX_PATH_LENGTH = 512;

  private static final String BUILTIN_SEED_MARKER_NAME = "builtin_seed.json";

  private final File cacheDirectory;
  private final boolean allowInsecureUrls;

  DeltaAssembler(File cacheDirectory, boolean allowInsecureUrls) {
    this.cacheDirectory = cacheDirectory;
    this.allowInsecureUrls = allowInsecureUrls;
  }

  // ── Canonical file list ─────────────────────────────────────────────

  /**
   * Canonical file list hash — must match the server's computeFilesHash
   * (console/lib/delta-files.ts) and the iOS mirror byte-for-byte: entries
   * sorted by UTF-8 bytes of path, lines {@code <path>:<sha256 lowercase>},
   * joined with "\n", hashed with SHA-256 (hex).
   */
  static String computeFilesHash(List<ManifestClient.ManifestFileEntry> entries) throws Exception {
    List<ManifestClient.ManifestFileEntry> sorted = new ArrayList<>(entries);
    sorted.sort((lhs, rhs) -> {
      byte[] lhsBytes = lhs.path.getBytes(StandardCharsets.UTF_8);
      byte[] rhsBytes = rhs.path.getBytes(StandardCharsets.UTF_8);
      int limit = Math.min(lhsBytes.length, rhsBytes.length);
      for (int index = 0; index < limit; index++) {
        int lhsByte = lhsBytes[index] & 0xff;
        int rhsByte = rhsBytes[index] & 0xff;
        if (lhsByte != rhsByte) {
          return Integer.compare(lhsByte, rhsByte);
        }
      }
      return Integer.compare(lhsBytes.length, rhsBytes.length);
    });

    StringBuilder canonical = new StringBuilder();
    for (int index = 0; index < sorted.size(); index++) {
      if (index > 0) {
        canonical.append('\n');
      }
      ManifestClient.ManifestFileEntry entry = sorted.get(index);
      canonical.append(entry.path).append(':').append(entry.sha256.toLowerCase());
    }

    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
    StringBuilder builder = new StringBuilder();
    for (byte b : hash) {
      builder.append(String.format("%02x", b));
    }
    return builder.toString();
  }

  // ── Validation ──────────────────────────────────────────────────────

  private static boolean isValidEntryPath(String path) {
    if (path == null || path.isEmpty() || path.length() > MAX_PATH_LENGTH) {
      return false;
    }
    if (path.startsWith("/") || path.contains("\\")) {
      return false;
    }
    for (String segment : path.split("/", -1)) {
      if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
        return false;
      }
    }
    for (int index = 0; index < path.length(); index++) {
      char c = path.charAt(index);
      if (c < 0x20 || c == 0x7f) {
        return false;
      }
    }
    // Metadata files the plugin writes into the bundle directory; an app
    // file with the same root-level name would be overwritten.
    if ("bundle.json".equals(path) || "otakit_files.json".equals(path)) {
      return false;
    }
    return true;
  }

  void validate(List<ManifestClient.ManifestFileEntry> entries, String expectedFilesHash)
    throws Exception {
    if (entries == null || entries.isEmpty()) {
      throw new IllegalStateException("Delta manifest has no files");
    }
    if (entries.size() > MAX_FILES) {
      throw new IllegalStateException("Delta manifest exceeds file count limit: " + entries.size());
    }

    Set<String> seenPaths = new HashSet<>();
    long totalSize = 0;
    for (ManifestClient.ManifestFileEntry entry : entries) {
      if (!isValidEntryPath(entry.path)) {
        throw new IllegalStateException("Invalid file path in delta manifest: " + entry.path);
      }
      if (!seenPaths.add(entry.path)) {
        throw new IllegalStateException("Duplicate file path in delta manifest: " + entry.path);
      }
      if (entry.size > 0) {
        totalSize += entry.size;
        if (totalSize > MAX_TOTAL_SIZE) {
          throw new IllegalStateException("Delta manifest exceeds total size limit: " + totalSize);
        }
      }
    }

    if (!seenPaths.contains("index.html")) {
      throw new IllegalStateException("Delta bundle does not contain index.html");
    }

    // The signed manifest sha256 is the filesHash; recomputing it here is what
    // extends signature coverage to every (path, sha256) pair.
    if (!computeFilesHash(entries).equals(expectedFilesHash.toLowerCase())) {
      throw new IllegalStateException("Delta file list does not match the signed filesHash");
    }
  }

  // ── Cache ───────────────────────────────────────────────────────────

  private File cachePath(String sha256) {
    return new File(cacheDirectory, sha256.toLowerCase());
  }

  private void ensureCached(ManifestClient.ManifestFileEntry entry, Context context)
    throws Exception {
    File cached = cachePath(entry.sha256);
    if (cached.exists()) {
      return;
    }

    URL url = new URL(entry.url);
    ManifestClient.requireHTTPS(url, allowInsecureUrls);

    File temporary = File.createTempFile("otakit-file-", ".tmp", context.getCacheDir());
    try {
      HttpURLConnection connection = (HttpURLConnection) url.openConnection();
      try {
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(60_000);

        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
          throw new IllegalStateException("File download failed with HTTP " + status);
        }

        try (
          InputStream input = connection.getInputStream();
          FileOutputStream output = new FileOutputStream(temporary)
        ) {
          byte[] buffer = new byte[8192];
          int read;
          while ((read = input.read(buffer)) > 0) {
            output.write(buffer, 0, read);
          }
        }
      } finally {
        connection.disconnect();
      }

      if (!HashUtils.verify(temporary, entry.sha256)) {
        throw new IllegalStateException("Downloaded file hash mismatch: " + entry.path);
      }

      if (!cached.exists()) {
        // Write via temp + rename so process death mid-copy can never leave
        // a truncated file at a content-addressed path (exists() implies
        // fully-written, hash-verified content).
        atomicCopyIntoCache(temporary, cached);
      }
    } finally {
      //noinspection ResultOfMethodCallIgnored
      temporary.delete();
    }
  }

  // ── Assembly ────────────────────────────────────────────────────────

  /**
   * Fill cache misses and lay out the bundle directory from the cache.
   * Entries must be validated first.
   */
  void assemble(List<ManifestClient.ManifestFileEntry> entries, File destination, Context context)
    throws Exception {
    if (destination.exists()) {
      deleteRecursively(destination);
    }
    if (!destination.mkdirs()) {
      throw new IllegalStateException("Cannot create assembly directory");
    }

    String destinationPrefix = destination.getCanonicalPath() + File.separator;

    for (ManifestClient.ManifestFileEntry entry : entries) {
      ensureCached(entry, context);

      File target = new File(destination, entry.path);
      // Defense in depth alongside isValidEntryPath (mirrors ZipUtils).
      if (!target.getCanonicalPath().startsWith(destinationPrefix)) {
        throw new IllegalStateException("Invalid file path in delta manifest: " + entry.path);
      }
      File parent = target.getParentFile();
      if (parent != null && !parent.exists() && !parent.mkdirs()) {
        throw new IllegalStateException("Cannot create parent: " + parent.getAbsolutePath());
      }
      copyFile(cachePath(entry.sha256), target);
    }
  }

  // ── Builtin seeding ─────────────────────────────────────────────────

  private File builtinSeedFile() {
    return new File(cacheDirectory, BUILTIN_SEED_MARKER_NAME);
  }

  private JSONObject readBuiltinSeed() {
    try (FileInputStream input = new FileInputStream(builtinSeedFile())) {
      java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) > 0) {
        out.write(buffer, 0, read);
      }
      return new JSONObject(new String(out.toByteArray(), StandardCharsets.UTF_8));
    } catch (Exception e) {
      return null;
    }
  }

  /**
   * Hash the store-build web assets into the cache once per native build, so
   * the first OTA only downloads what changed relative to the binary.
   * Best-effort: failures only cost extra downloads.
   */
  void seedFromBuiltinIfNeeded(Context context, String assetPath, String nativeBuild) {
    JSONObject seed = readBuiltinSeed();
    if (seed != null && nativeBuild.equals(seed.optString("nativeBuild"))) {
      return;
    }

    List<String> hashes = new ArrayList<>();
    try {
      seedAssetDirectory(context.getAssets(), assetPath, hashes, context);
    } catch (Exception e) {
      android.util.Log.w("OtaKit", "builtin delta seed failed", e);
      return;
    }

    try {
      JSONObject newSeed = new JSONObject();
      newSeed.put("nativeBuild", nativeBuild);
      newSeed.put("hashes", new JSONArray(hashes));
      try (FileOutputStream output = new FileOutputStream(builtinSeedFile())) {
        output.write(newSeed.toString().getBytes(StandardCharsets.UTF_8));
      }
    } catch (Exception e) {
      android.util.Log.w("OtaKit", "builtin delta seed marker write failed", e);
    }
  }

  private void seedAssetDirectory(
    AssetManager assets,
    String assetPath,
    List<String> hashes,
    Context context
  ) throws Exception {
    String[] children = assets.list(assetPath);
    if (children == null || children.length == 0) {
      // Leaf: treat as a file.
      String sha256;
      try (InputStream input = assets.open(assetPath)) {
        sha256 = HashUtils.sha256(input);
      }
      File cached = cachePath(sha256);
      if (!cached.exists()) {
        File staging = new File(cacheDirectory, ".tmp-" + java.util.UUID.randomUUID());
        try (
          InputStream input = assets.open(assetPath);
          FileOutputStream output = new FileOutputStream(staging)
        ) {
          byte[] buffer = new byte[8192];
          int read;
          while ((read = input.read(buffer)) > 0) {
            output.write(buffer, 0, read);
          }
        }
        renameIntoCache(staging, cached);
      }
      hashes.add(sha256);
      return;
    }
    for (String child : children) {
      seedAssetDirectory(assets, assetPath + "/" + child, hashes, context);
    }
  }

  // ── Eviction ────────────────────────────────────────────────────────

  /**
   * Remove cache entries not referenced by any live bundle and not part of
   * the builtin seed. Best-effort.
   */
  void pruneCache(Set<String> referencedHashes) {
    Set<String> keep = new HashSet<>();
    for (String hash : referencedHashes) {
      keep.add(hash.toLowerCase());
    }
    JSONObject seed = readBuiltinSeed();
    if (seed != null) {
      JSONArray seedHashes = seed.optJSONArray("hashes");
      if (seedHashes != null) {
        for (int index = 0; index < seedHashes.length(); index++) {
          String hash = seedHashes.optString(index, null);
          if (hash != null) {
            keep.add(hash.toLowerCase());
          }
        }
      }
    }

    File[] items = cacheDirectory.listFiles();
    if (items == null) {
      return;
    }
    for (File item : items) {
      String name = item.getName();
      if (BUILTIN_SEED_MARKER_NAME.equals(name) || name.startsWith(".tmp-")) {
        continue;
      }
      if (!keep.contains(name.toLowerCase())) {
        //noinspection ResultOfMethodCallIgnored
        item.delete();
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private void atomicCopyIntoCache(File source, File destination) throws Exception {
    File staging = new File(cacheDirectory, ".tmp-" + java.util.UUID.randomUUID());
    copyFile(source, staging);
    renameIntoCache(staging, destination);
  }

  private static void renameIntoCache(File staging, File destination) throws Exception {
    if (!staging.renameTo(destination)) {
      //noinspection ResultOfMethodCallIgnored
      staging.delete();
      // A concurrent writer may have won the rename; that's fine.
      if (!destination.exists()) {
        throw new IllegalStateException("Failed to move cached file into place: " + destination);
      }
    }
  }

  private static void copyFile(File source, File destination) throws Exception {
    try (
      FileInputStream input = new FileInputStream(source);
      FileOutputStream output = new FileOutputStream(destination)
    ) {
      byte[] buffer = new byte[8192];
      int read;
      while ((read = input.read(buffer)) > 0) {
        output.write(buffer, 0, read);
      }
    }
  }

  private static void deleteRecursively(File target) {
    if (!target.exists()) {
      return;
    }
    File[] children = target.listFiles();
    if (children != null) {
      for (File child : children) {
        deleteRecursively(child);
      }
    }
    //noinspection ResultOfMethodCallIgnored
    target.delete();
  }
}
