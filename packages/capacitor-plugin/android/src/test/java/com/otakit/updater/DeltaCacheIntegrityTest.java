package com.otakit.updater;

import static org.junit.Assert.*;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Collections;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class DeltaCacheIntegrityTest {

  @Rule
  public TemporaryFolder temporaryFolder = new TemporaryFolder();

  private final byte[] good = new byte[] { 1, 2, 3 };

  private ManifestClient.ManifestFileEntry entry() throws Exception {
    File source = temporaryFolder.newFile();
    Files.write(source.toPath(), good);
    return new ManifestClient.ManifestFileEntry(
      "index.html",
      HashUtils.sha256(source),
      3,
      "https://example.test/file"
    );
  }

  @Test
  public void corruptedCacheIsRepairedBeforeAssembly() throws Exception {
    ManifestClient.ManifestFileEntry entry = entry();
    File cache = temporaryFolder.newFolder();
    File cached = new File(cache, entry.sha256);
    Files.write(cached.toPath(), new byte[] { 9, 9, 9 });
    int[] requests = { 0 };
    DeltaAssembler assembler = new DeltaAssembler(cache, false, (url, context) -> {
      requests[0]++;
      File download = temporaryFolder.newFile();
      Files.write(download.toPath(), good);
      return download;
    });
    File output = new File(temporaryFolder.newFolder(), "assembled");
    assembler.validate(
      Collections.singletonList(entry),
      DeltaAssembler.computeFilesHash(Collections.singletonList(entry))
    );
    assembler.assemble(Collections.singletonList(entry), output, null);
    assertArrayEquals(good, Files.readAllBytes(new File(output, "index.html").toPath()));
    assertArrayEquals(good, Files.readAllBytes(cached.toPath()));
    assertEquals(1, requests[0]);
  }

  @Test
  public void validCacheNeedsNoNetwork() throws Exception {
    ManifestClient.ManifestFileEntry entry = entry();
    File cache = temporaryFolder.newFolder();
    Files.write(new File(cache, entry.sha256).toPath(), good);
    DeltaAssembler assembler = new DeltaAssembler(cache, false, (url, context) -> {
      throw new AssertionError("Network used for valid cache");
    });
    File output = new File(temporaryFolder.newFolder(), "assembled");
    assembler.assemble(Collections.singletonList(entry), output, null);
    assertArrayEquals(good, Files.readAllBytes(new File(output, "index.html").toPath()));
  }

  @Test
  public void damagedCacheAndOfflineFailureCannotProduceBundle() throws Exception {
    ManifestClient.ManifestFileEntry entry = entry();
    File cache = temporaryFolder.newFolder();
    Files.write(new File(cache, entry.sha256).toPath(), new byte[] { 9 });
    DeltaAssembler assembler = new DeltaAssembler(cache, false, (url, context) -> {
      throw new IOException("offline");
    });
    File output = new File(temporaryFolder.newFolder(), "assembled");
    assertThrows(IOException.class, () ->
      assembler.assemble(Collections.singletonList(entry), output, null)
    );
    assertFalse(new File(output, "index.html").exists());
  }

  @Test
  public void corruptConcurrentCacheWriterCannotBypassVerification() throws Exception {
    ManifestClient.ManifestFileEntry entry = entry();
    File cache = temporaryFolder.newFolder();
    DeltaAssembler assembler = new DeltaAssembler(cache, false, (url, context) -> {
      Files.write(new File(cache, entry.sha256).toPath(), new byte[] { 9 });
      File download = temporaryFolder.newFile();
      Files.write(download.toPath(), good);
      return download;
    });
    File output = new File(temporaryFolder.newFolder(), "assembled");
    assembler.assemble(Collections.singletonList(entry), output, null);
    assertArrayEquals(good, Files.readAllBytes(new File(output, "index.html").toPath()));
  }
}
