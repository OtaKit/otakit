import Foundation

final class UpdaterCoordinator {
  struct StateSnapshot {
    let current: BundleInfo
    let fallback: BundleInfo
    let staged: BundleInfo?
    let builtinVersion: String
  }

  struct DeviceEventPayload {
    let action: DeviceEventAction
    let bundleVersion: String?
    let runtimeVersion: String?
    let channel: String?
    let releaseId: String?
    let detail: String?
  }

  enum LatestManifestClassification {
    case noUpdate
    case alreadyStaged(BundleInfo)
    case updateAvailable
  }

  struct StartupPreparation {
    let activationPath: String?
    let trialBundleId: String?
    let cleanupBundleIds: [String]
    let eventPayload: DeviceEventPayload?
  }

  struct ApplyPreparation {
    let activationPath: String?
    let trialBundleId: String?
    let cleanupBundleIds: [String]

    var didApply: Bool {
      activationPath != nil
    }
  }

  struct NotifyReadyPreparation {
    let eventPayload: DeviceEventPayload?
    let cleanupBundleIds: [String]
  }

  struct RollbackPreparation {
    let didRollback: Bool
    let activationPath: String?
    let eventPayload: DeviceEventPayload?
    let cleanupBundleIds: [String]
  }

  private let store: BundleStore
  private let operationLock = NSLock()
  private let stateLock = NSLock()
  private var operationInProgress = false

  init(store: BundleStore) {
    self.store = store
  }

  var nativeBuild: String {
    store.nativeBuild
  }

  func bundleDirectory(for id: String) -> URL {
    store.bundleDirectory(for: id)
  }

  func tryBeginOperation() -> Bool {
    operationLock.lock()
    defer { operationLock.unlock() }
    if operationInProgress {
      return false
    }
    operationInProgress = true
    return true
  }

  func endOperation() {
    operationLock.lock()
    defer { operationLock.unlock() }
    operationInProgress = false
  }

  func snapshotState(
    isStagedBundleUsable: @escaping (BundleInfo) -> Bool
  ) -> StateSnapshot {
    withStateLock {
      let staged = readStagedBundleLocked(
        isCompatibleRuntime: nil,
        isUsable: isStagedBundleUsable
      )
      return StateSnapshot(
        current: store.getCurrentBundle(),
        fallback: store.getFallbackBundle(),
        staged: staged,
        builtinVersion: store.builtinVersion
      )
    }
  }

  func lastFailure() -> BundleInfo? {
    withStateLock {
      store.getLastFailedBundle()
    }
  }

  func pruneIncompatibleBundles(
    isCompatibleRuntime: @escaping (BundleInfo) -> Bool
  ) -> [String] {
    withStateLock {
      var cleanupBundleIds = Set<String>()

      for bundle in store.listDownloadedBundles() where !isCompatibleRuntime(bundle) {
        detachBundleReferencesLocked(bundleId: bundle.id)
        cleanupBundleIds.insert(bundle.id)
      }

      if let failed = store.getLastFailedBundle(),
         !isCompatibleRuntime(failed) {
        store.setLastFailedBundle(nil)
      }

      return Array(cleanupBundleIds)
    }
  }

  func normalizeStartupState(
    isBundleUsable: @escaping (BundleInfo) -> Bool
  ) -> StartupPreparation {
    withStateLock {
      var cleanupBundleIds = Set<String>()
      clearStaleBundlePointersLocked()
      normalizeStagedPointerLocked(
        isBundleUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      )
      normalizeFallbackPointerLocked(
        isBundleUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      )

      var eventPayload: DeviceEventPayload?
      let current = store.getCurrentBundle()
      if !current.isBuiltin,
         current.status == .trial {
        let rollback = rollbackLocked(
          reason: "app_restarted_before_notify",
          isBundleUsable: isBundleUsable,
          cleanupBundleIds: &cleanupBundleIds
        )
        eventPayload = rollback.eventPayload
      }

      var normalizedCurrent = store.getCurrentBundle()
      if !normalizedCurrent.isBuiltin,
         !isBundleUsable(normalizedCurrent) {
        cleanupBundleIds.insert(normalizedCurrent.id)
        normalizedCurrent = restoreFallbackOrBuiltinLocked(
          isBundleUsable: isBundleUsable,
          cleanupBundleIds: &cleanupBundleIds
        )
      }

      var trialBundleId: String?
      if !normalizedCurrent.isBuiltin,
         normalizedCurrent.status == .pending {
        normalizedCurrent = updateStatusLocked(normalizedCurrent, status: .trial)
        trialBundleId = normalizedCurrent.id
      }

      return StartupPreparation(
        activationPath: normalizedCurrent.isBuiltin ? nil : normalizedCurrent.path,
        trialBundleId: trialBundleId,
        cleanupBundleIds: Array(cleanupBundleIds),
        eventPayload: eventPayload
      )
    }
  }

  func isRuntimeUnresolved(currentRuntimeKey: String) -> Bool {
    withStateLock {
      store.getLastResolvedRuntimeKey() != currentRuntimeKey
    }
  }

  func resolveRuntimeKey(_ currentRuntimeKey: String) {
    withStateLock {
      store.setLastResolvedRuntimeKey(currentRuntimeKey)
    }
  }

  func classifyLatestManifest(
    _ manifest: LatestManifest,
    targetChannel: String?,
    isStagedBundleUsable: @escaping (BundleInfo) -> Bool
  ) -> LatestManifestClassification {
    withStateLock {
      let current = store.getCurrentBundle()
      if doesBundleMatchLatest(current, latest: manifest, targetChannel: targetChannel) {
        return .noUpdate
      }

      if let failed = store.getLastFailedBundle(),
         doesFailedBundleMatchLatest(failed, latest: manifest, targetChannel: targetChannel) {
        return .noUpdate
      }

      if let staged = readStagedBundleLocked(
        isCompatibleRuntime: { [self] bundle in
          self.trimToNil(bundle.runtimeVersion) == self.trimToNil(manifest.runtimeVersion)
        },
        isUsable: isStagedBundleUsable
      ),
         doesBundleMatchLatest(staged, latest: manifest, targetChannel: targetChannel) {
        return .alreadyStaged(staged)
      }

      return .updateAvailable
    }
  }

  func stageDownloadedBundle(_ bundle: BundleInfo) throws -> [String] {
    try withStateLock {
      var cleanupBundleIds = Set<String>()
      let previousStagedId = store.getStagedBundleId()
      try store.saveBundle(bundle)
      store.setStagedBundleId(bundle.id)

      if let previousStagedId,
         previousStagedId != bundle.id,
         previousStagedId != "builtin",
         previousStagedId != store.getCurrentBundleId(),
         previousStagedId != store.getFallbackBundleId() {
        cleanupBundleIds.insert(previousStagedId)
      }

      return Array(cleanupBundleIds)
    }
  }

  func prepareApplyStaged(
    isCompatibleRuntime: @escaping (BundleInfo) -> Bool,
    isBundleUsable: @escaping (BundleInfo) -> Bool
  ) -> ApplyPreparation {
    withStateLock {
      var cleanupBundleIds = Set<String>()
      guard var staged = stagedBundleLocked(
        cleanInvalid: true,
        isCompatibleRuntime: isCompatibleRuntime,
        isUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      ) else {
        return ApplyPreparation(
          activationPath: nil,
          trialBundleId: nil,
          cleanupBundleIds: Array(cleanupBundleIds)
        )
      }

      let previousCurrent = store.getCurrentBundle()
      if previousCurrent.isBuiltin {
        store.setFallbackBundleId(nil)
      } else {
        store.setFallbackBundleId(previousCurrent.id)
      }

      store.setCurrentBundleId(staged.id)
      store.setStagedBundleId(nil)

      var trialBundleId: String?
      if staged.status == .pending {
        staged = updateStatusLocked(staged, status: .trial)
        trialBundleId = staged.id
      } else if staged.status == .trial {
        trialBundleId = staged.id
      }

      return ApplyPreparation(
        activationPath: staged.path,
        trialBundleId: trialBundleId,
        cleanupBundleIds: Array(cleanupBundleIds)
      )
    }
  }

  func prepareNotifyAppReady() -> NotifyReadyPreparation {
    withStateLock {
      let current = store.getCurrentBundle()
      guard !current.isBuiltin,
            current.status == .trial else {
        return NotifyReadyPreparation(eventPayload: nil, cleanupBundleIds: [])
      }

      let oldFallbackId = store.getFallbackBundleId()
      _ = updateStatusLocked(current, status: .success)
      store.setFallbackBundleId(current.id)

      var cleanupBundleIds = Set<String>()
      if let oldFallbackId,
         oldFallbackId != current.id {
        cleanupBundleIds.insert(oldFallbackId)
      }

      return NotifyReadyPreparation(
        eventPayload: DeviceEventPayload(
          action: .applied,
          bundleVersion: current.version,
          runtimeVersion: current.runtimeVersion,
          channel: current.channel,
          releaseId: current.releaseId,
          detail: nil
        ),
        cleanupBundleIds: Array(cleanupBundleIds)
      )
    }
  }

  func prepareRollback(
    reason: String,
    isBundleUsable: @escaping (BundleInfo) -> Bool
  ) -> RollbackPreparation {
    withStateLock {
      var cleanupBundleIds = Set<String>()
      let rollback = rollbackLocked(
        reason: reason,
        isBundleUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      )
      return RollbackPreparation(
        didRollback: rollback.didRollback,
        activationPath: rollback.activationPath,
        eventPayload: rollback.eventPayload,
        cleanupBundleIds: Array(cleanupBundleIds)
      )
    }
  }

  func isCurrentTrialBundle(_ bundleId: String) -> Bool {
    withStateLock {
      let current = store.getCurrentBundle()
      return current.id == bundleId && current.status == .trial
    }
  }

  func cleanupBundles(_ bundleIds: [String]) {
    let uniqueIds = Set(bundleIds).filter { !$0.isEmpty && $0 != "builtin" }
    for bundleId in uniqueIds {
      try? FileManager.default.removeItem(at: store.bundleDirectory(for: bundleId))
    }
  }

  private struct LockedRollbackResult {
    let didRollback: Bool
    let activationPath: String?
    let eventPayload: DeviceEventPayload?
  }

  private func withStateLock<T>(_ work: () throws -> T) rethrows -> T {
    stateLock.lock()
    defer { stateLock.unlock() }
    return try work()
  }

  private func clearStaleBundlePointersLocked() {
    if let currentId = store.getCurrentBundleId(),
       store.getBundle(id: currentId) == nil {
      store.setCurrentBundleId(nil)
    }

    if let fallbackId = store.getFallbackBundleId(),
       store.getBundle(id: fallbackId) == nil {
      store.setFallbackBundleId(nil)
    }

    if let stagedId = store.getStagedBundleId(),
       store.getBundle(id: stagedId) == nil {
      store.setStagedBundleId(nil)
    }
  }

  private func normalizeFallbackPointerLocked(
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) {
    guard let fallbackId = store.getFallbackBundleId(),
          let fallback = store.getBundle(id: fallbackId) else {
      return
    }

    guard !fallback.isBuiltin else {
      return
    }

    if !isBundleUsable(fallback) {
      store.setFallbackBundleId(nil)
      cleanupBundleIds.insert(fallback.id)
    }
  }

  private func normalizeStagedPointerLocked(
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) {
    guard let stagedId = store.getStagedBundleId() else {
      return
    }

    guard let staged = store.getBundle(id: stagedId) else {
      store.setStagedBundleId(nil)
      return
    }

    if !isBundleUsable(staged) {
      store.setStagedBundleId(nil)
      cleanupBundleIds.insert(staged.id)
    }
  }

  private func readStagedBundleLocked(
    isCompatibleRuntime: ((BundleInfo) -> Bool)?,
    isUsable: (BundleInfo) -> Bool
  ) -> BundleInfo? {
    var ignored = Set<String>()
    return stagedBundleLocked(
      cleanInvalid: false,
      isCompatibleRuntime: isCompatibleRuntime,
      isUsable: isUsable,
      cleanupBundleIds: &ignored
    )
  }

  private func stagedBundleLocked(
    cleanInvalid: Bool,
    isCompatibleRuntime: ((BundleInfo) -> Bool)?,
    isUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) -> BundleInfo? {
    guard let stagedId = store.getStagedBundleId() else {
      return nil
    }

    guard let staged = store.getBundle(id: stagedId) else {
      if cleanInvalid {
        store.setStagedBundleId(nil)
      }
      return nil
    }

    if let isCompatibleRuntime,
       !isCompatibleRuntime(staged) {
      if cleanInvalid {
        store.setStagedBundleId(nil)
        cleanupBundleIds.insert(staged.id)
      }
      return nil
    }

    if !isUsable(staged) {
      if cleanInvalid {
        store.setStagedBundleId(nil)
        cleanupBundleIds.insert(staged.id)
      }
      return nil
    }

    return staged
  }

  private func detachBundleReferencesLocked(bundleId: String) {
    if store.getCurrentBundleId() == bundleId {
      store.setCurrentBundleId(nil)
    }
    if store.getFallbackBundleId() == bundleId {
      store.setFallbackBundleId(nil)
    }
    if store.getStagedBundleId() == bundleId {
      store.setStagedBundleId(nil)
    }
  }

  private func rollbackLocked(
    reason: String,
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) -> LockedRollbackResult {
    let current = store.getCurrentBundle()
    guard !current.isBuiltin else {
      return LockedRollbackResult(
        didRollback: false,
        activationPath: nil,
        eventPayload: nil
      )
    }

    let failed = updateStatusLocked(current, status: .error)
    store.setLastFailedBundle(failed)
    store.setStagedBundleId(nil)

    let fallback = restoreFallbackOrBuiltinLocked(
      isBundleUsable: isBundleUsable,
      cleanupBundleIds: &cleanupBundleIds
    )
    cleanupBundleIds.insert(current.id)

    return LockedRollbackResult(
      didRollback: true,
      activationPath: fallback.isBuiltin ? nil : fallback.path,
      eventPayload: DeviceEventPayload(
        action: .rollback,
        bundleVersion: current.version,
        runtimeVersion: current.runtimeVersion,
        channel: current.channel,
        releaseId: current.releaseId,
        detail: reason
      )
    )
  }

  private func restoreFallbackOrBuiltinLocked(
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) -> BundleInfo {
    if let fallbackId = store.getFallbackBundleId(),
       let fallback = store.getBundle(id: fallbackId),
       !fallback.isBuiltin,
       isBundleUsable(fallback) {
      store.setCurrentBundleId(fallback.id)
      return fallback
    }

    if let fallbackId = store.getFallbackBundleId() {
      store.setFallbackBundleId(nil)
      if fallbackId != "builtin" {
        cleanupBundleIds.insert(fallbackId)
      }
    }

    store.setCurrentBundleId(nil)
    return store.builtinBundle()
  }

  private func updateStatusLocked(
    _ bundle: BundleInfo,
    status: BundleStatus
  ) -> BundleInfo {
    let updated = BundleInfo(
      id: bundle.id,
      version: bundle.version,
      runtimeVersion: bundle.runtimeVersion,
      status: status,
      downloadedAt: bundle.downloadedAt,
      sha256: bundle.sha256,
      path: bundle.path,
      channel: bundle.channel,
      releaseId: bundle.releaseId
    )
    try? store.saveBundle(updated)
    return updated
  }

  private func doesFailedBundleMatchLatest(
    _ failed: BundleInfo,
    latest: LatestManifest,
    targetChannel: String?
  ) -> Bool {
    if trimToNil(failed.channel) != targetChannel {
      return false
    }

    if trimToNil(failed.runtimeVersion) != trimToNil(latest.runtimeVersion) {
      return false
    }

    if let failedReleaseId = trimToNil(failed.releaseId),
       let latestReleaseId = trimToNil(latest.releaseId),
       latestReleaseId == failedReleaseId {
      return true
    }

    if let failedSha = trimToNil(failed.sha256),
       let latestSha = trimToNil(latest.sha256),
       latestSha == failedSha {
      return true
    }

    return false
  }

  private func doesBundleMatchLatest(
    _ bundle: BundleInfo,
    latest: LatestManifest,
    targetChannel: String?
  ) -> Bool {
    if trimToNil(bundle.channel) != targetChannel {
      return false
    }

    if trimToNil(bundle.runtimeVersion) != trimToNil(latest.runtimeVersion) {
      return false
    }

    if let bundleReleaseId = trimToNil(bundle.releaseId),
       let latestReleaseId = trimToNil(latest.releaseId),
       latestReleaseId == bundleReleaseId {
      return true
    }

    if let bundleSha = trimToNil(bundle.sha256),
       let latestSha = trimToNil(latest.sha256),
       latestSha == bundleSha {
      return true
    }

    if trimToNil(bundle.releaseId) != nil ||
        trimToNil(latest.releaseId) != nil ||
        trimToNil(bundle.sha256) != nil ||
        trimToNil(latest.sha256) != nil {
      return false
    }

    return latest.version == bundle.version
  }

  private func trimToNil(_ value: String?) -> String? {
    guard let value else {
      return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}
