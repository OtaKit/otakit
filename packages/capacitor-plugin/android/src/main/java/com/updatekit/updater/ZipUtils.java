package com.updatekit.updater;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class ZipUtils {

  private static final int MAX_FILES = 10_000;
  private static final long MAX_TOTAL_SIZE = 500_000_000L; // 500MB

  void extractSecurely(File zipFile, File destination) throws Exception {
    String canonicalDestination = destination.getCanonicalPath();
    String destinationPrefix = canonicalDestination.endsWith(File.separator)
      ? canonicalDestination
      : canonicalDestination + File.separator;

    int fileCount = 0;
    long totalSize = 0L;

    try (ZipInputStream zis = new ZipInputStream(new FileInputStream(zipFile))) {
      ZipEntry entry;
      while ((entry = zis.getNextEntry()) != null) {
        String name = entry.getName();
        if (name.contains("..") || name.startsWith("/") || name.startsWith("\\")) {
          throw new SecurityException("Zip path traversal attempt: " + name);
        }

        File outFile = new File(destination, name);
        String outPath = outFile.getCanonicalPath();
        if (!(outPath.equals(canonicalDestination) || outPath.startsWith(destinationPrefix))) {
          throw new SecurityException("Zip entry escapes destination: " + name);
        }

        if (entry.isDirectory()) {
          if (!outFile.exists() && !outFile.mkdirs()) {
            throw new IllegalStateException(
              "Cannot create directory: " + outFile.getAbsolutePath()
            );
          }
          continue;
        }

        fileCount++;
        if (fileCount > MAX_FILES) {
          throw new SecurityException("Zip contains too many files");
        }

        File parent = outFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
          throw new IllegalStateException("Cannot create parent: " + parent.getAbsolutePath());
        }

        long entrySize = 0;
        try (FileOutputStream output = new FileOutputStream(outFile)) {
          byte[] buffer = new byte[8192];
          int read;
          while ((read = zis.read(buffer)) > 0) {
            output.write(buffer, 0, read);
            entrySize += read;
            if (totalSize + entrySize > MAX_TOTAL_SIZE) {
              throw new SecurityException("Zip extracted content exceeds max size");
            }
          }
        }
        totalSize += entrySize;
      }
    }
  }
}
