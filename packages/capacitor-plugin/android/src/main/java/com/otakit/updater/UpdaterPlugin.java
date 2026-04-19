package com.otakit.updater;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import com.getcapacitor.JSArray;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "OtaKit")
public class UpdaterPlugin extends Plugin {

  private enum ManagedOverlayState {
    INACTIVE,
    HOLDING_FOR_LAUNCH_DECISION,
    HOLDING_FOR_RESUME_DECISION,
    WAITING_FOR_APP_READY,
    TIMED_OUT_LAUNCH,
    TIMED_OUT_RESUME,
  }

  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final ZipUtils zipUtils = new ZipUtils();
  private final Object managedOverlayLock = new Object();

  private BundleStore store;
  private Runnable trialTimeoutRunnable;
  private Runnable managedOverlayTimeoutRunnable;

  private int appReadyTimeoutMs = 10_000;
  private boolean allowInsecureUrls = false;
  private String updateMode = UPDATE_MODE_NEXT_LAUNCH;
  private String ingestUrl;
  private String cdnUrl;
  private String appId;
  private String channel;
  private String runtimeVersion;
  private boolean immediateUpdateOnRuntimeChange = false;
  private boolean autoSplashscreen = false;
  private int autoSplashscreenTimeoutMs = 10_000;
  private int autoSplashscreenBackgroundColor = Color.BLACK;
  private java.util.List<ManifestVerifier.KeyEntry> manifestKeys = new java.util.ArrayList<>();
  private long checkIntervalMs = 600_000;
  private final AtomicBoolean checkInProgress = new AtomicBoolean(false);
  private ManagedOverlayState managedOverlayState = ManagedOverlayState.INACTIVE;
  private boolean skipNextResumeAutoUpdate = false;
  private View otaOverlayView;
  private static final String DEFAULT_INGEST_URL = "https://ingest.otakit.app/v1";
  private static final String DEFAULT_CDN_URL = "https://cdn.otakit.app";
  private static final String INGEST_PATH_SUFFIX = "/v1";
  private static final String UPDATE_MODE_MANUAL = "manual";
  private static final String UPDATE_MODE_NEXT_LAUNCH = "next-launch";
  private static final String UPDATE_MODE_NEXT_RESUME = "next-resume";
  private static final String UPDATE_MODE_IMMEDIATE = "immediate";
  private static final String KEY_LAST_CHECK_TIMESTAMP = "last_check_timestamp";
  private static final String DEFAULT_RUNTIME_KEY = "__default__";
  private static final String TRIGGER_LAUNCH = "launch";
  private static final String TRIGGER_RESUME = "resume";

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
    this.allowInsecureUrls = getConfig().getBoolean("allowInsecureUrls", false);
    String configuredUpdateMode = getConfig().getString("updateMode", UPDATE_MODE_NEXT_LAUNCH);
    this.updateMode = resolveUpdateMode(configuredUpdateMode);
    this.immediateUpdateOnRuntimeChange = getConfig().getBoolean(
      "immediateUpdateOnRuntimeChange",
      false
    );
    this.autoSplashscreen = getConfig().getBoolean("autoSplashscreen", false);
    this.autoSplashscreenBackgroundColor = parseAutoSplashscreenBackgroundColor(
      getConfig().getString("autoSplashscreenBackgroundColor")
    );

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
    this.autoSplashscreenTimeoutMs = Math.max(
      1000,
      getConfig().getInt("autoSplashscreenTimeout", 10_000)
    );
    this.checkIntervalMs = Math.max(600_000, getConfig().getInt("checkInterval", 600_000));
    logAutoSplashscreenConfigurationWarnings();

    pruneIncompatibleBundles();

    BundleInfo current = store.getCurrentBundle();
    if (current.status == BundleStatus.TRIAL) {
      rollbackCurrentBundle("app_restarted_before_notify");
      current = store.getCurrentBundle();
    }

    boolean forceImmediateRuntimeChangeLaunch = shouldForceImmediateRuntimeChangeLaunch();

    if (!forceImmediateRuntimeChangeLaunch && shouldActivateStagedOnLaunch()) {
      current = activateStagedBundleForLaunch();
    }

    if (!current.isBuiltin() && current.path != null) {
      applyServerBasePath(current.path);
    } else {
      applyServerBasePath(null);
    }

    if (current.status == BundleStatus.PENDING) {
      store.markStatus(current.id, BundleStatus.TRIAL);
      scheduleTrialTimeout(current.id);
    }

    boolean manageLaunchSplash = shouldManageLaunchSplash(forceImmediateRuntimeChangeLaunch);
    if (manageLaunchSplash) {
      showOtaKitOverlay();
      beginManagedLaunchSplash();
    }

    if (isAutomaticUpdateMode()) {
      runAutomaticUpdate(TRIGGER_LAUNCH, forceImmediateRuntimeChangeLaunch, manageLaunchSplash);
    }
  }

  @Override
  protected void handleOnStart() {
    super.handleOnStart();
    skipNextResumeAutoUpdate = false;

    if (!isAutomaticUpdateMode()) {
      return;
    }
    if (!isManagedOverlayInactive()) {
      skipNextResumeAutoUpdate = true;
      return;
    }
    if (UPDATE_MODE_IMMEDIATE.equals(updateMode) && autoSplashscreen) {
      skipNextResumeAutoUpdate = true;
      handleManagedImmediateResumeOnStart();
    }
  }

  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    if (skipNextResumeAutoUpdate) {
      skipNextResumeAutoUpdate = false;
      return;
    }
    if (isAutomaticUpdateMode()) {
      runAutomaticUpdate(TRIGGER_RESUME, false, false);
    }
  }

  private void runAutomaticUpdate(
    String trigger,
    boolean forceImmediateLaunch,
    boolean manageLaunchSplash
  ) {
    // Resume-only guards
    if (TRIGGER_RESUME.equals(trigger)) {
      if (UPDATE_MODE_MANUAL.equals(updateMode)) return;

      // next-resume and immediate: activate staged bundle on resume without server check
      if (
        (UPDATE_MODE_NEXT_RESUME.equals(updateMode) || UPDATE_MODE_IMMEDIATE.equals(updateMode))
      ) {
        if (activateStagedBundleForReload()) {
          reloadWebView();
          return;
        }
      }

      if (!UPDATE_MODE_IMMEDIATE.equals(updateMode) && shouldThrottleCheck()) return;
    }

    if (
      TRIGGER_LAUNCH.equals(trigger) &&
      !forceImmediateLaunch &&
      !UPDATE_MODE_IMMEDIATE.equals(updateMode) &&
      shouldThrottleCheck()
    ) {
      return;
    }

    // Acquire in-flight guard (submit-time)
    if (!checkInProgress.compareAndSet(false, true)) return;

    if (forceImmediateLaunch || UPDATE_MODE_IMMEDIATE.equals(updateMode)) {
      // Immediate: check+download, activate if found
      executor.execute(() -> {
        try {
          BundleInfo result = performCheckAndDownload(null, true);
          if (manageLaunchSplash) {
            if (result != null) {
              recordCheckTimestamp();
              if (beginManagedLaunchReload()) {
                if (activateStagedBundleForReload()) {
                  reloadWebView();
                } else if (cancelManagedOverlayAwaitingAppReady()) {
                  hideOtaKitOverlay();
                }
              }
            } else {
              if (forceImmediateLaunch) {
                resolveCurrentRuntimeKey();
              }
              recordCheckTimestamp();
              if (finishManagedLaunchDecision()) {
                hideOtaKitOverlay();
              }
            }
          } else if (result != null) {
            if (forceImmediateLaunch) {
              recordCheckTimestamp();
            }
            if (activateStagedBundleForReload()) {
              reloadWebView();
            }
          } else if (forceImmediateLaunch) {
            resolveCurrentRuntimeKey();
            recordCheckTimestamp();
          }
        } catch (Exception e) {
          if (manageLaunchSplash && finishManagedLaunchDecision()) {
            hideOtaKitOverlay();
          }
          String reason = forceImmediateLaunch
            ? "runtime-change startup update failed"
            : "immediate update failed (" + trigger + ")";
          android.util.Log.w("OtaKit", reason, e);
        } finally {
          checkInProgress.set(false);
        }
      });
      return;
    }

    // next-launch / next-resume: background check+download (fire-and-forget)
    executor.execute(() -> {
      try {
        performCheckAndDownload(null, true);
        recordCheckTimestamp();
      } catch (Exception ignored) {
        // Check failed — timestamp not recorded, will retry on next trigger
      } finally {
        checkInProgress.set(false);
      }
    });
  }

  private void handleManagedImmediateResumeOnStart() {
    if (resolveValidStagedBundleForActivation() != null) {
      if (!beginManagedResumeAppReadyWait()) {
        return;
      }
      if (activateStagedBundleForReload()) {
        reloadWebView();
      } else if (cancelManagedOverlayAwaitingAppReady()) {
        hideOtaKitOverlay();
      }
      return;
    }

    if (!checkInProgress.compareAndSet(false, true)) {
      return;
    }
    if (!beginManagedResumeSplash()) {
      checkInProgress.set(false);
      return;
    }

    executor.execute(() -> {
      try {
        BundleInfo result = performCheckAndDownload(null, true);
        if (result != null) {
          if (beginManagedResumeReload()) {
            if (activateStagedBundleForReload()) {
              reloadWebView();
            } else if (cancelManagedOverlayAwaitingAppReady()) {
              hideOtaKitOverlay();
            }
          }
        } else if (finishManagedResumeDecision()) {
          hideOtaKitOverlay();
        }
      } catch (Exception e) {
        if (finishManagedResumeDecision()) {
          hideOtaKitOverlay();
        }
        android.util.Log.w("OtaKit", "immediate managed resume update failed", e);
      } finally {
        checkInProgress.set(false);
      }
    });
  }

  private boolean shouldThrottleCheck() {
    long lastCheck = store.getPrefs().getLong(KEY_LAST_CHECK_TIMESTAMP, 0);
    if (lastCheck <= 0) return false;
    long elapsed = System.currentTimeMillis() - lastCheck;
    return elapsed < checkIntervalMs;
  }

  private void recordCheckTimestamp() {
    store.getPrefs().edit().putLong(KEY_LAST_CHECK_TIMESTAMP, System.currentTimeMillis()).apply();
  }

  private boolean shouldActivateStagedOnLaunch() {
    return !UPDATE_MODE_MANUAL.equals(updateMode);
  }

  private boolean isAutomaticUpdateMode() {
    return !UPDATE_MODE_MANUAL.equals(updateMode);
  }

  private boolean shouldForceImmediateRuntimeChangeLaunch() {
    if (!immediateUpdateOnRuntimeChange) {
      return false;
    }
    if (UPDATE_MODE_MANUAL.equals(updateMode)) {
      android.util.Log.w(
        "OtaKit",
        "immediateUpdateOnRuntimeChange is ignored when updateMode is manual"
      );
      return false;
    }
    if (UPDATE_MODE_IMMEDIATE.equals(updateMode)) {
      android.util.Log.w(
        "OtaKit",
        "immediateUpdateOnRuntimeChange is ignored when updateMode is immediate"
      );
      return false;
    }
    return !java.util.Objects.equals(store.getLastResolvedRuntimeKey(), currentRuntimeKey());
  }

  private String currentRuntimeKey() {
    return runtimeVersion != null ? runtimeVersion : DEFAULT_RUNTIME_KEY;
  }

  private void resolveCurrentRuntimeKey() {
    store.setLastResolvedRuntimeKey(currentRuntimeKey());
  }

  private String resolveUpdateMode(String configuredUpdateMode) {
    if (configuredUpdateMode == null) {
      return UPDATE_MODE_NEXT_LAUNCH;
    }

    String raw = configuredUpdateMode.trim().toLowerCase();
    if (raw.isEmpty() || UPDATE_MODE_NEXT_LAUNCH.equals(raw)) {
      return UPDATE_MODE_NEXT_LAUNCH;
    }
    if (UPDATE_MODE_MANUAL.equals(raw)) {
      return UPDATE_MODE_MANUAL;
    }
    if (UPDATE_MODE_NEXT_RESUME.equals(raw)) {
      return UPDATE_MODE_NEXT_RESUME;
    }
    if (UPDATE_MODE_IMMEDIATE.equals(raw)) {
      return UPDATE_MODE_IMMEDIATE;
    }

    android.util.Log.w("OtaKit", "Unknown updateMode '" + raw + "', defaulting to 'next-launch'");
    return UPDATE_MODE_NEXT_LAUNCH;
  }

  @PluginMethod
  public void getState(PluginCall call) {
    JSObject result = new JSObject();
    result.put("current", store.getCurrentBundle().toJSObject());
    result.put("fallback", store.getFallbackBundle().toJSObject());
    result.put("builtinVersion", store.getBuiltinVersion());

    String stagedId = store.getStagedBundleId();
    if (stagedId != null) {
      BundleInfo staged = store.getBundle(stagedId);
      if (staged == null) {
        store.setStagedBundleId(null);
      }
      result.put("staged", staged != null ? staged.toJSObject() : null);
    } else {
      result.put("staged", null);
    }

    call.resolve(result);
  }

  @PluginMethod
  public void check(PluginCall call) {
    if (!checkInProgress.compareAndSet(false, true)) {
      String stagedId = store.getStagedBundleId();
      if (stagedId != null) {
        BundleInfo staged = store.getBundle(stagedId);
        if (staged != null) {
          JSObject result = new JSObject();
          result.put("version", staged.version);
          result.put("url", "");
          result.put("sha256", staged.sha256 != null ? staged.sha256 : "");
          result.put("size", 0);
          result.put("downloaded", true);
          if (staged.runtimeVersion != null) {
            result.put("runtimeVersion", staged.runtimeVersion);
          }
          if (staged.releaseId != null) {
            result.put("releaseId", staged.releaseId);
          }
          call.resolve(result);
          return;
        }
      }
      call.resolve((JSObject) null);
      return;
    }
    String targetChannel = resolveTargetChannel(null);
    executor.execute(() -> {
      try {
        ManifestClient.LatestManifest latest = fetchLatest(targetChannel);
        if (latest == null) {
          call.resolve((JSObject) null);
        } else if (isCurrentBundleLatest(latest, targetChannel)) {
          call.resolve((JSObject) null);
        } else if (shouldSuppressLatestManifest(latest, targetChannel)) {
          call.resolve((JSObject) null);
        } else {
          BundleInfo staged = findMatchingStagedBundle(latest, targetChannel);
          call.resolve(manifestToJSObject(latest, staged != null));
        }
      } catch (Exception e) {
        call.reject("check failed: " + e.getMessage());
      } finally {
        checkInProgress.set(false);
      }
    });
  }

  @PluginMethod
  public void download(PluginCall call) {
    if (!checkInProgress.compareAndSet(false, true)) {
      String stagedId = store.getStagedBundleId();
      if (stagedId != null) {
        BundleInfo staged = store.getBundle(stagedId);
        if (staged != null) {
          call.resolve(staged.toJSObject());
          return;
        }
      }
      call.resolve((JSObject) null);
      return;
    }
    executor.execute(() -> {
      try {
        BundleInfo bundle = performCheckAndDownload(null, true);
        if (bundle == null) {
          call.resolve((JSObject) null);
        } else {
          call.resolve(bundle.toJSObject());
        }
      } catch (Exception e) {
        call.reject("download failed: " + e.getMessage());
      } finally {
        checkInProgress.set(false);
      }
    });
  }

  @PluginMethod
  public void apply(PluginCall call) {
    if (!activateStagedBundleForReload()) {
      call.reject("No valid staged update to apply");
      return;
    }
    call.resolve();
    reloadWebView();
  }

  @PluginMethod
  public void notifyAppReady(PluginCall call) {
    BundleInfo current = store.getCurrentBundle();
    if (completeManagedOverlayOnAppReady()) {
      hideOtaKitOverlay();
    }

    if (
      !current.isBuiltin() &&
      (current.status == BundleStatus.TRIAL || current.status == BundleStatus.PENDING)
    ) {
      BundleInfo oldFallback = store.getFallbackBundle();

      store.markStatus(current.id, BundleStatus.SUCCESS);
      store.setFallbackBundleId(current.id);
      BundleInfo updated = store.getBundle(current.id);
      notifyListeners("appReady", updated != null ? updated.toJSObject() : current.toJSObject());

      sendDeviceEvent(
        "applied",
        current.version,
        current.runtimeVersion,
        current.channel,
        current.releaseId,
        null
      );

      if (!oldFallback.isBuiltin() && !oldFallback.id.equals(current.id)) {
        try {
          store.deleteBundle(oldFallback.id);
        } catch (Exception ignored) {}
      }
    }

    call.resolve();
  }

  @PluginMethod
  public void getLastFailure(PluginCall call) {
    BundleInfo failed = store.getFailedBundle();
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

  private BundleInfo performCheckAndDownload(String channel, boolean emitEvents) throws Exception {
    String targetChannel = resolveTargetChannel(channel);
    ManifestClient.LatestManifest latest = fetchLatest(targetChannel);
    if (latest == null) {
      if (emitEvents) {
        notifyListeners("noUpdateAvailable", new JSObject());
      }
      return null;
    }

    if (!isCompatibleRuntime(latest.runtimeVersion)) {
      throw new IllegalStateException(
        "Manifest runtimeVersion does not match the installed app runtime"
      );
    }

    if (isCurrentBundleLatest(latest, targetChannel)) {
      if (emitEvents) {
        notifyListeners("noUpdateAvailable", new JSObject());
      }
      return null;
    }

    if (shouldSuppressLatestManifest(latest, targetChannel)) {
      if (emitEvents) {
        notifyListeners("noUpdateAvailable", new JSObject());
      }
      return null;
    }

    BundleInfo staged = findMatchingStagedBundle(latest, targetChannel);
    if (emitEvents) {
      notifyListeners("updateAvailable", manifestToJSObject(latest, staged != null));
    }

    if (staged != null) {
      return staged;
    }

    return downloadLatestManifest(latest, targetChannel);
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

  private BundleInfo downloadAndStage(URL url, String version, String expectedSha256)
    throws Exception {
    return downloadAndStage(url, version, expectedSha256, 0, null, null, null);
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

    JSObject start = new JSObject();
    start.put("version", version);
    notifyListeners("downloadStarted", start);

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

      String bundleId = buildBundleId(version);
      File destination = store.bundleDirectory(bundleId);
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
      String previousStagedId = store.getStagedBundleId();
      store.saveBundle(info);
      store.setStagedBundleId(bundleId);
      cleanupSupersededStagedBundle(previousStagedId, bundleId);

      notifyListeners("downloadComplete", info.toJSObject());
      sendDeviceEvent("downloaded", version, runtimeVersion, channel, releaseId, null);
      return info;
    } catch (Exception e) {
      JSObject failed = new JSObject();
      failed.put("version", version);
      failed.put("error", e.getMessage());
      notifyListeners("downloadFailed", failed);
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

  private BundleInfo activateStagedBundleForLaunch() {
    BundleInfo staged = resolveValidStagedBundleForActivation();
    if (staged == null) {
      return store.getCurrentBundle();
    }

    resolveCurrentRuntimeKey();
    store.setCurrentBundleId(staged.id);
    store.setStagedBundleId(null);
    return staged;
  }

  private boolean activateStagedBundleForReload() {
    BundleInfo staged = resolveValidStagedBundleForActivation();
    if (staged == null) {
      return false;
    }

    resolveCurrentRuntimeKey();
    store.setCurrentBundleId(staged.id);
    store.setStagedBundleId(null);

    if (staged.status == BundleStatus.PENDING) {
      store.markStatus(staged.id, BundleStatus.TRIAL);
      staged = store.getBundle(staged.id);
    }
    if (staged != null && staged.status == BundleStatus.TRIAL) {
      scheduleTrialTimeout(staged.id);
    }

    if (staged != null && staged.path != null) {
      applyServerBasePath(staged.path);
    } else {
      applyServerBasePath(null);
    }
    return true;
  }

  private void scheduleTrialTimeout(String bundleId) {
    cancelTrialTimeout();
    trialTimeoutRunnable = () -> {
      BundleInfo current = store.getCurrentBundle();
      if (current.id.equals(bundleId) && current.status == BundleStatus.TRIAL) {
        rollbackCurrentBundle("notify_timeout");
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

  private boolean shouldManageLaunchSplash(boolean forceImmediateRuntimeChangeLaunch) {
    if (!autoSplashscreen) {
      return false;
    }
    return UPDATE_MODE_IMMEDIATE.equals(updateMode) || forceImmediateRuntimeChangeLaunch;
  }

  private void beginManagedLaunchSplash() {
    synchronized (managedOverlayLock) {
      cancelManagedOverlayTimeoutLocked();
      managedOverlayState = ManagedOverlayState.HOLDING_FOR_LAUNCH_DECISION;
      managedOverlayTimeoutRunnable = () -> {
        if (markManagedLaunchTimedOut()) {
          hideOtaKitOverlay();
        }
      };
      mainHandler.postDelayed(managedOverlayTimeoutRunnable, autoSplashscreenTimeoutMs);
    }
  }

  private void cancelManagedOverlayTimeoutLocked() {
    if (managedOverlayTimeoutRunnable != null) {
      mainHandler.removeCallbacks(managedOverlayTimeoutRunnable);
      managedOverlayTimeoutRunnable = null;
    }
  }

  private boolean markManagedLaunchTimedOut() {
    synchronized (managedOverlayLock) {
      switch (managedOverlayState) {
        case HOLDING_FOR_LAUNCH_DECISION:
          managedOverlayState = ManagedOverlayState.TIMED_OUT_LAUNCH;
          managedOverlayTimeoutRunnable = null;
          return true;
        case WAITING_FOR_APP_READY:
          managedOverlayState = ManagedOverlayState.INACTIVE;
          managedOverlayTimeoutRunnable = null;
          return true;
        case INACTIVE:
        case HOLDING_FOR_RESUME_DECISION:
        case TIMED_OUT_LAUNCH:
        case TIMED_OUT_RESUME:
          return false;
      }
      return false;
    }
  }

  private boolean markManagedResumeTimedOut() {
    synchronized (managedOverlayLock) {
      if (managedOverlayState != ManagedOverlayState.HOLDING_FOR_RESUME_DECISION) {
        return false;
      }
      managedOverlayState = ManagedOverlayState.TIMED_OUT_RESUME;
      managedOverlayTimeoutRunnable = null;
      return true;
    }
  }

  private boolean isManagedOverlayInactive() {
    synchronized (managedOverlayLock) {
      return managedOverlayState == ManagedOverlayState.INACTIVE;
    }
  }

  private boolean beginManagedLaunchReload() {
    synchronized (managedOverlayLock) {
      switch (managedOverlayState) {
        case HOLDING_FOR_LAUNCH_DECISION:
          cancelManagedOverlayTimeoutLocked();
          managedOverlayState = ManagedOverlayState.WAITING_FOR_APP_READY;
          return true;
        case TIMED_OUT_LAUNCH:
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return false;
        case INACTIVE:
        case HOLDING_FOR_RESUME_DECISION:
        case WAITING_FOR_APP_READY:
        case TIMED_OUT_RESUME:
          return false;
      }
      return false;
    }
  }

  private boolean finishManagedLaunchDecision() {
    synchronized (managedOverlayLock) {
      switch (managedOverlayState) {
        case HOLDING_FOR_LAUNCH_DECISION:
          managedOverlayState = ManagedOverlayState.WAITING_FOR_APP_READY;
          return false;
        case TIMED_OUT_LAUNCH:
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return false;
        case INACTIVE:
        case HOLDING_FOR_RESUME_DECISION:
        case WAITING_FOR_APP_READY:
        case TIMED_OUT_RESUME:
          return false;
      }
      return false;
    }
  }

  private boolean completeManagedOverlayOnAppReady() {
    synchronized (managedOverlayLock) {
      switch (managedOverlayState) {
        case HOLDING_FOR_LAUNCH_DECISION:
        case HOLDING_FOR_RESUME_DECISION:
          return false;
        case WAITING_FOR_APP_READY:
          cancelManagedOverlayTimeoutLocked();
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return true;
        case TIMED_OUT_LAUNCH:
        case TIMED_OUT_RESUME:
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return false;
        case INACTIVE:
          return false;
      }
      return false;
    }
  }

  private boolean cancelManagedOverlayAwaitingAppReady() {
    synchronized (managedOverlayLock) {
      if (managedOverlayState != ManagedOverlayState.WAITING_FOR_APP_READY) {
        return false;
      }
      cancelManagedOverlayTimeoutLocked();
      managedOverlayState = ManagedOverlayState.INACTIVE;
      return true;
    }
  }

  private boolean beginManagedResumeAppReadyWait() {
    boolean shouldShowOverlay = false;
    synchronized (managedOverlayLock) {
      if (managedOverlayState == ManagedOverlayState.INACTIVE) {
        managedOverlayState = ManagedOverlayState.WAITING_FOR_APP_READY;
        shouldShowOverlay = true;
      }
    }
    if (!shouldShowOverlay) {
      return false;
    }
    showOtaKitOverlay();
    return true;
  }

  private boolean beginManagedResumeSplash() {
    Runnable timeoutRunnable = null;
    synchronized (managedOverlayLock) {
      if (managedOverlayState == ManagedOverlayState.INACTIVE) {
        cancelManagedOverlayTimeoutLocked();
        managedOverlayState = ManagedOverlayState.HOLDING_FOR_RESUME_DECISION;
        timeoutRunnable = () -> {
          if (markManagedResumeTimedOut()) {
            hideOtaKitOverlay();
          }
        };
        managedOverlayTimeoutRunnable = timeoutRunnable;
      }
    }
    if (timeoutRunnable == null) {
      return false;
    }
    showOtaKitOverlay();
    mainHandler.postDelayed(timeoutRunnable, autoSplashscreenTimeoutMs);
    return true;
  }

  private boolean beginManagedResumeReload() {
    synchronized (managedOverlayLock) {
      switch (managedOverlayState) {
        case HOLDING_FOR_RESUME_DECISION:
          cancelManagedOverlayTimeoutLocked();
          managedOverlayState = ManagedOverlayState.WAITING_FOR_APP_READY;
          return true;
        case TIMED_OUT_RESUME:
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return false;
        case INACTIVE:
        case HOLDING_FOR_LAUNCH_DECISION:
        case WAITING_FOR_APP_READY:
        case TIMED_OUT_LAUNCH:
          return false;
      }
      return false;
    }
  }

  private boolean finishManagedResumeDecision() {
    synchronized (managedOverlayLock) {
      switch (managedOverlayState) {
        case HOLDING_FOR_RESUME_DECISION:
          cancelManagedOverlayTimeoutLocked();
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return true;
        case TIMED_OUT_RESUME:
          managedOverlayState = ManagedOverlayState.INACTIVE;
          return false;
        case INACTIVE:
        case HOLDING_FOR_LAUNCH_DECISION:
        case WAITING_FOR_APP_READY:
        case TIMED_OUT_LAUNCH:
          return false;
      }
      return false;
    }
  }

  private BundleInfo resolveValidStagedBundleForActivation() {
    String stagedId = store.getStagedBundleId();
    if (stagedId == null) {
      return null;
    }

    BundleInfo staged = store.getBundle(stagedId);
    if (staged == null) {
      store.setStagedBundleId(null);
      return null;
    }
    if (!isCompatibleRuntime(staged)) {
      try {
        store.deleteBundle(staged.id);
      } catch (Exception ignored) {}
      store.setStagedBundleId(null);
      return null;
    }
    return staged;
  }

  private void showOtaKitOverlay() {
    if (!autoSplashscreen) {
      return;
    }

    Runnable show = () -> {
      if (otaOverlayView != null) {
        return;
      }
      if (bridge == null) {
        android.util.Log.w("OtaKit", "showOtaKitOverlay skipped: bridge is not ready");
        return;
      }
      if (bridge.getWebView() == null) {
        android.util.Log.w("OtaKit", "showOtaKitOverlay skipped: WebView is not ready");
        return;
      }
      View rootView = bridge.getWebView().getRootView();
      if (!(rootView instanceof ViewGroup)) {
        android.util.Log.w("OtaKit", "showOtaKitOverlay skipped: root view is not a ViewGroup");
        return;
      }
      View overlay = new View(getContext());
      overlay.setBackgroundColor(autoSplashscreenBackgroundColor);
      ViewGroup decorView = (ViewGroup) rootView;
      ViewGroup.LayoutParams params = new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      );
      decorView.addView(overlay, params);
      otaOverlayView = overlay;
    };
    if (Looper.myLooper() == Looper.getMainLooper()) {
      show.run();
    } else {
      mainHandler.post(show);
    }
  }

  private void hideOtaKitOverlay() {
    Runnable hide = () -> {
      View overlay = otaOverlayView;
      if (overlay == null) {
        return;
      }
      otaOverlayView = null;
      overlay.animate().alpha(0f).setDuration(200).withEndAction(() -> {
        ViewGroup parent = (ViewGroup) overlay.getParent();
        if (parent != null) {
          parent.removeView(overlay);
        }
      }).start();
    };
    if (Looper.myLooper() == Looper.getMainLooper()) {
      hide.run();
    } else {
      mainHandler.post(hide);
    }
  }

  private int parseAutoSplashscreenBackgroundColor(String raw) {
    String normalized = trimToNull(raw);
    if (normalized == null) {
      return Color.BLACK;
    }
    if (!normalized.matches("^#[0-9a-fA-F]{6}$")) {
      android.util.Log.w(
        "OtaKit",
        "Invalid autoSplashscreenBackgroundColor '" + raw + "'. Expected #rrggbb."
      );
      return Color.BLACK;
    }
    return Color.parseColor(normalized);
  }

  private void logAutoSplashscreenConfigurationWarnings() {
    if (!autoSplashscreen) {
      return;
    }

    if (UPDATE_MODE_MANUAL.equals(updateMode)) {
      android.util.Log.w(
        "OtaKit",
        "autoSplashscreen is enabled, but updateMode is manual so no managed overlay can occur."
      );
      return;
    }

    if (!UPDATE_MODE_IMMEDIATE.equals(updateMode) && !immediateUpdateOnRuntimeChange) {
      android.util.Log.w(
        "OtaKit",
        "autoSplashscreen is enabled, but this config never shows the OtaKit overlay unless updateMode is immediate or immediateUpdateOnRuntimeChange is true."
      );
    }
  }

  private void rollbackCurrentBundle(String reason) {
    cancelTrialTimeout();

    BundleInfo current = store.getCurrentBundle();
    if (current.isBuiltin()) {
      return;
    }

    BundleInfo failed = current.withStatus(BundleStatus.ERROR);
    store.markStatus(current.id, BundleStatus.ERROR);
    store.setFailedBundle(failed);
    store.setStagedBundleId(null);

    sendDeviceEvent(
      "rollback",
      current.version,
      current.runtimeVersion,
      current.channel,
      current.releaseId,
      reason
    );

    BundleInfo fallback = store.getFallbackBundle();
    JSObject payload = new JSObject();
    payload.put("from", failed.toJSObject());

    if (!fallback.isBuiltin() && fallback.path != null) {
      store.setCurrentBundleId(fallback.id);
      applyServerBasePath(fallback.path);
      payload.put("to", fallback.toJSObject());
    } else {
      store.setCurrentBundleId(null);
      applyServerBasePath(null);
      payload.put("to", store.builtinBundle().toJSObject());
    }
    payload.put("reason", reason);

    notifyListeners("rollback", payload);

    try {
      store.deleteBundle(current.id);
    } catch (Exception ignored) {}

    reloadWebView();
  }

  private void cleanupSupersededStagedBundle(String previousStagedId, String replacementId) {
    if (
      previousStagedId == null ||
      previousStagedId.equals(replacementId) ||
      "builtin".equals(previousStagedId)
    ) {
      return;
    }

    BundleInfo current = store.getCurrentBundle();
    if (previousStagedId.equals(current.id)) {
      return;
    }

    BundleInfo fallback = store.getFallbackBundle();
    if (previousStagedId.equals(fallback.id)) {
      return;
    }

    try {
      store.deleteBundle(previousStagedId);
    } catch (Exception ignored) {}
  }

  private void applyServerBasePath(String path) {
    mainHandler.post(() -> {
      try {
        if (path == null || path.isEmpty()) {
          bridge.setServerBasePath("");
        } else {
          bridge.setServerBasePath(path);
        }
      } catch (Throwable ignored) {}
    });
  }

  private void reloadWebView() {
    mainHandler.post(() -> {
      if (bridge != null && bridge.getWebView() != null) {
        bridge.getWebView().reload();
      }
    });
  }

  private JSObject manifestToJSObject(ManifestClient.LatestManifest latest, boolean downloaded) {
    JSObject object = new JSObject();
    object.put("version", latest.version);
    object.put("url", latest.url);
    object.put("sha256", latest.sha256);
    object.put("size", latest.size);
    object.put("downloaded", downloaded);
    if (latest.runtimeVersion != null) {
      object.put("runtimeVersion", latest.runtimeVersion);
    }
    object.put("releaseId", latest.releaseId);
    return object;
  }

  private boolean isCurrentBundleLatest(
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) {
    return doesBundleMatchLatest(store.getCurrentBundle(), latest, targetChannel);
  }

  private boolean shouldSuppressLatestManifest(
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) {
    BundleInfo failed = store.getFailedBundle();
    return failed != null && doesFailedBundleMatchLatest(failed, latest, targetChannel);
  }

  private boolean doesFailedBundleMatchLatest(
    BundleInfo failed,
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) {
    if (!java.util.Objects.equals(trimToNull(failed.channel), targetChannel)) {
      return false;
    }
    if (
      !java.util.Objects.equals(
        trimToNull(failed.runtimeVersion),
        trimToNull(latest.runtimeVersion)
      )
    ) {
      return false;
    }
    if (
      latest.releaseId != null &&
      failed.releaseId != null &&
      latest.releaseId.equals(failed.releaseId)
    ) {
      return true;
    }
    return (
      latest.sha256 != null &&
      failed.sha256 != null &&
      !latest.sha256.isEmpty() &&
      latest.sha256.equals(failed.sha256)
    );
  }

  private boolean doesBundleMatchLatest(
    BundleInfo bundle,
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) {
    if (bundle == null) {
      return false;
    }

    if (!java.util.Objects.equals(trimToNull(bundle.channel), targetChannel)) {
      return false;
    }

    if (
      !java.util.Objects.equals(
        trimToNull(bundle.runtimeVersion),
        trimToNull(latest.runtimeVersion)
      )
    ) {
      return false;
    }

    if (
      latest.releaseId != null &&
      bundle.releaseId != null &&
      latest.releaseId.equals(bundle.releaseId)
    ) {
      return true;
    }

    if (latest.sha256 != null && bundle.sha256 != null && latest.sha256.equals(bundle.sha256)) {
      return true;
    }

    return latest.version != null && latest.version.equals(bundle.version);
  }

  private BundleInfo findMatchingStagedBundle(
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) {
    String stagedId = store.getStagedBundleId();
    if (stagedId == null) {
      return null;
    }

    BundleInfo staged = store.getBundle(stagedId);
    if (staged == null) {
      store.setStagedBundleId(null);
      return null;
    }

    if (!java.util.Objects.equals(trimToNull(staged.channel), targetChannel)) {
      return null;
    }

    if (
      !java.util.Objects.equals(
        trimToNull(staged.runtimeVersion),
        trimToNull(latest.runtimeVersion)
      )
    ) {
      return null;
    }

    return doesBundleMatchLatest(staged, latest, targetChannel) ? staged : null;
  }

  private BundleInfo downloadLatestManifest(
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) throws Exception {
    try {
      return downloadAndStage(
        new URL(latest.url),
        latest.version,
        latest.sha256,
        latest.size,
        latest.runtimeVersion,
        targetChannel,
        latest.releaseId
      );
    } catch (Exception e) {
      if (isExpiredURLError(e)) {
        ManifestClient.LatestManifest refreshed = fetchLatest(targetChannel);
        if (refreshed == null) {
          throw e;
        }
        return downloadAndStage(
          new URL(refreshed.url),
          refreshed.version,
          refreshed.sha256,
          refreshed.size,
          refreshed.runtimeVersion,
          targetChannel,
          refreshed.releaseId
        );
      }
      throw e;
    }
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

  private String buildBundleId(String version) throws Exception {
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

    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(trimmed.getBytes(StandardCharsets.UTF_8));
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
    if (appId == null) {
      return;
    }
    String normalizedBundleVersion = trimToNull(bundleVersion);
    if (normalizedBundleVersion == null) {
      android.util.Log.w("OtaKit", "Skipping device event without bundleVersion");
      return;
    }
    String normalizedReleaseId = trimToNull(releaseId);
    if (normalizedReleaseId == null) {
      android.util.Log.w("OtaKit", "Skipping device event without releaseId");
      return;
    }
    String nativeBuild = trimToNull(store.getNativeBuild());
    if (nativeBuild == null) {
      android.util.Log.w("OtaKit", "Skipping device event without nativeBuild");
      return;
    }
    DeviceEventClient.send(
      ingestUrl,
      appId,
      "android",
      action,
      normalizedBundleVersion,
      channel,
      trimToNull(runtimeVersion),
      normalizedReleaseId,
      nativeBuild,
      detail
    );
  }

  private void pruneIncompatibleBundles() {
    for (BundleInfo bundle : store.listDownloadedBundleInfos()) {
      if (!isCompatibleRuntime(bundle)) {
        try {
          store.deleteBundle(bundle.id);
        } catch (Exception ignored) {}
      }
    }

    BundleInfo failed = store.getFailedBundle();
    if (failed != null && !isCompatibleRuntime(failed)) {
      store.setFailedBundle(null);
    }
  }

  private boolean isCompatibleRuntime(String bundleRuntimeVersion) {
    return java.util.Objects.equals(trimToNull(bundleRuntimeVersion), runtimeVersion);
  }

  private boolean isCompatibleRuntime(BundleInfo bundle) {
    return isCompatibleRuntime(bundle.runtimeVersion);
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
