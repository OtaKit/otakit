package com.otakit.core;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Signed receipts are outside the hashed payload. Reverify every pointer before cold launch. */
public final class ArtifactCache {

  private final File root;
  private final JSONObject builtin;
  private final ArtifactInstaller installer;
  private final Map<String, byte[]> keys;
  private final String rnVersion;
  private final int bytecodeVersion;
  private final LaunchStore.DirectorySync directorySync;

  public ArtifactCache(
    File root,
    JSONObject builtin,
    ArtifactInstaller installer,
    Map<String, byte[]> keys,
    String rnVersion,
    int bytecodeVersion,
    LaunchStore.DirectorySync directorySync
  ) throws IOException {
    this.root = root.getCanonicalFile();
    this.builtin = builtin;
    this.installer = installer;
    this.keys = keys;
    this.rnVersion = rnVersion;
    this.bytecodeVersion = bytecodeVersion;
    this.directorySync = directorySync;
  }

  public File directory(String hash) throws Exception {
    if (!hash.matches("[a-f0-9]{64}")) throw new Exception("INCOMPATIBLE_ARTIFACT");
    return new File(root, "artifacts/" + hash);
  }

  public boolean verify(JSONObject artifact) throws Exception {
    for (String key : new String[] { "appId", "platform", "runtimeVersion" })
      if (!builtin.getString(key).equals(artifact.getString(key))) return false;
    if (artifact.optBoolean("embedded")) return (
      builtin.getString("contentHash").equals(artifact.getString("contentHash")) &&
      builtin.getString("version").equals(artifact.getString("version"))
    );
    try {
      File directory = directory(artifact.getString("contentHash"));
      if (
        !directory.equals(directory.getCanonicalFile()) ||
        !new File(directory, "index.bundle").getPath().equals(artifact.getString("bundlePath"))
      ) return false;
      String channel = artifact.isNull("channel") ? null : artifact.getString("channel");
      String raw = new String(
        Files.readAllBytes(
          new File(
            root,
            "receipts/" + receiptName(artifact.getString("contentHash"), channel)
          ).toPath()
        ),
        StandardCharsets.UTF_8
      );
      JSONObject manifest = RNManifest.verify(
        raw,
        builtin.getString("appId"),
        builtin.getString("platform"),
        builtin.getString("runtimeVersion"),
        channel,
        keys,
        System.currentTimeMillis() / 1000,
        true
      );
      if (
        !manifest.getString("contentHash").equals(artifact.getString("contentHash")) ||
        !manifest.getString("version").equals(artifact.getString("version"))
      ) return false;
      verifyDirectory(manifest);
      return true;
    } catch (NoSuchFileException error) {
      return false;
    } catch (IOException error) {
      throw error;
    } catch (Exception error) {
      return false;
    }
  }

  public JSONArray verifyDirectory(JSONObject manifest) throws Exception {
    File directory = directory(manifest.getString("contentHash"));
    if (!directory.equals(directory.getCanonicalFile())) throw new Exception(
      "INCOMPATIBLE_ARTIFACT"
    );
    JSONArray raw = new JSONArray(
      new String(
        Files.readAllBytes(
          new File(root, "receipts/" + manifest.getString("contentHash") + "-paths.json").toPath()
        ),
        StandardCharsets.UTF_8
      )
    );
    List<String> paths = new ArrayList<>();
    for (int i = 0; i < raw.length(); i++) paths.add(raw.getString(i));
    return installer.verifyDirectory(directory, manifest, rnVersion, bytecodeVersion, paths);
  }

  public void commit(File staging, JSONObject manifest, String receipt, JSONArray files)
    throws Exception {
    File destination = directory(manifest.getString("contentHash"));
    if (staging != null) {
      syncTree(staging.toPath());
      Files.createDirectories(destination.getParentFile().toPath());
      if (destination.exists()) throw new IOException("Artifact destination already exists");
      Files.move(staging.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE);
      directorySync.sync(destination.getParentFile());
    }
    File receipts = new File(root, "receipts");
    Files.createDirectories(receipts.toPath());
    JSONArray paths = new JSONArray();
    for (int i = 0; i < files.length(); i++) paths.put(files.getJSONObject(i).getString("path"));
    write(new File(receipts, manifest.getString("contentHash") + "-paths.json"), paths.toString());
    write(
      new File(
        receipts,
        receiptName(
          manifest.getString("contentHash"),
          manifest.isNull("channel") ? null : manifest.getString("channel")
        )
      ),
      receipt
    );
    directorySync.sync(receipts);
    directorySync.sync(root);
  }

  private static String receiptName(String hash, String channel) throws Exception {
    return (
      hash +
      "-" +
      ArtifactInstaller.hash(
        (channel == null ? "base" : "channel:" + channel).getBytes(StandardCharsets.UTF_8)
      ) +
      ".json"
    );
  }

  /** After durable recovery, serialize with downloads; never run against an active install. */
  public void collect(JSONObject state) throws Exception {
    Set<String> retained = new HashSet<>();
    for (String key : new String[] { "current", "lastGood", "previousGood", "staged" }) {
      JSONObject artifact =
        key.equals("current") || key.equals("lastGood")
          ? state.getJSONObject(key)
          : state.optJSONObject(key);
      if (artifact != null && !artifact.optBoolean("embedded")) {
        String hash = artifact.getString("contentHash");
        directory(hash);
        retained.add(hash);
      }
    }
    for (String name : new String[] { "artifacts", "receipts", "staging", "downloads" }) {
      File namespace = new File(root, name);
      Path path = namespace.toPath();
      if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) continue;
      if (
        !Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) ||
        !namespace.equals(namespace.getCanonicalFile())
      ) throw new IOException("Unexpected cache namespace");
      try (java.nio.file.DirectoryStream<Path> entries = Files.newDirectoryStream(path)) {
        for (Path entry : entries) {
          String file = entry.getFileName().toString();
          boolean obsolete;
          if (name.equals("artifacts")) obsolete =
            file.matches("[a-f0-9]{64}") && !retained.contains(file);
          else if (name.equals("receipts")) {
            boolean receipt = file.matches("[a-f0-9]{64}-(paths|[a-f0-9]{64})\\.json");
            obsolete =
              (receipt && !retained.contains(file.substring(0, 64))) ||
              file.matches("\\.[A-Fa-f0-9-]{36}\\.tmp");
          } else if (name.equals("staging")) obsolete = file.matches(
            "[A-Fa-f0-9]{8}(-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}"
          );
          else obsolete = file.matches("download-[A-Za-z0-9-]+\\.tmp");
          if (obsolete) removeTree(entry);
        }
      }
    }
  }

  private static void removeTree(Path path) throws IOException {
    // No FOLLOW_LINKS: both directory symlinks and nested links are unlinked, never followed.
    Files.walkFileTree(
      path,
      new SimpleFileVisitor<Path>() {
        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attributes)
          throws IOException {
          Files.delete(file);
          return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult postVisitDirectory(Path directory, IOException error)
          throws IOException {
          if (error != null) throw error;
          Files.delete(directory);
          return FileVisitResult.CONTINUE;
        }
      }
    );
  }

  private void write(File destination, String data) throws Exception {
    File temporary = new File(destination.getParentFile(), "." + UUID.randomUUID() + ".tmp");
    try {
      try (FileOutputStream output = new FileOutputStream(temporary)) {
        output.write(data.getBytes(StandardCharsets.UTF_8));
        output.getFD().sync();
      }
      Files.move(
        temporary.toPath(),
        destination.toPath(),
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING
      );
    } finally {
      Files.deleteIfExists(temporary.toPath());
    }
  }

  private void syncTree(Path path) throws Exception {
    if (Files.isSymbolicLink(path)) throw new IOException("Unexpected symbolic link");
    if (Files.isDirectory(path)) {
      try (java.util.stream.Stream<Path> children = Files.list(path)) {
        java.util.Iterator<Path> iterator = children.iterator();
        while (iterator.hasNext()) syncTree(iterator.next());
      }
      directorySync.sync(path.toFile());
    } else {
      try (
        java.nio.channels.FileChannel channel = java.nio.channels.FileChannel.open(
          path,
          java.nio.file.StandardOpenOption.WRITE
        )
      ) {
        channel.force(true);
      }
    }
  }
}
