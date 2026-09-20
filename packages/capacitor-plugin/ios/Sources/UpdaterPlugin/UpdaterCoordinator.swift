import Foundation

final class UpdaterCoordinator {
  struct Trial: Equatable {
    let bundleId: String
    let activationId = UUID().uuidString
  }

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
    var attemptId: String? = nil
    var phase: String? = nil
  }

  enum LatestManifestClassification {
    case noUpdate
    case alreadyStaged(BundleInfo)
    case updateAvailable
  }

  struct StartupPreparation {
    let activationPath: String?
    let trial: Trial?
    let cleanupBundleIds: [String]
    let eventPayload: DeviceEventPayload?
  }

  struct ApplyPreparation {
    let activationPath: String?
    let trial: Trial?
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
  private var activeTrial: Trial?

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
  ) throws -> [String] {
    try withStateLock {
      _ = try store.protectedBundleIds()
      var cleanupBundleIds = Set<String>()

      for bundle in store.listDownloadedBundles() where !isCompatibleRuntime(bundle) {
        try detachBundleReferencesLocked(bundleId: bundle.id)
        cleanupBundleIds.insert(bundle.id)
      }

      if let failed = store.getLastFailedBundle(),
         !isCompatibleRuntime(failed) {
        try store.setLastFailedBundle(nil)
      }

      return Array(cleanupBundleIds)
    }
  }

  func normalizeStartupState(
    isBundleUsable: @escaping (BundleInfo) -> Bool
  ) throws -> StartupPreparation {
    try withStateLock {
      _ = try store.protectedBundleIds()
      activeTrial = nil
      var cleanupBundleIds = Set<String>()
      try clearStaleBundlePointersLocked()
      try normalizeStagedPointerLocked(
        isBundleUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      )
      try normalizeFallbackPointerLocked(
        isBundleUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      )

      var eventPayload: DeviceEventPayload?
      let current = store.getCurrentBundle()
      if !current.isBuiltin,
         current.status == .trial {
        let rollback = try rollbackLocked(
          reason: "app_restarted_before_notify",
          isBundleUsable: isBundleUsable,
          cleanupBundleIds: &cleanupBundleIds
        )
        eventPayload = rollback.eventPayload
      }

      var normalizedCurrent = store.getCurrentBundle()
      if !normalizedCurrent.isBuiltin,
         normalizedCurrent.status == .error || !isBundleUsable(normalizedCurrent) {
        cleanupBundleIds.insert(normalizedCurrent.id)
        normalizedCurrent = try restoreFallbackOrBuiltinLocked(
          isBundleUsable: isBundleUsable,
          cleanupBundleIds: &cleanupBundleIds,
          excluding: normalizedCurrent.id
        )
      }

      var trial: Trial?
      if !normalizedCurrent.isBuiltin,
         normalizedCurrent.status == .pending {
        normalizedCurrent = try updateStatusLocked(normalizedCurrent, status: .trial)
        trial = beginTrialLocked(bundleId: normalizedCurrent.id)
      }

      return StartupPreparation(
        activationPath: normalizedCurrent.isBuiltin ? nil : normalizedCurrent.path,
        trial: trial,
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
      guard !bundle.isBuiltin, !(try store.protectedBundleIds()).contains(bundle.id) else {
        throw NSError(domain: "OtaKit", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "Cannot overwrite a referenced bundle installation"
        ])
      }
      var cleanupBundleIds = Set<String>()
      let previousStagedId = store.getStagedBundleId()
      try store.saveBundle(bundle)
      try store.setStagedBundleId(bundle.id)

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
  ) throws -> ApplyPreparation {
    try withStateLock {
      var cleanupBundleIds = Set<String>()
      let previousCurrent = store.getCurrentBundle()
      // Keep the staged update until the running trial has a definite outcome.
      guard previousCurrent.status != .trial else {
        return ApplyPreparation(activationPath: nil, trial: nil, cleanupBundleIds: [])
      }
      guard var staged = try stagedBundleLocked(
        cleanInvalid: true,
        isCompatibleRuntime: isCompatibleRuntime,
        isUsable: isBundleUsable,
        cleanupBundleIds: &cleanupBundleIds
      ) else {
        return ApplyPreparation(
          activationPath: nil,
          trial: nil,
          cleanupBundleIds: Array(cleanupBundleIds)
        )
      }

      let fallbackId = previousCurrent.isBuiltin ? nil :
        (previousCurrent.status == .success ? previousCurrent.id : store.getFallbackBundleId())
      if staged.status == .pending {
        staged = try updateStatusLocked(staged, status: .trial)
      }
      // Persist trial metadata before publishing the pointer; keep all pointers in one write.
      try store.setCoreState(
        currentId: staged.id, fallbackId: fallbackId, stagedId: nil,
        lastFailed: store.getLastFailedBundle()
      )
      let trial = staged.status == .trial ? beginTrialLocked(bundleId: staged.id) : nil

      return ApplyPreparation(
        activationPath: staged.path,
        trial: trial,
        cleanupBundleIds: Array(cleanupBundleIds)
      )
    }
  }

  func prepareNotifyAppReady(activationId: String?) throws -> NotifyReadyPreparation {
    try withStateLock {
      let current = store.getCurrentBundle()
      guard !current.isBuiltin,
            activeTrial?.bundleId == current.id,
            let activationId, activeTrial?.activationId == activationId,
            current.status == .trial ||
              (current.status == .success && store.getFallbackBundleId() != current.id) else {
        return NotifyReadyPreparation(eventPayload: nil, cleanupBundleIds: [])
      }

      let oldFallbackId = store.getFallbackBundleId()
      if current.status == .trial {
        _ = try updateStatusLocked(current, status: .success)
      }
      try store.setFallbackBundleId(current.id)
      activeTrial = nil

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
          detail: nil,
          attemptId: current.attemptId,
          phase: "readiness"
        ),
        cleanupBundleIds: Array(cleanupBundleIds)
      )
    }
  }

  func prepareRollback(
    expectedTrial: Trial,
    reason: String,
    isBundleUsable: @escaping (BundleInfo) -> Bool
  ) throws -> RollbackPreparation {
    try withStateLock {
      let current = store.getCurrentBundle()
      guard activeTrial == expectedTrial,
            current.id == expectedTrial.bundleId,
            current.status == .trial else {
        return RollbackPreparation(
          didRollback: false, activationPath: nil, eventPayload: nil, cleanupBundleIds: []
        )
      }
      var cleanupBundleIds = Set<String>()
      let rollback = try rollbackLocked(
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

  private func beginTrialLocked(bundleId: String) -> Trial {
    let trial = Trial(bundleId: bundleId)
    activeTrial = trial
    return trial
  }

  func cleanupBundles(_ bundleIds: [String]) {
    withStateLock {
      // An unreadable state is not evidence that these files are unreferenced.
      guard let protectedIds = try? store.protectedBundleIds() else { return }
      let uniqueIds = Set(bundleIds).filter { !$0.isEmpty && $0 != "builtin" }
      for bundleId in uniqueIds {
        // A later transition may have made an earlier cleanup candidate live again.
        guard !protectedIds.contains(bundleId) else { continue }
        try? FileManager.default.removeItem(at: store.bundleDirectory(for: bundleId))
      }
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

  private func clearStaleBundlePointersLocked() throws {
    if let currentId = store.getCurrentBundleId(),
       store.getBundle(id: currentId) == nil {
      try store.setCurrentBundleId(nil)
    }

    if let fallbackId = store.getFallbackBundleId(),
       store.getBundle(id: fallbackId) == nil {
      try store.setFallbackBundleId(nil)
    }

    if let stagedId = store.getStagedBundleId(),
       store.getBundle(id: stagedId) == nil {
      try store.setStagedBundleId(nil)
    }
  }

  private func normalizeFallbackPointerLocked(
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) throws {
    guard let fallbackId = store.getFallbackBundleId(),
          let fallback = store.getBundle(id: fallbackId) else {
      return
    }

    guard !fallback.isBuiltin else {
      return
    }

    if fallback.status != .success || !isBundleUsable(fallback) {
      try store.setFallbackBundleId(nil)
      cleanupBundleIds.insert(fallback.id)
    }
  }

  private func normalizeStagedPointerLocked(
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) throws {
    guard let stagedId = store.getStagedBundleId() else {
      return
    }

    guard let staged = store.getBundle(id: stagedId) else {
      try store.setStagedBundleId(nil)
      return
    }

    if !isBundleUsable(staged) {
      try store.setStagedBundleId(nil)
      cleanupBundleIds.insert(staged.id)
    }
  }

  private func readStagedBundleLocked(
    isCompatibleRuntime: ((BundleInfo) -> Bool)?,
    isUsable: (BundleInfo) -> Bool
  ) -> BundleInfo? {
    var ignored = Set<String>()
    return try? stagedBundleLocked(
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
  ) throws -> BundleInfo? {
    guard let stagedId = store.getStagedBundleId() else {
      return nil
    }

    guard let staged = store.getBundle(id: stagedId) else {
      if cleanInvalid {
        try store.setStagedBundleId(nil)
      }
      return nil
    }

    if let isCompatibleRuntime,
       !isCompatibleRuntime(staged) {
      if cleanInvalid {
        try store.setStagedBundleId(nil)
        cleanupBundleIds.insert(staged.id)
      }
      return nil
    }

    if !isUsable(staged) {
      if cleanInvalid {
        try store.setStagedBundleId(nil)
        cleanupBundleIds.insert(staged.id)
      }
      return nil
    }

    return staged
  }

  private func detachBundleReferencesLocked(bundleId: String) throws {
    if store.getCurrentBundleId() == bundleId {
      try store.setCurrentBundleId(nil)
    }
    if store.getFallbackBundleId() == bundleId {
      try store.setFallbackBundleId(nil)
    }
    if store.getStagedBundleId() == bundleId {
      try store.setStagedBundleId(nil)
    }
  }

  private func rollbackLocked(
    reason: String,
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>
  ) throws -> LockedRollbackResult {
    let current = store.getCurrentBundle()
    guard !current.isBuiltin else {
      return LockedRollbackResult(
        didRollback: false,
        activationPath: nil,
        eventPayload: nil
      )
    }

    let failed = current.withStatus(.error)
    let fallback = try restoreFallbackOrBuiltinLocked(
      isBundleUsable: isBundleUsable,
      cleanupBundleIds: &cleanupBundleIds,
      excluding: current.id,
      failedBundle: failed
    )
    activeTrial = nil
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
        detail: reason,
        attemptId: current.attemptId,
        phase: "rollback"
      )
    )
  }

  private func restoreFallbackOrBuiltinLocked(
    isBundleUsable: (BundleInfo) -> Bool,
    cleanupBundleIds: inout Set<String>,
    excluding excludedBundleId: String,
    failedBundle: BundleInfo? = nil
  ) throws -> BundleInfo {
    var restored = store.builtinBundle()
    if let fallbackId = store.getFallbackBundleId(),
       let fallback = store.getBundle(id: fallbackId),
       !fallback.isBuiltin,
       fallback.id != excludedBundleId,
       fallback.status == .success,
       isBundleUsable(fallback) {
      restored = fallback
    }

    if let fallbackId = store.getFallbackBundleId(),
       fallbackId != "builtin", fallbackId != restored.id {
      cleanupBundleIds.insert(fallbackId)
    }
    let restoredId = restored.isBuiltin ? nil : restored.id
    try store.setCoreState(
      currentId: restoredId, fallbackId: restoredId,
      stagedId: failedBundle == nil ? store.getStagedBundleId() : nil,
      lastFailed: failedBundle ?? store.getLastFailedBundle()
    )
    return restored
  }

  private func updateStatusLocked(
    _ bundle: BundleInfo,
    status: BundleStatus
  ) throws -> BundleInfo {
    let updated = bundle.withStatus(status)
    try store.saveBundle(updated)
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
