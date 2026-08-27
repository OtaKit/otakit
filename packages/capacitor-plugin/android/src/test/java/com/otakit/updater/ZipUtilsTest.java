package com.otakit.updater;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class ZipUtilsTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  @Test
  public void extractsDataDescriptorArchiveWithAdjacentDotsInsideFilename() throws Exception {
    Map<String, byte[]> entries = new LinkedHashMap<>();
    entries.put("index.html", "home".getBytes());
    entries.put("assets/safe..chunk.js", "payload".getBytes());
    File archive = createArchive(entries);
    File destination = new File(temporaryFolder.getRoot(), "extracted");

    new ZipUtils().extractSecurely(archive, destination);

    assertArrayEquals(
      "payload".getBytes(),
      Files.readAllBytes(new File(destination, "assets/safe..chunk.js").toPath())
    );
  }

  @Test
  public void parentDirectoryCheckUsesPathComponentsNotSubstrings() {
    String[] safePaths = {
      "asset..js",
      "...",
      ".well-known/config.json",
      "dir/..hidden/file.js",
      "dir/name...js",
      "dir/%2E%2E/file.js",
    };
    for (String path : safePaths) {
      assertFalse("Expected safe path: " + path, ZipUtils.containsParentDirectoryComponent(path));
    }

    String[] unsafePaths = {
      "..",
      "../escape.js",
      "dir/../escape.js",
      "dir/..",
      "/../escape.js",
      "dir//../escape.js",
    };
    for (String path : unsafePaths) {
      assertTrue(
        "Expected parent-directory path component: " + path,
        ZipUtils.containsParentDirectoryComponent(path)
      );
    }
  }

  @Test
  public void rejectsExactParentDirectorySegmentWithoutEscapingDestination() throws Exception {
    Map<String, byte[]> entries = new LinkedHashMap<>();
    entries.put("assets/../../escape.js", "payload".getBytes());
    File archive = createArchive(entries);
    File destination = new File(temporaryFolder.getRoot(), "extracted");
    File escapedFile = new File(temporaryFolder.getRoot(), "escape.js");

    assertThrows(SecurityException.class, () ->
      new ZipUtils().extractSecurely(archive, destination)
    );

    assertFalse(escapedFile.exists());
  }

  private File createArchive(Map<String, byte[]> entries) throws Exception {
    File archive = temporaryFolder.newFile();
    try (ZipOutputStream output = new ZipOutputStream(new FileOutputStream(archive))) {
      for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
        output.putNextEntry(new ZipEntry(entry.getKey()));
        output.write(entry.getValue());
        output.closeEntry();
      }
    }
    return archive;
  }
}
