package com.otakit.updater;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class ZipDownloader {

  static File download(URL url, File cacheDirectory, boolean allowInsecureUrls) throws Exception {
    ManifestClient.requireHTTPS(url, allowInsecureUrls);
    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    File destination = null;
    boolean complete = false;
    try {
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(60_000);
      int status = connection.getResponseCode();
      if (status < 200 || status >= 300) {
        throw new IllegalStateException("Download failed with HTTP " + status);
      }
      destination = File.createTempFile("otakit-", ".zip", cacheDirectory);
      try (
        InputStream input = connection.getInputStream();
        FileOutputStream output = new FileOutputStream(destination)
      ) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) {
          output.write(buffer, 0, read);
        }
      }
      complete = true;
      return destination;
    } finally {
      // The caller cannot own the file until this method returns successfully.
      if (!complete && destination != null) {
        //noinspection ResultOfMethodCallIgnored
        destination.delete();
      }
      connection.disconnect();
    }
  }
}
