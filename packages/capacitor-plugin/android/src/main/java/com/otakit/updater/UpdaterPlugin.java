package com.otakit.updater;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "OtaKit")
public class UpdaterPlugin extends Plugin {

  private enum Policy {
    OFF("off"),
    SHADOW("shadow"),
    APPLY_STAGED("apply-staged"),
    IMMEDIATE("immediate");

    final String value;

    Policy(String value) {
      this.value = value;
    }
  }

  private static final class CheckResolution {

    final String kind;
    final ManifestClient.LatestManifest latest;
    final BundleInfo bundle;

    private CheckResolution(String kind, ManifestClient.LatestManifest latest, BundleInfo bundle) {
      this.kind = kind;
      this.latest = latest;
      this.bundle = bundle;
    }

    static CheckResolution noUpdate() {
      return new CheckResolution("no_update", null, null);
    }

    static CheckResolution alreadyStaged(ManifestClient.LatestManifest latest, BundleInfo bundle) {
      return new CheckResolution("already_staged", latest, bundle);
    }

    static CheckResolution updateAvailable(ManifestClient.LatestManifest latest) {
      return new CheckResolution("update_available", latest, null);
    }
  }

  private static final class DownloadResolution {

    final String kind;
    final BundleInfo bundle;

    private DownloadResolution(String kind, BundleInfo bundle) {
      this.kind = kind;
      this.bundle = bundle;
    }

    static DownloadResolution noUpdate() {
      return new DownloadResolution("no_update", null);
    }

    static DownloadResolution staged(BundleInfo bundle) {
      return new DownloadResolution("staged", bundle);
    }
  }

  @FunctionalInterface
  private interface ThrowingRunnable {
    void run() throws Exception;
  }

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final ZipUtils zipUtils = new ZipUtils();

  private BundleStore store;
  private UpdaterCoordinator coordinator;
  private Runnable trialTimeoutRunnable;

  private int appReadyTimeoutMs = 10_000;
  private boolean allowInsecureUrls = false;
  private Policy launchPolicy = Policy.APPLY_STAGED;
  private Policy resumePolicy = Policy.SHADOW;
  private Policy runtimePolicy = Policy.IMMEDIATE;
  private String ingestUrl;
  private String cdnUrl;
  private String appId;
  private String channel;
  private String runtimeVersion;
  private java.util.List<ManifestVerifier.KeyEntry> manifestKeys = new java.util.ArrayList<>();
  private long checkIntervalMs = 600_000;
  private boolean coldStartInProgress = false;
  private static final String DEFAULT_INGEST_URL = "https://ingest.otakit.app/v1";
  private static final String DEFAULT_CDN_URL = "https://cdn.otakit.app";
  private static final String INGEST_PATH_SUFFIX = "/v1";
  private static final String KEY_LAST_CHECK_TIMESTAMP = "last_check_timestamp";
  private static final String DEFAULT_RUNTIME_KEY = "__default__";
  private static final String BUILTIN_ASSET_PATH = "public";
  private UpdaterCoordinator.StartupPreparation pendingStartupPreparation;

  @Override
  public void load() {
    super.load();

    String builtinVersion = "0.0.0";
    String nativeBuild = "1";
    try {
      PackageInfo info = getContext()
        .getPackageManager()
        .getPackageInfo(getContext().getPackageName(), 0);
      builtinVersion = info.versionName != null ? info.versionName : builtinVersion;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        nativeBuild = String.valueOf(info.getLongVersionCode());
      } else {
        //noinspection deprecation
        nativeBuild = String.valueOf(info.versionCode);
      }
    } catch (PackageManager.NameNotFoundException ignored) {}

    this.ingestUrl = resolveIngestUrl(
      getConfig().getString("ingestUrl"),
      System.getenv("OTAKIT_INGEST_URL")
    );
    this.cdnUrl = resolveCdnUrl(getConfig().getString("cdnUrl"), System.getenv("OTAKIT_CDN_URL"));
    this.appId = getConfig().getString("appId");
    this.channel = trimToNull(getConfig().getString("channel"));
    this.runtimeVersion = trimToNull(getConfig().getString("runtimeVersion"));
    this.store = new BundleStore(getContext(), builtinVersion, nativeBuild, this.runtimeVersion);
    this.coordinator = new UpdaterCoordinator(this.store);
    this.allowInsecureUrls = getConfig().getBoolean("allowInsecureUrls", false);
    this.launchPolicy = resolvePolicy(getConfig().getString("launchPolicy"), Policy.APPLY_STAGED);
    this.resumePolicy = resolvePolicy(getConfig().getString("resumePolicy"), Policy.SHADOW);
    this.runtimePolicy = resolvePolicy(getConfig().getString("runtimePolicy"), Policy.IMMEDIATE);

    try {
      org.json.JSONArray rawKeys = getConfig().getConfigJSON().optJSONArray("manifestKeys");
      if (rawKeys != null && rawKeys.length() > 0) {
        for (int i = 0; i < rawKeys.length(); i++) {
          org.json.JSONObject entry = rawKeys.optJSONObject(i);
          if (entry == null) {
            continue;
          }
          String kid = entry.optString("kid", null);
          String keyBase64 = entry.optString("key", null);
          if (kid != null && keyBase64 != null) {
            byte[] keyBytes = android.util.Base64.decode(keyBase64, android.util.Base64.DEFAULT);
            manifestKeys.add(new ManifestVerifier.KeyEntry(kid, keyBytes));
          }
        }
        if (manifestKeys.isEmpty()) {
          android.util.Log.e(
            "OtaKit",
            "manifestKeys configured but all entries are invalid. Manifest verification will reject all updates."
          );
          manifestKeys.add(new ManifestVerifier.KeyEntry("_invalid_", new byte[0]));
        }
      }
    } catch (Exception e) {
      android.util.Log.e(
        "OtaKit",
        "Failed to parse manifestKeys. Manifest verification will reject all updates.",
        e
      );
      manifestKeys.add(new ManifestVerifier.KeyEntry("_invalid_", new byte[0]));
    }

    if (manifestKeys.isEmpty() && HostedManifestKeys.matchesManagedManifestUrl(cdnUrl)) {
      manifestKeys.addAll(HostedManifestKeys.createDefaultKeys());
    }

    this.appReadyTimeoutMs = Math.max(1000, getConfig().getInt("appReadyTimeout", 10_000));
    this.checkIntervalMs = getConfig().getInt("checkInterval", 600_000);

    pruneIncompatibleBundles();

    UpdaterCoordinator.StartupPreparation startup = coordinator.normalizeStartupState(
      this::isBundleUsable
    );
    coordinator.cleanupBundles(startup.cleanupBundleIds);
    pendingStartupPreparation = startup;
  }

  @Override
  protected void handleOnStart() {
    super.handleOnStart();
    consumePendingStartupPreparation();
  }

  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    if (coldStartInProgress) {
      coldStartInProgress = false;
      return;
    }
    handleResume();
  }

  private boolean shouldSkipCheckInterval() {
    if (checkIntervalMs <= 0) return false;
    long lastCheck = store.getPrefs().getLong(KEY_LAST_CHECK_TIMESTAMP, 0);
    if (lastCheck <= 0) return false;
    long elapsed = System.currentTimeMillis() - lastCheck;
    return elapsed < checkIntervalMs;
  }

  private void recordCheckTimestamp() {
    store.getPrefs().edit().putLong(KEY_LAST_CHECK_TIMESTAMP, System.currentTimeMillis()).apply();
  }

  private void dispatchColdStart() {
    if (isRuntimeUnresolved()) {
      handleRuntime();
    } else {
      handleLaunch();
    }
  }

  private void consumePendingStartupPreparation() {
    UpdaterCoordinator.StartupPreparation startup = pendingStartupPreparation;
    if (startup == null) {
      return;
    }
    pendingStartupPreparation = null;

    if (startup.activationPath != null && !startup.activationPath.isEmpty()) {
      try {
        applyServerBasePathSynchronously(startup.activationPath);
      } catch (Exception e) {
        android.util.Log.w("OtaKit", "startup activation failed", e);
      }
    }

    if (startup.eventPayload != null) {
      sendDeviceEvent(startup.eventPayload);
    }

    if (startup.trialBundleId != null) {
      scheduleTrialTimeout(startup.trialBundleId);
    } else {
      cancelTrialTimeout();
    }

    coldStartInProgress = true;
    dispatchColdStart();
  }

  private void handleRuntime() {
    switch (runtimePolicy) {
      case OFF:
        resolveCurrentRuntimeKey();
        return;
      case APPLY_STAGED:
        boolean hasStagedBundle =
          coordinator.snapshotState(
            bundle -> isCompatibleRuntime(bundle) && isBundleUsable(bundle)
          ).staged !=
          null;
        if (hasStagedBundle) {
          resolveCurrentRuntimeKey();
          try {
            if (!applyStaged(false)) {
              android.util.Log.w(
                "OtaKit",
                "Failed to apply a valid staged bundle during runtime handling"
              );
            }
          } catch (Exception e) {
            android.util.Log.w("OtaKit", "runtime apply-staged failed", e);
          }
          return;
        }
        executeAutomaticUpdate("runtime apply-staged fallback", () -> {
          downloadLatest(false, null);
          resolveCurrentRuntimeKey();
        });
        return;
      case SHADOW:
        executeAutomaticUpdate("runtime shadow", () -> {
          downloadLatest(false, null);
          resolveCurrentRuntimeKey();
        });
        return;
      case IMMEDIATE:
        executeAutomaticUpdate("runtime immediate", () -> {
          DownloadResolution result = downloadLatest(false, null);
          if ("no_update".equals(result.kind)) {
            resolveCurrentRuntimeKey();
            return;
          }
          resolveCurrentRuntimeKey();
          requireApplyStaged(true);
        });
        return;
    }
  }

  private void handleLaunch() {
    switch (launchPolicy) {
      case OFF:
        return;
      case APPLY_STAGED:
        try {
          if (applyStaged(false)) {
            return;
          }
        } catch (Exception e) {
          android.util.Log.w("OtaKit", "launch apply-staged failed", e);
          return;
        }
        executeAutomaticUpdate("launch apply-staged fallback", () -> downloadLatest(false, null));
        return;
      case SHADOW:
        executeAutomaticUpdate("launch shadow", () -> downloadLatest(false, null));
        return;
      case IMMEDIATE:
        executeAutomaticUpdate("launch immediate", () -> {
          DownloadResolution result = downloadLatest(false, null);
          if ("staged".equals(result.kind)) {
            requireApplyStaged(true);
          }
        });
        return;
    }
  }

  private void handleResume() {
    switch (resumePolicy) {
      case OFF:
        return;
      case APPLY_STAGED:
        executeAutomaticUpdate("resume apply-staged", () -> {
          if (applyStaged(true)) {
            return;
          }
          downloadLatest(true, null);
        });
        return;
      case SHADOW:
        executeAutomaticUpdate("resume shadow", () -> downloadLatest(true, null));
        return;
      case IMMEDIATE:
        executeAutomaticUpdate("resume immediate", () -> {
          DownloadResolution result = downloadLatest(false, null);
          if ("staged".equals(result.kind)) {
            requireApplyStaged(true);
          }
        });
        return;
    }
  }

  private void executeAutomaticUpdate(String label, ThrowingRunnable operation) {
    if (!coordinator.tryBeginOperation()) {
      android.util.Log.d("OtaKit", "Skipping " + label + ": update already in progress");
      return;
    }
    executor.execute(() -> {
      try {
        operation.run();
      } catch (Exception e) {
        android.util.Log.w("OtaKit", label + " failed", e);
      } finally {
        coordinator.endOperation();
      }
    });
  }

  private String currentRuntimeKey() {
    return runtimeVersion != null ? runtimeVersion : DEFAULT_RUNTIME_KEY;
  }

  private boolean isRuntimeUnresolved() {
    return coordinator.isRuntimeUnresolved(currentRuntimeKey());
  }

  private void resolveCurrentRuntimeKey() {
    coordinator.resolveRuntimeKey(currentRuntimeKey());
  }

  private Policy resolvePolicy(String configured, Policy defaultPolicy) {
    String raw = configured == null ? "" : configured.trim().toLowerCase();
    if (raw.isEmpty()) {
      return defaultPolicy;
    }
    if (Policy.OFF.value.equals(raw)) {
      return Policy.OFF;
    }
    if (Policy.SHADOW.value.equals(raw)) {
      return Policy.SHADOW;
    }
    if (Policy.APPLY_STAGED.value.equals(raw)) {
      return Policy.APPLY_STAGED;
    }
    if (Policy.IMMEDIATE.value.equals(raw)) {
      return Policy.IMMEDIATE;
    }
    android.util.Log.w(
      "OtaKit",
      "Unknown policy '" + raw + "', defaulting to '" + defaultPolicy.value + "'"
    );
    return defaultPolicy;
  }

  @PluginMethod
  public void getState(PluginCall call) {
    UpdaterCoordinator.StateSnapshot snapshot = coordinator.snapshotState(this::isBundleUsable);
    JSObject result = new JSObject();
    result.put("current", snapshot.current.toJSObject());
    result.put("fallback", snapshot.fallback.toJSObject());
    result.put("builtinVersion", snapshot.builtinVersion);
    result.put("staged", snapshot.staged != null ? snapshot.staged.toJSObject() : null);
    call.resolve(result);
  }

  @PluginMethod
  public void check(PluginCall call) {
    if (!coordinator.tryBeginOperation()) {
      call.reject("Another update operation is already in progress");
      return;
    }
    executor.execute(() -> {
      try {
        call.resolve(checkResolutionToJSObject(checkLatest(false, null)));
      } catch (Exception e) {
        call.reject("check failed: " + e.getMessage());
      } finally {
        coordinator.endOperation();
      }
    });
  }

  @PluginMethod
  public void download(PluginCall call) {
    if (!coordinator.tryBeginOperation()) {
      call.reject("Another update operation is already in progress");
      return;
    }
    executor.execute(() -> {
      try {
        call.resolve(downloadResolutionToJSObject(downloadLatest(false, null)));
      } catch (Exception e) {
        call.reject("download failed: " + e.getMessage());
      } finally {
        coordinator.endOperation();
      }
    });
  }

  @PluginMethod
  public void apply(PluginCall call) {
    if (!coordinator.tryBeginOperation()) {
      call.reject("Another update operation is already in progress");
      return;
    }
    executor.execute(() -> {
      try {
        requireApplyStaged(true);
      } catch (Exception e) {
        call.reject("apply failed: " + e.getMessage());
      } finally {
        coordinator.endOperation();
      }
    });
  }

  @PluginMethod
  public void update(PluginCall call) {
    if (!coordinator.tryBeginOperation()) {
      call.reject("Another update operation is already in progress");
      return;
    }
    executor.execute(() -> {
      try {
        DownloadResolution result = downloadLatest(false, null);
        if ("staged".equals(result.kind)) {
          requireApplyStaged(true);
          return;
        }
        call.resolve();
      } catch (Exception e) {
        call.reject("update failed: " + e.getMessage());
      } finally {
        coordinator.endOperation();
      }
    });
  }

  @PluginMethod
  public void notifyAppReady(PluginCall call) {
    cancelTrialTimeout();
    UpdaterCoordinator.NotifyReadyPreparation preparation = coordinator.prepareNotifyAppReady();
    coordinator.cleanupBundles(preparation.cleanupBundleIds);
    if (preparation.eventPayload != null) {
      sendDeviceEvent(preparation.eventPayload);
    }
    call.resolve();
  }

  @PluginMethod
  public void getLastFailure(PluginCall call) {
    BundleInfo failed = coordinator.lastFailure();
    if (failed == null) {
      call.resolve((JSObject) null);
      return;
    }
    call.resolve(failed.toJSObject());
  }

  private ManifestClient.LatestManifest fetchLatest(String channel) throws Exception {
    if (appId == null || appId.trim().isEmpty()) {
      throw new IllegalStateException("Missing appId in plugin config");
    }

    return ManifestClient.fetchLatest(
      cdnUrl,
      appId,
      channel,
      runtimeVersion,
      allowInsecureUrls,
      manifestKeys
    );
  }

  private CheckResolution checkLatest(boolean respectInterval, String channel) throws Exception {
    String targetChannel = resolveTargetChannel(channel);
    if (respectInterval && shouldSkipCheckInterval()) {
      android.util.Log.d("OtaKit", "Skipping resume check: checkInterval has not elapsed");
      return CheckResolution.noUpdate();
    }

    ManifestClient.LatestManifest latest = fetchLatest(targetChannel);
    if (latest == null) {
      if (respectInterval) {
        recordCheckTimestamp();
      }
      return CheckResolution.noUpdate();
    }

    CheckResolution resolution = classifyLatestManifest(latest, targetChannel);

    if (respectInterval) {
      recordCheckTimestamp();
    }
    return resolution;
  }

  private DownloadResolution downloadLatest(boolean respectInterval, String channel)
    throws Exception {
    String targetChannel = resolveTargetChannel(channel);
    CheckResolution result = checkLatest(respectInterval, channel);
    switch (result.kind) {
      case "no_update":
        return DownloadResolution.noUpdate();
      case "already_staged":
        return DownloadResolution.staged(result.bundle);
      case "update_available":
        try {
          return DownloadResolution.staged(downloadLatestManifest(result.latest, targetChannel));
        } catch (Exception e) {
          if (!isExpiredURLError(e)) {
            throw e;
          }

          ManifestClient.LatestManifest refreshed = fetchLatest(targetChannel);
          if (refreshed == null) {
            return DownloadResolution.noUpdate();
          }

          CheckResolution refreshedResolution = classifyLatestManifest(refreshed, targetChannel);
          switch (refreshedResolution.kind) {
            case "no_update":
              return DownloadResolution.noUpdate();
            case "already_staged":
              return DownloadResolution.staged(refreshedResolution.bundle);
            case "update_available":
              return DownloadResolution.staged(
                downloadLatestManifest(refreshedResolution.latest, targetChannel)
              );
            default:
              throw new IllegalStateException(
                "Unknown refreshed check result: " + refreshedResolution.kind
              );
          }
        }
      default:
        throw new IllegalStateException("Unknown check result: " + result.kind);
    }
  }

  private CheckResolution classifyLatestManifest(
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) throws Exception {
    if (!isCompatibleRuntime(latest.runtimeVersion)) {
      throw new IllegalStateException(
        "Manifest runtimeVersion does not match the installed app runtime"
      );
    }

    UpdaterCoordinator.LatestManifestClassification classification =
      coordinator.classifyLatestManifest(latest, targetChannel, this::isBundleUsable);
    if ("no_update".equals(classification.kind)) {
      return CheckResolution.noUpdate();
    }
    if ("already_staged".equals(classification.kind)) {
      return CheckResolution.alreadyStaged(latest, classification.bundle);
    }
    return CheckResolution.updateAvailable(latest);
  }

  private JSObject checkResolutionToJSObject(CheckResolution result) {
    JSObject object = new JSObject();
    object.put("kind", result.kind);
    if (result.latest != null) {
      object.put("latest", manifestToJSObject(result.latest));
    }
    return object;
  }

  private JSObject downloadResolutionToJSObject(DownloadResolution result) {
    JSObject object = new JSObject();
    object.put("kind", result.kind);
    if (result.bundle != null) {
      object.put("bundle", result.bundle.toJSObject());
    }
    return object;
  }

  private boolean isExpiredURLError(Exception e) {
    String msg = e.getMessage();
    if (msg == null) return false;
    msg = msg.toLowerCase();
    return (
      msg.contains("403") ||
      msg.contains("410") ||
      msg.contains("forbidden") ||
      msg.contains("expired")
    );
  }

  private BundleInfo downloadAndStage(
    URL url,
    String version,
    String expectedSha256,
    int expectedSize,
    String runtimeVersion,
    String channel,
    String releaseId
  ) throws Exception {
    // Check disk space before downloading
    if (expectedSize > 0) {
      long requiredSpace = (long) (expectedSize * 2.5); // zip + extracted + buffer
      long availableSpace = getFreeDiskSpace();
      if (availableSpace < requiredSpace) {
        sendDeviceEvent(
          "download_error",
          version,
          runtimeVersion,
          channel,
          releaseId,
          "insufficient_disk_space"
        );
        throw new IllegalStateException("Insufficient disk space");
      }
    }

    File downloadedZip = null;
    File extractedDirectory = null;

    try {
      downloadedZip = downloadZip(url);
      if (!HashUtils.verify(downloadedZip, expectedSha256)) {
        throw new IllegalStateException("Downloaded bundle hash mismatch");
      }

      extractedDirectory = new File(
        getContext().getCacheDir(),
        "otakit-extract-" + System.currentTimeMillis()
      );
      if (!extractedDirectory.exists() && !extractedDirectory.mkdirs()) {
        throw new IllegalStateException("Cannot create temporary extraction directory");
      }

      zipUtils.extractSecurely(downloadedZip, extractedDirectory);
      File bundleRoot = resolveBundleRoot(extractedDirectory);

      String bundleId = buildBundleId(version, releaseId, expectedSha256);
      File destination = coordinator.bundleDirectory(bundleId);
      if (destination.exists()) {
        deleteRecursively(destination);
      }
      moveDirectory(bundleRoot, destination);

      BundleInfo info = new BundleInfo(
        bundleId,
        version,
        runtimeVersion,
        BundleStatus.PENDING,
        System.currentTimeMillis(),
        expectedSha256,
        destination.getAbsolutePath(),
        channel,
        releaseId
      );
      java.util.List<String> cleanupBundleIds = coordinator.stageDownloadedBundle(info);
      coordinator.cleanupBundles(cleanupBundleIds);

      sendDeviceEvent("downloaded", version, runtimeVersion, channel, releaseId, null);
      return info;
    } catch (Exception e) {
      sendDeviceEvent(
        "download_error",
        version,
        runtimeVersion,
        channel,
        releaseId,
        e.getMessage()
      );
      throw e;
    } finally {
      if (downloadedZip != null && downloadedZip.exists()) {
        //noinspection ResultOfMethodCallIgnored
        downloadedZip.delete();
      }
      if (extractedDirectory != null && extractedDirectory.exists()) {
        try {
          deleteRecursively(extractedDirectory);
        } catch (Exception ignored) {}
      }
    }
  }

  private File downloadZip(URL url) throws Exception {
    ManifestClient.requireHTTPS(url, allowInsecureUrls);
    HttpURLConnection connection = (HttpURLConnection) url.openConnection();
    try {
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(60_000);

      int status = connection.getResponseCode();
      if (status < 200 || status >= 300) {
        throw new IllegalStateException("Download failed with HTTP " + status);
      }

      File destination = File.createTempFile("otakit-", ".zip", getContext().getCacheDir());

      try (
        InputStream input = connection.getInputStream();
        FileOutputStream output = new FileOutputStream(destination)
      ) {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) > 0) {
          output.write(buffer, 0, read);
        }
      }

      return destination;
    } finally {
      connection.disconnect();
    }
  }

  private File resolveBundleRoot(File extractedDirectory) throws Exception {
    File rootIndex = new File(extractedDirectory, "index.html");
    if (rootIndex.exists()) {
      return extractedDirectory;
    }

    File[] children = extractedDirectory.listFiles();
    if (children != null && children.length == 1 && children[0].isDirectory()) {
      File nestedIndex = new File(children[0], "index.html");
      if (nestedIndex.exists()) {
        return children[0];
      }
    }

    throw new IllegalStateException("Bundle archive does not contain index.html");
  }

  private boolean applyStaged(boolean reloadAfterApply) throws Exception {
    UpdaterCoordinator.ApplyPreparation preparation = coordinator.prepareApplyStaged(
      this::isCompatibleRuntime,
      this::isBundleUsable
    );
    coordinator.cleanupBundles(preparation.cleanupBundleIds);
    if (!preparation.didApply()) {
      return false;
    }

    applyServerBasePathSynchronously(preparation.activationPath);
    if (reloadAfterApply) {
      reloadWebViewSynchronously();
    }

    cancelTrialTimeout();
    if (preparation.trialBundleId != null) {
      scheduleTrialTimeout(preparation.trialBundleId);
    }
    return true;
  }

  private void requireApplyStaged(boolean reloadAfterApply) throws Exception {
    if (!applyStaged(reloadAfterApply)) {
      throw new IllegalStateException("Expected a staged bundle to be ready for apply");
    }
  }

  private void scheduleTrialTimeout(String bundleId) {
    cancelTrialTimeout();
    trialTimeoutRunnable = () -> {
      if (coordinator.isCurrentTrialBundle(bundleId)) {
        rollbackCurrentBundle("notify_timeout", true);
      }
    };
    mainHandler.postDelayed(trialTimeoutRunnable, appReadyTimeoutMs);
  }

  private void cancelTrialTimeout() {
    if (trialTimeoutRunnable != null) {
      mainHandler.removeCallbacks(trialTimeoutRunnable);
      trialTimeoutRunnable = null;
    }
  }

  private void rollbackCurrentBundle(String reason, boolean shouldReload) {
    cancelTrialTimeout();
    UpdaterCoordinator.RollbackPreparation preparation = coordinator.prepareRollback(
      reason,
      this::isBundleUsable
    );
    if (!preparation.didRollback) {
      return;
    }
    coordinator.cleanupBundles(preparation.cleanupBundleIds);
    if (preparation.eventPayload != null) {
      sendDeviceEvent(preparation.eventPayload);
    }

    try {
      applyServerBasePathSynchronously(preparation.activationPath);
      if (shouldReload) {
        reloadWebViewSynchronously();
      }
    } catch (Exception e) {
      android.util.Log.w("OtaKit", "rollback activation failed", e);
    }
  }

  private void applyServerBasePathSynchronously(String path) throws Exception {
    runOnMainSynchronously(() -> {
      if (bridge == null) {
        throw new IllegalStateException("Bridge not available for activation");
      }
      if (path == null || path.isEmpty()) {
        bridge.setServerAssetPath(BUILTIN_ASSET_PATH);
      } else {
        bridge.setServerBasePath(path);
      }
    });
  }

  private void reloadWebViewSynchronously() throws Exception {
    runOnMainSynchronously(() -> {
      if (bridge == null || bridge.getWebView() == null) {
        throw new IllegalStateException("WebView not available for reload");
      }
      bridge.getWebView().reload();
    });
  }

  private void runOnMainSynchronously(ThrowingRunnable work) throws Exception {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      work.run();
      return;
    }

    CountDownLatch latch = new CountDownLatch(1);
    AtomicReference<Throwable> failure = new AtomicReference<>();
    mainHandler.post(() -> {
      try {
        work.run();
      } catch (Throwable error) {
        failure.set(error);
      } finally {
        latch.countDown();
      }
    });

    try {
      latch.await();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("Interrupted while waiting for main thread activation", e);
    }

    Throwable error = failure.get();
    if (error == null) {
      return;
    }
    if (error instanceof Exception) {
      throw (Exception) error;
    }
    throw new RuntimeException(error);
  }

  private JSObject manifestToJSObject(ManifestClient.LatestManifest latest) {
    JSObject object = new JSObject();
    object.put("version", latest.version);
    object.put("url", latest.url);
    object.put("sha256", latest.sha256);
    object.put("size", latest.size);
    if (latest.runtimeVersion != null) {
      object.put("runtimeVersion", latest.runtimeVersion);
    }
    object.put("releaseId", latest.releaseId);
    return object;
  }

  private BundleInfo downloadLatestManifest(
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) throws Exception {
    return downloadAndStage(
      new URL(latest.url),
      latest.version,
      latest.sha256,
      latest.size,
      latest.runtimeVersion,
      targetChannel,
      latest.releaseId
    );
  }

  private void moveDirectory(File source, File destination) throws Exception {
    if (source.renameTo(destination)) {
      return;
    }
    copyRecursively(source, destination);
    deleteRecursively(source);
  }

  private void copyRecursively(File source, File destination) throws Exception {
    if (source.isDirectory()) {
      if (!destination.exists() && !destination.mkdirs()) {
        throw new IllegalStateException(
          "Cannot create directory: " + destination.getAbsolutePath()
        );
      }
      File[] children = source.listFiles();
      if (children != null) {
        for (File child : children) {
          copyRecursively(child, new File(destination, child.getName()));
        }
      }
      return;
    }

    File parent = destination.getParentFile();
    if (parent != null && !parent.exists() && !parent.mkdirs()) {
      throw new IllegalStateException("Cannot create parent: " + parent.getAbsolutePath());
    }

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

  private void deleteRecursively(File target) throws Exception {
    if (!target.exists()) {
      return;
    }
    if (target.isDirectory()) {
      File[] children = target.listFiles();
      if (children != null) {
        for (File child : children) {
          deleteRecursively(child);
        }
      }
    }
    if (!target.delete()) {
      throw new IllegalStateException("Failed to delete: " + target.getAbsolutePath());
    }
  }

  private String buildBundleId(String version, String releaseId, String sha256) throws Exception {
    String trimmed = version == null ? "" : version.trim();
    String normalized = trimmed.replaceAll("[^A-Za-z0-9._-]", "-");
    normalized = normalized.replaceAll("-{2,}", "-");
    normalized = normalized.replaceAll("^[\\-.]+|[\\-.]+$", "");
    if (normalized.isEmpty()) {
      normalized = "bundle";
    }
    if (normalized.length() > 64) {
      normalized = normalized.substring(0, 64);
    }

    String identitySource = trimToNull(releaseId);
    if (identitySource == null) {
      identitySource = trimToNull(sha256);
    }
    if (identitySource == null) {
      identitySource = trimmed;
    }

    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(identitySource.getBytes(StandardCharsets.UTF_8));
    StringBuilder suffix = new StringBuilder();
    for (int i = 0; i < 6; i++) {
      suffix.append(String.format("%02x", hash[i]));
    }

    return normalized + "-" + suffix;
  }

  private String resolveIngestUrl(String configured, String env) {
    String configuredValue = trimToNull(configured);
    if (configuredValue != null) {
      return normalizeIngestUrl(configuredValue);
    }

    String envValue = trimToNull(env);
    if (envValue != null) {
      return normalizeIngestUrl(envValue);
    }

    return DEFAULT_INGEST_URL;
  }

  private String resolveCdnUrl(String configured, String env) {
    String configuredValue = trimToNull(configured);
    if (configuredValue != null) {
      return normalizeCdnUrl(configuredValue);
    }

    String envValue = trimToNull(env);
    if (envValue != null) {
      return normalizeCdnUrl(envValue);
    }

    return DEFAULT_CDN_URL;
  }

  private String normalizeIngestUrl(String raw) {
    String trimmed = raw.trim().replaceAll("/+$", "");
    if (trimmed.toLowerCase(java.util.Locale.ROOT).endsWith(INGEST_PATH_SUFFIX)) {
      return trimmed;
    }
    return trimmed + INGEST_PATH_SUFFIX;
  }

  private String normalizeCdnUrl(String raw) {
    return raw.trim().replaceAll("/+$", "");
  }

  private String trimToNull(String value) {
    if (value == null) {
      return null;
    }

    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private String resolveTargetChannel(String channel) {
    String resolved = trimToNull(channel);
    return resolved != null ? resolved : this.channel;
  }

  private void sendDeviceEvent(
    String action,
    String bundleVersion,
    String runtimeVersion,
    String channel,
    String releaseId,
    String detail
  ) {
    sendDeviceEvent(
      new UpdaterCoordinator.DeviceEventPayload(
        action,
        bundleVersion,
        runtimeVersion,
        channel,
        releaseId,
        detail
      )
    );
  }

  private void sendDeviceEvent(UpdaterCoordinator.DeviceEventPayload payload) {
    if (appId == null) {
      return;
    }
    String normalizedBundleVersion = trimToNull(payload.bundleVersion);
    if (normalizedBundleVersion == null) {
      android.util.Log.w("OtaKit", "Skipping device event without bundleVersion");
      return;
    }
    String normalizedReleaseId = trimToNull(payload.releaseId);
    if (normalizedReleaseId == null) {
      android.util.Log.w("OtaKit", "Skipping device event without releaseId");
      return;
    }
    String nativeBuild = trimToNull(coordinator.getNativeBuild());
    if (nativeBuild == null) {
      android.util.Log.w("OtaKit", "Skipping device event without nativeBuild");
      return;
    }
    DeviceEventClient.send(
      ingestUrl,
      appId,
      "android",
      payload.action,
      normalizedBundleVersion,
      payload.channel,
      trimToNull(payload.runtimeVersion),
      normalizedReleaseId,
      nativeBuild,
      payload.detail
    );
  }

  private void pruneIncompatibleBundles() {
    coordinator.cleanupBundles(coordinator.pruneIncompatibleBundles(this::isCompatibleRuntime));
  }

  private boolean isCompatibleRuntime(String bundleRuntimeVersion) {
    return java.util.Objects.equals(trimToNull(bundleRuntimeVersion), runtimeVersion);
  }

  private boolean isCompatibleRuntime(BundleInfo bundle) {
    return isCompatibleRuntime(bundle.runtimeVersion);
  }

  private boolean isBundleUsable(BundleInfo bundle) {
    return bundle != null && (bundle.isBuiltin() || isBundlePathUsable(bundle.path));
  }

  private boolean isBundlePathUsable(String path) {
    String normalizedPath = trimToNull(path);
    if (normalizedPath == null) {
      return false;
    }

    File directory = new File(normalizedPath);
    if (!directory.exists() || !directory.isDirectory()) {
      return false;
    }

    return new File(directory, "index.html").exists();
  }

  private long getFreeDiskSpace() {
    try {
      android.os.StatFs statFs = new android.os.StatFs(
        getContext().getFilesDir().getAbsolutePath()
      );
      return statFs.getAvailableBlocksLong() * statFs.getBlockSizeLong();
    } catch (Exception e) {
      return Long.MAX_VALUE; // If we can't determine, allow download
    }
  }
}
