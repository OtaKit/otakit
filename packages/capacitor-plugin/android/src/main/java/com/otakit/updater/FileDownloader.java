package com.otakit.updater;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class FileDownloader {

  static File download(URL url, File cacheDirectory, boolean allowInsecureUrls) throws Exception {
    return download(url, cacheDirectory, allowInsecureUrls, new DownloadRetry());
  }

  static File download(URL url, File cacheDirectory, boolean allowInsecureUrls, DownloadRetry retry)
    throws Exception {
    ManifestClient.requireHTTPS(url, allowInsecureUrls);
    return retry.run(() -> downloadOnce(url, cacheDirectory));
  }

  private static File downloadOnce(URL url, File cacheDirectory) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) DownloadRetry.network(url::openConnection);
    File destination = null;
    boolean complete = false;
    try {
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(60_000);
      connection.setRequestProperty("Accept-Encoding", "identity");
      int status = DownloadRetry.network(connection::getResponseCode);
      if (status != 200) {
        throw new DownloadRetry.HttpFailure(status, connection.getHeaderField("Retry-After"));
      }
      destination = File.createTempFile("otakit-", ".zip", cacheDirectory);
      long receivedBytes = 0;
      try (
        InputStream input = DownloadRetry.network(connection::getInputStream);
        FileOutputStream output = new FileOutputStream(destination)
      ) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = DownloadRetry.network(() -> input.read(buffer))) != -1) {
          if (
            Thread.currentThread().isInterrupted()
          ) throw new java.util.concurrent.CancellationException("Download cancelled");
          output.write(buffer, 0, read);
          receivedBytes += read;
        }
      }
      String declaredLength = connection.getHeaderField("Content-Length");
      if (declaredLength != null && declaredLength.matches("[0-9]+")) {
        long expectedBytes;
        try {
          expectedBytes = Long.parseLong(declaredLength);
        } catch (NumberFormatException invalid) {
          throw new java.io.IOException("Invalid download Content-Length");
        }
        if (receivedBytes != expectedBytes) {
          throw new DownloadRetry.NetworkFailure(
            new java.io.EOFException(
              "body length mismatch; expectedBytes=" +
                expectedBytes +
                "; receivedBytes=" +
                receivedBytes
            )
          );
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
