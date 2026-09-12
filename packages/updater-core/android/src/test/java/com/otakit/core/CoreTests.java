package com.otakit.core;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Map;
import org.json.JSONObject;

public final class CoreTests {

  interface Operation {
    void run() throws Exception;
  }

  static void check(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }

  static void rejects(Operation operation) throws Exception {
    try {
      operation.run();
    } catch (Exception expected) {
      return;
    }
    throw new AssertionError("Expected rejection");
  }

  static JSONObject artifact(String hash) throws Exception {
    return new JSONObject()
      .put("appId", "app")
      .put("platform", "android")
      .put("runtimeVersion", "runtime")
      .put("contentHash", hash);
  }

  static void testEventDelivery(Path directory) throws Exception {
    File file = directory.resolve("events.json").toFile();
    JSONObject builtin = artifact("builtin")
      .put("version", "builtin")
      .put("embedded", true)
      .put("bundlePath", "/owned/builtin/index.bundle");
    JSONObject candidate = artifact("candidate")
      .put("version", "candidate")
      .put("releaseId", "release");
    LaunchStore store = new LaunchStore(file, "build", builtin);
    long generation = store.beginLaunch(true, true, 0);
    store.bindBootstrap(generation);
    store.hostReady(generation);
    store.stage(candidate, generation, true);
    check(
      new LaunchStore(file, "build", builtin).state().getJSONArray("events").length() == 1,
      "Download event and staged pointer were not committed together"
    );
    store.stage(candidate, generation);
    long trial = store.apply(generation, 0);
    store.bindBootstrap(trial);
    JSONObject otherRelease = new JSONObject(candidate.toString()).put("releaseId", "other");
    store.stage(otherRelease, trial);
    check(
      store.state().getJSONObject("current").getString("releaseId").equals("release"),
      "Trial was reattributed"
    );
    store.notifyReady(trial);
    store.stage(otherRelease, trial);
    check(!store.state().has("staged"), "Association unnecessarily staged a reload");
    check(
      store.state().getJSONArray("events").length() == 2,
      "Cached association duplicated events"
    );
    check(
      store
        .state()
        .getJSONArray("events")
        .getJSONObject(1)
        .getJSONObject("artifact")
        .getString("releaseId")
        .equals("release"),
      "Association rewrote historical event"
    );
    java.util.List<String> bodies = new java.util.ArrayList<>();
    int[] status = { 503 };
    EventDelivery.Sender sender = (url, app, body) -> {
      check(
        url.toString().equals("https://ingest.example/v1/events") && app.equals("app"),
        "Incorrect ingest routing"
      );
      bodies.add(new String(body, java.nio.charset.StandardCharsets.UTF_8));
      if (bodies.size() == 1) throw new java.io.IOException("lost response");
      return status[0];
    };
    EventDelivery delivery = new EventDelivery(
      store,
      "https://ingest.example/v1",
      "app",
      "android",
      "1",
      false,
      sender
    );
    String id = store.eventForDelivery().getString("id");
    check(delivery.flushOnce() == 5, "First retry delay");
    store = new LaunchStore(file, "build", builtin);
    delivery = new EventDelivery(
      store,
      "https://ingest.example/v1",
      "app",
      "android",
      "1",
      false,
      sender
    );
    for (long delay : new long[] { 5, 10, 20, 40, 80, 160, 300, 300 }) {
      check(delivery.flushOnce() == delay, "Retry was not bounded");
      check(store.eventForDelivery().getString("id").equals(id), "Retry changed identity");
    }
    for (int code : new int[] { 408, 429, 500, 200 }) {
      status[0] = code;
      check(
        delivery.flushOnce() > 0 && store.state().getJSONArray("events").length() == 2,
        "Non-202 acknowledged event"
      );
    }
    status[0] = 202;
    check(delivery.flushOnce() == 0, "202 was not acknowledged");
    for (String body : bodies) check(body.equals(bodies.get(0)), "Retry changed payload");
    status[0] = 403;
    check(delivery.flushOnce() == 0, "Terminal rejection not discarded");
    check(
      new LaunchStore(file, "build", builtin)
        .state()
        .getString("lastEventError")
        .equals("Event delivery HTTP 403"),
      "Lost terminal diagnostic"
    );
    store.recordDownloadFailure(candidate, "verification failed");
    JSONObject state = store.state();
    org.json.JSONArray events = new org.json.JSONArray();
    for (int i = 0; i < 260; i++) events.put(
      new JSONObject(state.getJSONArray("events").getJSONObject(0).toString()).put(
        "id",
        java.util.UUID.randomUUID().toString()
      )
    );
    state.put("events", events);
    Files.writeString(file.toPath(), state.toString());
    store = new LaunchStore(file, "build", builtin);
    check(store.state().getJSONArray("events").length() == 256, "Queue limit exceeded");
    check(store.state().getLong("droppedEvents") == 5, "Lost retention diagnostic");
    state = store.state();
    events = state.getJSONArray("events");
    events.getJSONObject(0).put("createdAt", System.currentTimeMillis() / 1000.0 - 86401);
    events.getJSONObject(1).remove("createdAt");
    id = events.getJSONObject(1).getString("id");
    events.put("malformed");
    events.put(new JSONObject().put("type", "applied"));
    Files.writeString(file.toPath(), state.toString());
    store = new LaunchStore(file, "build", builtin);
    JSONObject legacy = store.eventForDelivery();
    check(legacy.getString("id").equals(id), "Legacy event changed identity");
    check(
      legacy.getDouble("createdAt") ==
        new LaunchStore(file, "build", builtin).eventForDelivery().getDouble("createdAt"),
      "Legacy timestamp was not durable"
    );
    check(
      store.state().getJSONObject("current").getString("contentHash").equals("candidate"),
      "Malformed telemetry reset healthy code"
    );
    check(
      store.state().getLong("droppedEvents") == 8,
      "Invalid/expired event diagnostics incorrect"
    );
    // A genuine switch back to embedded code retains the outgoing fallback until readiness.
    generation = store.beginLaunch(true, true, 0);
    store.bindBootstrap(generation);
    store.hostReady(generation);
    store.stage(new JSONObject(builtin.toString()).put("releaseId", "baseline"), generation);
    trial = store.apply(generation, 0);
    check(store.state().getLong("trialGeneration") == trial, "Embedded switch bypassed readiness");
    store = new LaunchStore(file, "build", builtin);
    check(
      store.state().getJSONObject("current").getString("contentHash").equals("candidate"),
      "Embedded trial lost outgoing fallback"
    );
    events = store.state().getJSONArray("events");
    check(
      events
        .getJSONObject(events.length() - 1)
        .getJSONObject("artifact")
        .getString("releaseId")
        .equals("baseline"),
      "Rollback blamed outgoing publication"
    );
    final LaunchStore finalStore = store;
    rejects(() ->
      new EventDelivery(finalStore, "https:/missing-host", "app", "android", "1", false, sender)
    );
    rejects(() ->
      new EventDelivery(finalStore, "http://remote.example/v1", "app", "android", "1", true, sender)
    );
  }

  public static void main(String[] args) throws Exception {
    Path directory = Files.createTempDirectory("otakit-java-core-");
    try {
      testEventDelivery(directory);
      File file = directory.resolve("state.json").toFile();
      LaunchStore store = new LaunchStore(file, "build", artifact("builtin"));
      store.stage(artifact("candidate"));
      long generation = store.beginLaunch(true, false, 0);
      check(
        store.state().getJSONObject("current").getString("contentHash").equals("builtin"),
        "Launch activated staged code without permission"
      );
      rejects(() -> store.apply(generation, 0));
      store.bindBootstrap(generation);
      store.hostReady(generation);
      store.setForeground(false, 0);
      rejects(() -> store.apply(generation, 0));
      store.setForeground(true, 1);
      long trial = store.apply(generation, 1);
      rejects(() -> store.notifyReady(generation));
      rejects(() -> store.stage(artifact("stale"), generation));
      store.setActivationGuard(true, generation);
      store.bindBootstrap(trial);
      store.notifyReady(trial);
      store.notifyReady(trial);
      check(store.state().getJSONArray("events").length() == 1, "Readiness duplicated event");
      store.stage(artifact("bad"));
      store.hostReady(trial);
      store.apply(trial, 10);
      LaunchStore recovered = new LaunchStore(file, "build", artifact("builtin"));
      check(
        recovered.state().getJSONObject("current").getString("contentHash").equals("candidate"),
        "Lost known-good fallback"
      );
      rejects(() -> recovered.stage(artifact("bad")));
      check(
        new LaunchStore(file, "build", artifact("builtin"))
            .state()
            .getJSONArray("events")
            .length() ==
          2,
        "Recovery ran twice"
      );
      recovered.stage(artifact("next"));
      recovered.beginLaunch(true, true, 0);
      recovered.setForeground(false, 4000);
      check(!recovered.checkTimeout(1000000, 10000), "Background time consumed readiness budget");
      recovered.setForeground(true, 1000000);
      check(recovered.checkTimeout(1006000, 10000), "Foreground timeout did not recover");

      File previousFile = directory.resolve("previous.json").toFile();
      JSONObject embedded = artifact("builtin")
        .put("embedded", true)
        .put("bundlePath", "/embedded/index.bundle");
      LaunchStore previous = new LaunchStore(previousFile, "previous-build", embedded);
      for (String hash : new String[] { "first", "second" }) {
        previous.stage(artifact(hash));
        long selected = previous.beginLaunch(true, true, 0);
        previous.bindBootstrap(selected);
        previous.notifyReady(selected);
        previous = new LaunchStore(previousFile, "previous-build", embedded);
      }
      check(
        previous.state().getJSONObject("previousGood").getString("contentHash").equals("first"),
        "Previous good was not retained durably"
      );
      previous.stage(artifact("bad"));
      previous.beginLaunch(true, true, 0);
      previous = new LaunchStore(previousFile, "previous-build", embedded);
      check(
        previous.state().getJSONObject("current").getString("contentHash").equals("second"),
        "Previous retention changed trial fallback"
      );
      check(
        previous.state().getJSONObject("previousGood").getString("contentHash").equals("first"),
        "Recovery lost previous good"
      );
      previous.stage(embedded);
      long embeddedGeneration = previous.beginLaunch(true, true, 0);
      previous.bindBootstrap(embeddedGeneration);
      previous.notifyReady(embeddedGeneration);
      check(
        previous.state().getJSONObject("previousGood").getString("contentHash").equals("second"),
        "Embedded return lost previous confirmed code"
      );

      File headlessFile = directory.resolve("headless.json").toFile();
      LaunchStore headless = new LaunchStore(headlessFile, "build", artifact("builtin"));
      headless.stage(artifact("candidate"));
      long background = headless.beginLaunch(false, true, 0);
      headless.bindBootstrap(background);
      headless.hostReady(background);
      headless.setForeground(true, 1);
      rejects(() -> headless.apply(background, 1));
      check(
        headless.state().getJSONObject("staged").getString("contentHash").equals("candidate"),
        "Headless deferral lost staged code"
      );
      LaunchStore foregroundStore = new LaunchStore(headlessFile, "build", artifact("builtin"));
      long fresh = foregroundStore.beginLaunch(true, true, 0);
      foregroundStore.bindBootstrap(fresh);
      foregroundStore.hostReady(fresh);
      foregroundStore.notifyReady(fresh);
      foregroundStore.stage(artifact("next"));
      foregroundStore.observeBackgroundWork(fresh);
      foregroundStore.setActivationGuard(false);
      rejects(() -> foregroundStore.apply(fresh, 1));

      File failedWrite = directory.resolve("failed-write.json").toFile();
      int[] syncCalls = { 0 };
      boolean[] failSync = { false };
      LaunchStore unavailable = new LaunchStore(
        failedWrite,
        "build",
        artifact("builtin"),
        dir -> {
          if (!failSync[0]) return;
          syncCalls[0]++;
          throw new java.io.IOException("Injected directory sync failure");
        },
        value -> true
      );
      failSync[0] = true;
      rejects(() -> unavailable.beginLaunch(true, true, 0));
      check(
        unavailable.state().getLong("generation") == 0,
        "Failed write committed in-memory launch"
      );
      rejects(() -> unavailable.beginLaunch(true, true, 1));
      check(syncCalls[0] == 1, "Storage failure did not stop the owner");
      Files.writeString(failedWrite.toPath(), "{\"schemaVersion\":1,\"generation\":\"invalid\"}");
      check(
        new LaunchStore(failedWrite, "build", artifact("builtin")).state().getLong("generation") ==
          0,
        "Malformed state did not recover"
      );
      JSONObject corruptTrial = store.state();
      corruptTrial.getJSONObject("current").remove("contentHash");
      Files.writeString(failedWrite.toPath(), corruptTrial.toString());
      LaunchStore corruptRecovery = new LaunchStore(failedWrite, "build", artifact("builtin"));
      check(
        corruptRecovery.state().getJSONObject("current").getString("contentHash").equals("builtin"),
        "Incomplete trial identity did not select embedded code"
      );
      check(
        corruptRecovery.state().getJSONArray("events").length() == 0,
        "Corrupt trial fabricated a rollback identity"
      );

      java.security.AlgorithmParameters parameters = java.security.AlgorithmParameters.getInstance(
        "EC"
      );
      parameters.init(new java.security.spec.ECGenParameterSpec("secp256r1"));
      java.security.spec.ECParameterSpec p256 = parameters.getParameterSpec(
        java.security.spec.ECParameterSpec.class
      );
      check(RNManifest.isP256(p256), "Standard P-256 parameters differ");
      check(
        !RNManifest.isP256(
          new java.security.spec.ECParameterSpec(
            p256.getCurve(),
            p256.getGenerator(),
            p256.getOrder(),
            2
          )
        ),
        "Wrong cofactor accepted"
      );
      check(
        !RNManifest.isP256(
          new java.security.spec.ECParameterSpec(
            p256.getCurve(),
            new java.security.spec.ECPoint(java.math.BigInteger.ONE, java.math.BigInteger.ONE),
            p256.getOrder(),
            1
          )
        ),
        "Wrong generator accepted"
      );

      JSONObject fixture = new JSONObject(Files.readString(Path.of(args[0])));
      JSONObject manifest = fixture.getJSONObject("manifest");
      Map<String, byte[]> keys = Map.of(
        "fixture",
        Base64.getDecoder().decode(fixture.getString("publicKey"))
      );
      check(
        RNManifest.canonical(manifest).equals(fixture.getString("canonical")),
        "Canonical signature bytes differ"
      );
      RNManifest.verify(manifest.toString(), "app-1", "ios", "A".repeat(43), null, keys, 1001);
      rejects(() ->
        RNManifest.verify(manifest.toString(), "app-1", "android", "A".repeat(43), null, keys, 1001)
      );
      manifest.put("releaseId", "tampered");
      rejects(() ->
        RNManifest.verify(manifest.toString(), "app-1", "ios", "A".repeat(43), null, keys, 1001)
      );
      JSONObject artifacts = new JSONObject(Files.readString(Path.of(args[1])));
      Map<String, byte[]> artifactKeys = Map.of(
        "fixture",
        Base64.getDecoder().decode(artifacts.getString("publicKey"))
      );
      for (Object value : artifacts.getJSONArray("cases")) {
        JSONObject item = (JSONObject) value;
        JSONObject candidate = new JSONObject(item.getJSONObject("manifest").toString());
        check(
          RNManifest.canonical(candidate).equals(item.getString("canonical")),
          "ZIP/delta fixture canonical bytes differ"
        );
        RNManifest.verify(
          candidate.toString(),
          "app-1",
          "ios",
          "A".repeat(43),
          null,
          artifactKeys,
          1001
        );
        candidate.put("size", candidate.getLong("size") + 1);
        rejects(() ->
          RNManifest.verify(
            candidate.toString(),
            "app-1",
            "ios",
            "A".repeat(43),
            null,
            artifactKeys,
            1001
          )
        );
      }
      ArtifactInstaller installer = new ArtifactInstaller(Files.readAllBytes(Path.of(args[2])));
      rejects(() ->
        installer.validatePaths(
          java.util.Arrays.asList("index.bundle", "otakit-bundle.json", "café/a", "cafe\u0301/b")
        )
      );
      rejects(() ->
        installer.validatePaths(
          java.util.Arrays.asList("index.bundle", "otakit-bundle.json", "Straße/a", "STRASSE/b")
        )
      );
      for (int index = 0; index < 2; index++) {
        JSONObject candidate = artifacts
          .getJSONArray("cases")
          .getJSONObject(index)
          .getJSONObject("manifest");
        Path archive = directory.resolve("archive-" + index + ".zip");
        Files.write(
          archive,
          Base64.getDecoder().decode(
            artifacts.getString(index == 0 ? "archive" : "encryptedArchive")
          )
        );
        Path output = Files.createDirectory(directory.resolve("output-" + index));
        Map<String, byte[]> bundleKeys = new java.util.HashMap<>();
        if (index == 1) {
          rejects(() ->
            installer.installZip(
              archive.toFile(),
              output.toFile(),
              candidate,
              Map.of(),
              "0.86.3",
              96
            )
          );
          bundleKeys.put(
            candidate.getJSONObject("encryption").getString("kid"),
            Base64.getDecoder().decode(artifacts.getString("bundleKey"))
          );
        }
        org.json.JSONArray installed = installer.installZip(
          archive.toFile(),
          output.toFile(),
          candidate,
          bundleKeys,
          "0.86.3",
          96
        );
        check(installed.length() == 5, "Incorrect extracted inventory");
        java.util.List<String> originalPaths = new java.util.ArrayList<>();
        for (int i = 0; i < installed.length(); i++) originalPaths.add(
          installed.getJSONObject(i).getString("path")
        );
        installer.verifyDirectory(output.toFile(), candidate, "0.86.3", 96, originalPaths);
        JSONObject builtin = new JSONObject()
          .put("appId", "app-1")
          .put("platform", "ios")
          .put("runtimeVersion", "A".repeat(43))
          .put("contentHash", "b".repeat(64))
          .put("version", "embedded")
          .put("embedded", true)
          .put("bundlePath", "/embedded/index.bundle");
        File cacheRoot = directory.resolve("cache-" + index).toFile();
        LaunchStore.DirectorySync sync = dir -> {
          try (
            java.nio.channels.FileChannel channel = java.nio.channels.FileChannel.open(
              dir.toPath(),
              java.nio.file.StandardOpenOption.READ
            )
          ) {
            channel.force(true);
          }
        };
        ArtifactCache cache = new ArtifactCache(
          cacheRoot,
          builtin,
          installer,
          artifactKeys,
          "0.86.3",
          96,
          sync
        );
        cache.commit(output.toFile(), candidate, candidate.toString(), installed);
        File cached = cache.directory(candidate.getString("contentHash"));
        JSONObject pointer = new JSONObject(builtin.toString())
          .put("contentHash", candidate.getString("contentHash"))
          .put("version", candidate.getString("version"))
          .put("embedded", false)
          .put("bundlePath", new File(cached, "index.bundle").getPath());
        check(cache.verify(pointer), "Signed expired cached artifact cannot boot offline");
        Path orphan = new File(cacheRoot, "artifacts/" + "d".repeat(64)).toPath();
        Files.createDirectories(orphan);
        Files.writeString(orphan.resolve("index.bundle"), "partial commit");
        Path outside = directory.resolve("outside-" + index);
        Files.createDirectories(outside);
        Files.writeString(outside.resolve("marker"), "keep");
        Files.createSymbolicLink(orphan.resolve("nested"), outside);
        Path link = new File(cacheRoot, "artifacts/" + "e".repeat(64)).toPath();
        Files.createSymbolicLink(link, outside);
        Path staging = new File(cacheRoot, "staging/" + java.util.UUID.randomUUID()).toPath();
        Files.createDirectories(staging);
        Files.writeString(staging.resolve("partial"), "partial");
        Path downloads = new File(cacheRoot, "downloads").toPath();
        Files.createDirectories(downloads);
        Files.writeString(downloads.resolve("download-123.tmp"), "partial");
        JSONObject collectionState = new JSONObject()
          .put("current", pointer)
          .put("lastGood", builtin);
        for (String key : new String[] { "previousGood", "staged" }) {
          String hash = (key.equals("previousGood") ? "8" : "9").repeat(64);
          Files.createDirectories(cache.directory(hash).toPath());
          Files.writeString(new File(cache.directory(hash), "index.bundle").toPath(), key);
          collectionState.put(key, new JSONObject(pointer.toString()).put("contentHash", hash));
        }
        cache.collect(collectionState);
        cache.collect(collectionState);
        check(cache.verify(pointer), "Collection removed a retained signed cache or receipt");
        check(
          Files.readString(outside.resolve("marker")).equals("keep"),
          "Collection followed a symlink"
        );
        check(
          !Files.exists(orphan) && !Files.exists(link) && !Files.exists(staging),
          "Collection retained interrupted installs"
        );
        check(
          !Files.exists(downloads.resolve("download-123.tmp")),
          "Collection retained interrupted download"
        );
        for (String hash : new String[] { "8".repeat(64), "9".repeat(64) })
          check(
            new File(cache.directory(hash), "index.bundle").isFile(),
            "Collection lost previous/staged code"
          );
        Files.delete(downloads);
        Files.createSymbolicLink(downloads, outside);
        rejects(() -> cache.collect(collectionState));
        check(Files.exists(outside.resolve("marker")), "Collection traversed a linked namespace");
        Files.delete(downloads);
        File cacheState = new File(cacheRoot, "launch.json");
        LaunchStore cachedStore = new LaunchStore(
          cacheState,
          "cache-build",
          builtin,
          sync,
          cache::verify
        );
        cachedStore.stage(pointer);
        long cachedGeneration = cachedStore.beginLaunch(true, true, 0);
        cachedStore.bindBootstrap(cachedGeneration);
        cachedStore.notifyReady(cachedGeneration);
        Files.writeString(new File(cached, "index.bundle").toPath(), "tampered");
        check(!cache.verify(pointer), "Corrupted cached artifact accepted");
        LaunchStore repaired = new LaunchStore(
          cacheState,
          "cache-build",
          builtin,
          sync,
          cache::verify
        );
        check(
          repaired.state().getJSONObject("current").getBoolean("embedded"),
          "Corrupt cache did not select embedded fallback"
        );
        cache.collect(repaired.state());
        check(!cached.exists(), "Invalid unreferenced cache still blocks reinstall");
        Files.createDirectories(output);
        org.json.JSONArray repairedFiles = installer.installZip(
          archive.toFile(),
          output.toFile(),
          candidate,
          bundleKeys,
          "0.86.3",
          96
        );
        cache.commit(output.toFile(), candidate, candidate.toString(), repairedFiles);
        check(cache.verify(pointer), "Interrupted/corrupt artifact could not be installed again");
      }
      JSONObject delta = artifacts.getJSONArray("cases").getJSONObject(2).getJSONObject("manifest");
      installer.validateDeltaInventory(delta);
      delta.getJSONArray("files").getJSONObject(0).put("size", 0);
      rejects(() -> installer.validateDeltaInventory(delta));
      System.out.println(
        "PASS Java launch recovery, readiness, quarantine, foreground timeout, v3 signatures, ZIP/encryption and path verification"
      );
    } finally {
      try (java.util.stream.Stream<Path> paths = Files.walk(directory)) {
        paths
          .sorted(java.util.Comparator.reverseOrder())
          .forEach(path -> {
            try {
              Files.delete(path);
            } catch (Exception error) {
              throw new RuntimeException(error);
            }
          });
      }
    }
  }
}
