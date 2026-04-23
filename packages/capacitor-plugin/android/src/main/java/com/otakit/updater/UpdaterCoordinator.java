package com.otakit.updater;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

final class UpdaterCoordinator {

  interface BundlePredicate {
    boolean test(BundleInfo bundle);
  }

  static final class StateSnapshot {

    final BundleInfo current;
    final BundleInfo fallback;
    final BundleInfo staged;
    final String builtinVersion;

    StateSnapshot(
      BundleInfo current,
      BundleInfo fallback,
      BundleInfo staged,
      String builtinVersion
    ) {
      this.current = current;
      this.fallback = fallback;
      this.staged = staged;
      this.builtinVersion = builtinVersion;
    }
  }

  static final class DeviceEventPayload {

    final String action;
    final String bundleVersion;
    final String runtimeVersion;
    final String channel;
    final String releaseId;
    final String detail;

    DeviceEventPayload(
      String action,
      String bundleVersion,
      String runtimeVersion,
      String channel,
      String releaseId,
      String detail
    ) {
      this.action = action;
      this.bundleVersion = bundleVersion;
      this.runtimeVersion = runtimeVersion;
      this.channel = channel;
      this.releaseId = releaseId;
      this.detail = detail;
    }
  }

  static final class LatestManifestClassification {

    final String kind;
    final BundleInfo bundle;

    private LatestManifestClassification(String kind, BundleInfo bundle) {
      this.kind = kind;
      this.bundle = bundle;
    }

    static LatestManifestClassification noUpdate() {
      return new LatestManifestClassification("no_update", null);
    }

    static LatestManifestClassification alreadyStaged(BundleInfo bundle) {
      return new LatestManifestClassification("already_staged", bundle);
    }

    static LatestManifestClassification updateAvailable() {
      return new LatestManifestClassification("update_available", null);
    }
  }

  static final class StartupPreparation {

    final String activationPath;
    final String trialBundleId;
    final List<String> cleanupBundleIds;
    final DeviceEventPayload eventPayload;

    StartupPreparation(
      String activationPath,
      String trialBundleId,
      List<String> cleanupBundleIds,
      DeviceEventPayload eventPayload
    ) {
      this.activationPath = activationPath;
      this.trialBundleId = trialBundleId;
      this.cleanupBundleIds = cleanupBundleIds;
      this.eventPayload = eventPayload;
    }
  }

  static final class ApplyPreparation {

    final String activationPath;
    final String trialBundleId;
    final List<String> cleanupBundleIds;

    ApplyPreparation(String activationPath, String trialBundleId, List<String> cleanupBundleIds) {
      this.activationPath = activationPath;
      this.trialBundleId = trialBundleId;
      this.cleanupBundleIds = cleanupBundleIds;
    }

    boolean didApply() {
      return activationPath != null;
    }
  }

  static final class NotifyReadyPreparation {

    final DeviceEventPayload eventPayload;
    final List<String> cleanupBundleIds;

    NotifyReadyPreparation(DeviceEventPayload eventPayload, List<String> cleanupBundleIds) {
      this.eventPayload = eventPayload;
      this.cleanupBundleIds = cleanupBundleIds;
    }
  }

  static final class RollbackPreparation {

    final boolean didRollback;
    final String activationPath;
    final DeviceEventPayload eventPayload;
    final List<String> cleanupBundleIds;

    RollbackPreparation(
      boolean didRollback,
      String activationPath,
      DeviceEventPayload eventPayload,
      List<String> cleanupBundleIds
    ) {
      this.didRollback = didRollback;
      this.activationPath = activationPath;
      this.eventPayload = eventPayload;
      this.cleanupBundleIds = cleanupBundleIds;
    }
  }

  private static final class LockedRollbackResult {

    final boolean didRollback;
    final String activationPath;
    final DeviceEventPayload eventPayload;

    LockedRollbackResult(
      boolean didRollback,
      String activationPath,
      DeviceEventPayload eventPayload
    ) {
      this.didRollback = didRollback;
      this.activationPath = activationPath;
      this.eventPayload = eventPayload;
    }
  }

  @FunctionalInterface
  private interface LockedSupplier<T> {
    T get() throws Exception;
  }

  private final BundleStore store;
  private final AtomicBoolean operationInProgress = new AtomicBoolean(false);
  private final ReentrantLock stateLock = new ReentrantLock();

  UpdaterCoordinator(BundleStore store) {
    this.store = store;
  }

  String getNativeBuild() {
    return store.getNativeBuild();
  }

  File bundleDirectory(String id) {
    return store.bundleDirectory(id);
  }

  boolean tryBeginOperation() {
    return operationInProgress.compareAndSet(false, true);
  }

  void endOperation() {
    operationInProgress.set(false);
  }

  StateSnapshot snapshotState(BundlePredicate isStagedBundleUsable) {
    return withStateLock(() ->
      new StateSnapshot(
        store.getCurrentBundle(),
        store.getFallbackBundle(),
        readStagedBundleLocked(null, isStagedBundleUsable),
        store.getBuiltinVersion()
      )
    );
  }

  BundleInfo lastFailure() {
    return withStateLock(store::getLastFailedBundle);
  }

  List<String> pruneIncompatibleBundles(BundlePredicate isCompatibleRuntime) {
    return withStateLock(() -> {
      Set<String> cleanupBundleIds = new LinkedHashSet<>();

      for (BundleInfo bundle : store.listDownloadedBundleInfos()) {
        if (!isCompatibleRuntime.test(bundle)) {
          detachBundleReferencesLocked(bundle.id);
          cleanupBundleIds.add(bundle.id);
        }
      }

      BundleInfo failed = store.getLastFailedBundle();
      if (failed != null && !isCompatibleRuntime.test(failed)) {
        store.setLastFailedBundle(null);
      }

      return new ArrayList<>(cleanupBundleIds);
    });
  }

  StartupPreparation normalizeStartupState(BundlePredicate isBundleUsable) {
    return withStateLock(() -> {
      Set<String> cleanupBundleIds = new LinkedHashSet<>();
      clearStaleBundlePointersLocked();
      normalizeStagedPointerLocked(isBundleUsable, cleanupBundleIds);
      normalizeFallbackPointerLocked(isBundleUsable, cleanupBundleIds);

      DeviceEventPayload eventPayload = null;
      BundleInfo current = store.getCurrentBundle();
      if (!current.isBuiltin() && current.status == BundleStatus.TRIAL) {
        LockedRollbackResult rollback = rollbackLocked(
          "app_restarted_before_notify",
          isBundleUsable,
          cleanupBundleIds
        );
        eventPayload = rollback.eventPayload;
      }

      BundleInfo normalizedCurrent = store.getCurrentBundle();
      if (!normalizedCurrent.isBuiltin() && !isBundleUsable.test(normalizedCurrent)) {
        cleanupBundleIds.add(normalizedCurrent.id);
        normalizedCurrent = restoreFallbackOrBuiltinLocked(isBundleUsable, cleanupBundleIds);
      }

      String trialBundleId = null;
      if (!normalizedCurrent.isBuiltin() && normalizedCurrent.status == BundleStatus.PENDING) {
        normalizedCurrent = updateStatusLocked(normalizedCurrent, BundleStatus.TRIAL);
        trialBundleId = normalizedCurrent.id;
      }

      return new StartupPreparation(
        normalizedCurrent.isBuiltin() ? null : normalizedCurrent.path,
        trialBundleId,
        new ArrayList<>(cleanupBundleIds),
        eventPayload
      );
    });
  }

  boolean isRuntimeUnresolved(String currentRuntimeKey) {
    return withStateLock(() ->
      !java.util.Objects.equals(store.getLastResolvedRuntimeKey(), currentRuntimeKey)
    );
  }

  void resolveRuntimeKey(String currentRuntimeKey) {
    withStateLock(() -> {
      store.setLastResolvedRuntimeKey(currentRuntimeKey);
      return null;
    });
  }

  LatestManifestClassification classifyLatestManifest(
    ManifestClient.LatestManifest manifest,
    String targetChannel,
    BundlePredicate isStagedBundleUsable
  ) {
    return withStateLock(() -> {
      BundleInfo current = store.getCurrentBundle();
      if (doesBundleMatchLatest(current, manifest, targetChannel)) {
        return LatestManifestClassification.noUpdate();
      }

      BundleInfo failed = store.getLastFailedBundle();
      if (failed != null && doesFailedBundleMatchLatest(failed, manifest, targetChannel)) {
        return LatestManifestClassification.noUpdate();
      }

      BundleInfo staged = readStagedBundleLocked(
        bundle ->
          java.util.Objects.equals(
            trimToNull(bundle.runtimeVersion),
            trimToNull(manifest.runtimeVersion)
          ),
        isStagedBundleUsable
      );
      if (staged != null && doesBundleMatchLatest(staged, manifest, targetChannel)) {
        return LatestManifestClassification.alreadyStaged(staged);
      }

      return LatestManifestClassification.updateAvailable();
    });
  }

  List<String> stageDownloadedBundle(BundleInfo bundle) throws Exception {
    return withStateLock(() -> {
      Set<String> cleanupBundleIds = new LinkedHashSet<>();
      String previousStagedId = store.getStagedBundleId();
      store.saveBundle(bundle);
      store.setStagedBundleId(bundle.id);

      if (
        previousStagedId != null &&
        !previousStagedId.equals(bundle.id) &&
        !"builtin".equals(previousStagedId) &&
        !previousStagedId.equals(store.getCurrentBundleId()) &&
        !previousStagedId.equals(store.getFallbackBundleId())
      ) {
        cleanupBundleIds.add(previousStagedId);
      }

      return new ArrayList<>(cleanupBundleIds);
    });
  }

  ApplyPreparation prepareApplyStaged(
    BundlePredicate isCompatibleRuntime,
    BundlePredicate isBundleUsable
  ) {
    return withStateLock(() -> {
      Set<String> cleanupBundleIds = new LinkedHashSet<>();
      BundleInfo staged = stagedBundleLocked(
        true,
        isCompatibleRuntime,
        isBundleUsable,
        cleanupBundleIds
      );
      if (staged == null) {
        return new ApplyPreparation(null, null, new ArrayList<>(cleanupBundleIds));
      }

      BundleInfo previousCurrent = store.getCurrentBundle();
      if (previousCurrent.isBuiltin()) {
        store.setFallbackBundleId(null);
      } else {
        store.setFallbackBundleId(previousCurrent.id);
      }

      store.setCurrentBundleId(staged.id);
      store.setStagedBundleId(null);

      String trialBundleId = null;
      if (staged.status == BundleStatus.PENDING) {
        staged = updateStatusLocked(staged, BundleStatus.TRIAL);
        trialBundleId = staged.id;
      } else if (staged.status == BundleStatus.TRIAL) {
        trialBundleId = staged.id;
      }

      return new ApplyPreparation(staged.path, trialBundleId, new ArrayList<>(cleanupBundleIds));
    });
  }

  NotifyReadyPreparation prepareNotifyAppReady() {
    return withStateLock(() -> {
      BundleInfo current = store.getCurrentBundle();
      if (current.isBuiltin() || current.status != BundleStatus.TRIAL) {
        return new NotifyReadyPreparation(null, new ArrayList<>());
      }

      String oldFallbackId = store.getFallbackBundleId();
      updateStatusLocked(current, BundleStatus.SUCCESS);
      store.setFallbackBundleId(current.id);

      Set<String> cleanupBundleIds = new LinkedHashSet<>();
      if (oldFallbackId != null && !oldFallbackId.equals(current.id)) {
        cleanupBundleIds.add(oldFallbackId);
      }

      return new NotifyReadyPreparation(
        new DeviceEventPayload(
          "applied",
          current.version,
          current.runtimeVersion,
          current.channel,
          current.releaseId,
          null
        ),
        new ArrayList<>(cleanupBundleIds)
      );
    });
  }

  RollbackPreparation prepareRollback(String reason, BundlePredicate isBundleUsable) {
    return withStateLock(() -> {
      Set<String> cleanupBundleIds = new LinkedHashSet<>();
      LockedRollbackResult rollback = rollbackLocked(reason, isBundleUsable, cleanupBundleIds);
      return new RollbackPreparation(
        rollback.didRollback,
        rollback.activationPath,
        rollback.eventPayload,
        new ArrayList<>(cleanupBundleIds)
      );
    });
  }

  boolean isCurrentTrialBundle(String bundleId) {
    return withStateLock(() -> {
      BundleInfo current = store.getCurrentBundle();
      return current.id.equals(bundleId) && current.status == BundleStatus.TRIAL;
    });
  }

  void cleanupBundles(List<String> bundleIds) {
    LinkedHashSet<String> uniqueIds = new LinkedHashSet<>();
    for (String bundleId : bundleIds) {
      if (bundleId != null && !bundleId.isEmpty() && !"builtin".equals(bundleId)) {
        uniqueIds.add(bundleId);
      }
    }

    for (String bundleId : uniqueIds) {
      deleteRecursivelyQuietly(store.bundleDirectory(bundleId));
    }
  }

  private <T> T withStateLock(LockedSupplier<T> work) {
    stateLock.lock();
    try {
      return work.get();
    } catch (RuntimeException e) {
      throw e;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    } finally {
      stateLock.unlock();
    }
  }

  private void clearStaleBundlePointersLocked() {
    String currentId = store.getCurrentBundleId();
    if (currentId != null && store.getBundle(currentId) == null) {
      store.setCurrentBundleId(null);
    }

    String fallbackId = store.getFallbackBundleId();
    if (fallbackId != null && store.getBundle(fallbackId) == null) {
      store.setFallbackBundleId(null);
    }

    String stagedId = store.getStagedBundleId();
    if (stagedId != null && store.getBundle(stagedId) == null) {
      store.setStagedBundleId(null);
    }
  }

  private void normalizeFallbackPointerLocked(
    BundlePredicate isBundleUsable,
    Set<String> cleanupBundleIds
  ) {
    String fallbackId = store.getFallbackBundleId();
    if (fallbackId == null) {
      return;
    }

    BundleInfo fallback = store.getBundle(fallbackId);
    if (fallback == null || fallback.isBuiltin()) {
      return;
    }

    if (!isBundleUsable.test(fallback)) {
      store.setFallbackBundleId(null);
      cleanupBundleIds.add(fallback.id);
    }
  }

  private void normalizeStagedPointerLocked(
    BundlePredicate isBundleUsable,
    Set<String> cleanupBundleIds
  ) {
    String stagedId = store.getStagedBundleId();
    if (stagedId == null) {
      return;
    }

    BundleInfo staged = store.getBundle(stagedId);
    if (staged == null) {
      store.setStagedBundleId(null);
      return;
    }

    if (!isBundleUsable.test(staged)) {
      store.setStagedBundleId(null);
      cleanupBundleIds.add(staged.id);
    }
  }

  private BundleInfo readStagedBundleLocked(
    BundlePredicate isCompatibleRuntime,
    BundlePredicate isUsable
  ) {
    return stagedBundleLocked(false, isCompatibleRuntime, isUsable, new LinkedHashSet<>());
  }

  private BundleInfo stagedBundleLocked(
    boolean cleanInvalid,
    BundlePredicate isCompatibleRuntime,
    BundlePredicate isUsable,
    Set<String> cleanupBundleIds
  ) {
    String stagedId = store.getStagedBundleId();
    if (stagedId == null) {
      return null;
    }

    BundleInfo staged = store.getBundle(stagedId);
    if (staged == null) {
      if (cleanInvalid) {
        store.setStagedBundleId(null);
      }
      return null;
    }

    if (isCompatibleRuntime != null && !isCompatibleRuntime.test(staged)) {
      if (cleanInvalid) {
        store.setStagedBundleId(null);
        cleanupBundleIds.add(staged.id);
      }
      return null;
    }

    if (!isUsable.test(staged)) {
      if (cleanInvalid) {
        store.setStagedBundleId(null);
        cleanupBundleIds.add(staged.id);
      }
      return null;
    }

    return staged;
  }

  private void detachBundleReferencesLocked(String bundleId) {
    if (bundleId.equals(store.getCurrentBundleId())) {
      store.setCurrentBundleId(null);
    }
    if (bundleId.equals(store.getFallbackBundleId())) {
      store.setFallbackBundleId(null);
    }
    if (bundleId.equals(store.getStagedBundleId())) {
      store.setStagedBundleId(null);
    }
  }

  private LockedRollbackResult rollbackLocked(
    String reason,
    BundlePredicate isBundleUsable,
    Set<String> cleanupBundleIds
  ) {
    BundleInfo current = store.getCurrentBundle();
    if (current.isBuiltin()) {
      return new LockedRollbackResult(false, null, null);
    }

    BundleInfo failed = updateStatusLocked(current, BundleStatus.ERROR);
    store.setLastFailedBundle(failed);
    store.setStagedBundleId(null);

    BundleInfo fallback = restoreFallbackOrBuiltinLocked(isBundleUsable, cleanupBundleIds);
    cleanupBundleIds.add(current.id);

    return new LockedRollbackResult(
      true,
      fallback.isBuiltin() ? null : fallback.path,
      new DeviceEventPayload(
        "rollback",
        current.version,
        current.runtimeVersion,
        current.channel,
        current.releaseId,
        reason
      )
    );
  }

  private BundleInfo restoreFallbackOrBuiltinLocked(
    BundlePredicate isBundleUsable,
    Set<String> cleanupBundleIds
  ) {
    String fallbackId = store.getFallbackBundleId();
    if (fallbackId != null) {
      BundleInfo fallback = store.getBundle(fallbackId);
      if (fallback != null && !fallback.isBuiltin() && isBundleUsable.test(fallback)) {
        store.setCurrentBundleId(fallback.id);
        return fallback;
      }
    }

    if (fallbackId != null) {
      store.setFallbackBundleId(null);
      if (!"builtin".equals(fallbackId)) {
        cleanupBundleIds.add(fallbackId);
      }
    }

    store.setCurrentBundleId(null);
    return store.builtinBundle();
  }

  private BundleInfo updateStatusLocked(BundleInfo bundle, BundleStatus status) {
    BundleInfo updated = bundle.withStatus(status);
    try {
      store.saveBundle(updated);
    } catch (Exception ignored) {}
    return updated;
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

    String latestReleaseId = trimToNull(latest.releaseId);
    String failedReleaseId = trimToNull(failed.releaseId);
    if (latestReleaseId != null && latestReleaseId.equals(failedReleaseId)) {
      return true;
    }

    String latestSha = trimToNull(latest.sha256);
    String failedSha = trimToNull(failed.sha256);
    return latestSha != null && latestSha.equals(failedSha);
  }

  private boolean doesBundleMatchLatest(
    BundleInfo bundle,
    ManifestClient.LatestManifest latest,
    String targetChannel
  ) {
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

    String latestReleaseId = trimToNull(latest.releaseId);
    String bundleReleaseId = trimToNull(bundle.releaseId);
    if (latestReleaseId != null && latestReleaseId.equals(bundleReleaseId)) {
      return true;
    }

    String latestSha = trimToNull(latest.sha256);
    String bundleSha = trimToNull(bundle.sha256);
    if (latestSha != null && latestSha.equals(bundleSha)) {
      return true;
    }

    if (
      latestReleaseId != null || bundleReleaseId != null || latestSha != null || bundleSha != null
    ) {
      return false;
    }

    return latest.version != null && latest.version.equals(bundle.version);
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private static void deleteRecursivelyQuietly(File target) {
    if (target == null || !target.exists()) {
      return;
    }

    if (target.isDirectory()) {
      File[] children = target.listFiles();
      if (children != null) {
        for (File child : children) {
          deleteRecursivelyQuietly(child);
        }
      }
    }

    try {
      //noinspection ResultOfMethodCallIgnored
      target.delete();
    } catch (Throwable ignored) {}
  }
}
