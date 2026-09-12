import Darwin
import Foundation

public struct Artifact: Codable, Equatable {
  public let appId: String
  public let platform: String
  public let runtimeVersion: String
  public let contentHash: String
  public let version: String
  public let releaseId: String?
  public let channel: String?
  public let bundlePath: String
  public let embedded: Bool

  public init(
    appId: String, platform: String, runtimeVersion: String, contentHash: String,
    version: String, releaseId: String? = nil, channel: String? = nil, bundlePath: String,
    embedded: Bool = false
  ) {
    self.appId = appId
    self.platform = platform
    self.runtimeVersion = runtimeVersion
    self.contentHash = contentHash
    self.version = version
    self.releaseId = releaseId
    self.channel = channel
    self.bundlePath = bundlePath
    self.embedded = embedded
  }
}

public struct TrialEvent: Codable, Equatable {
  public let id: String
  public let type: String
  public let artifact: Artifact
  public var createdAt: TimeInterval? = Date().timeIntervalSince1970
  public var detail: String? = nil
}

public struct LaunchSnapshot: Codable {
  public var schemaVersion = 1
  public var buildId: String
  public var generation: UInt64 = 0
  public var current: Artifact
  public var lastGood: Artifact
  public var previousGood: Artifact?
  public var staged: Artifact?
  public var trialGeneration: UInt64?
  public var failed: Set<String> = []
  public var events: [TrialEvent] = []
  public var droppedEvents: Int?
  public var lastEventError: String?
}

extension LaunchSnapshot {
  public init(from decoder: Decoder) throws {
    let fields = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      buildId: try fields.decode(String.self, forKey: .buildId),
      current: try fields.decode(Artifact.self, forKey: .current),
      lastGood: try fields.decode(Artifact.self, forKey: .lastGood))
    schemaVersion = try fields.decode(Int.self, forKey: .schemaVersion)
    generation = try fields.decode(UInt64.self, forKey: .generation)
    previousGood = try fields.decodeIfPresent(Artifact.self, forKey: .previousGood)
    staged = try fields.decodeIfPresent(Artifact.self, forKey: .staged)
    trialGeneration = try fields.decodeIfPresent(UInt64.self, forKey: .trialGeneration)
    failed = try fields.decode(Set<String>.self, forKey: .failed)
    droppedEvents = try? fields.decodeIfPresent(Int.self, forKey: .droppedEvents)
    lastEventError = try? fields.decodeIfPresent(String.self, forKey: .lastEventError)
    // A malformed telemetry entry must not discard otherwise valid launch/recovery pointers.
    var invalid = 0
    if var outbox = try? fields.nestedUnkeyedContainer(forKey: .events) {
      while !outbox.isAtEnd {
        let item = try outbox.superDecoder()
        if let event = try? TrialEvent(from: item) { events.append(event) } else { invalid += 1 }
      }
    } else {
      invalid = 1
    }
    if invalid > 0 {
      droppedEvents = max(0, droppedEvents ?? 0) + invalid
      lastEventError = "Invalid saved event payload"
    }
  }
}

public enum LaunchError: Error {
  case incompatibleArtifact, quarantined, activationDeferred, staleInstance, storageUnavailable,
    corruptState
}

/// One application-lifetime owner. Module bindings capture a generation; they never own this store.
public final class LaunchStore {
  private let queue = DispatchQueue(label: "com.otakit.rn.launch-store")
  private let file: URL
  private let builtin: Artifact
  private var snapshot: LaunchSnapshot
  private var bootstrapGeneration: UInt64?
  private var hostGeneration: UInt64?
  private var didBeginLaunch = false
  private var storageFailed = false
  private var foreground = false
  private var guardActive = false
  private var backgroundWorkObserved = false
  private var trialElapsed: TimeInterval = 0
  private var foregroundSince: TimeInterval?
  private let readyTimeout: TimeInterval

  public init(
    file: URL, buildId: String, builtin: Artifact, readyTimeout: TimeInterval = 10,
    validateCachedArtifact: ((Artifact) throws -> Bool)? = nil
  ) throws {
    self.file = file
    self.builtin = builtin
    self.readyTimeout = readyTimeout
    let initial = LaunchSnapshot(buildId: buildId, current: builtin, lastGood: builtin)
    do {
      let data = try Data(contentsOf: file)
      let stored = try JSONDecoder().decode(LaunchSnapshot.self, from: data)
      if stored.schemaVersion == 1 && stored.generation < UInt64.max - 1
        && stored.buildId == buildId && Self.compatible(stored.current, builtin)
        && Self.compatible(stored.lastGood, builtin)
      {
        snapshot = stored
      } else {
        snapshot = initial
      }
    } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
      snapshot = initial
    } catch let error as CocoaError where error.code == .fileReadNoPermission {
      throw LaunchError.storageUnavailable
    } catch is DecodingError { snapshot = initial } catch { throw LaunchError.storageUnavailable }
    // A prior process died before readiness. Resolve once before selecting any code.
    if snapshot.trialGeneration != nil {
      var recovered = snapshot
      Self.failTrial(&recovered)
      try persist(recovered)
    }
    if let validate = validateCachedArtifact {
      var checked = snapshot
      if !(try validate(checked.lastGood)) { checked.lastGood = builtin }
      if !(try validate(checked.current)) { checked.current = checked.lastGood }
      if let staged = checked.staged, !(try validate(staged)) { checked.staged = nil }
      if let previous = checked.previousGood, !(try validate(previous)) {
        checked.previousGood = nil
      }
      // A verified embedded identity always uses the resource path of this installed binary.
      if checked.current.embedded {
        checked.current = Self.relocateEmbedded(checked.current, builtin)
      }
      if checked.lastGood.embedded {
        checked.lastGood = Self.relocateEmbedded(checked.lastGood, builtin)
      }
      if let staged = checked.staged, staged.embedded {
        checked.staged = Self.relocateEmbedded(staged, builtin)
      }
      try persist(checked)
    }
  }

  public func state() -> LaunchSnapshot { queue.sync { snapshot } }

  public func stage(_ artifact: Artifact, from generation: UInt64? = nil, downloaded: Bool = false)
    throws
  {
    try queue.sync {
      if let generation = generation {
        guard generation == snapshot.generation && bootstrapGeneration == generation else {
          throw LaunchError.staleInstance
        }
      }
      guard Self.compatible(artifact, builtin) else { throw LaunchError.incompatibleArtifact }
      guard !snapshot.failed.contains(artifact.contentHash) else { throw LaunchError.quarantined }
      var next = snapshot
      if artifact.contentHash == next.current.contentHash {
        // Association changes never confirm or reattribute an executing trial.
        guard next.trialGeneration == nil else { return }
        next.current = artifact
        Self.confirm(artifact, in: &next)
        next.staged = nil
        try persist(next)
        return
      }
      next.staged = artifact
      if downloaded {
        next.events.append(
          TrialEvent(id: UUID().uuidString, type: "downloaded", artifact: artifact))
      }
      try persist(next)
    }
  }

  /// Cold startup calls once immediately before handing a loader to RN; URL callbacks only read state().
  public func beginLaunch(foreground: Bool, activateStaged: Bool, now: TimeInterval) throws
    -> UInt64
  {
    try queue.sync {
      if didBeginLaunch { return snapshot.generation }
      self.foreground = foreground
      if !foreground { backgroundWorkObserved = true }
      let generation = try select(
        activateStaged: foreground && !guardActive && activateStaged, now: now)
      didBeginLaunch = true
      return generation
    }
  }

  public func bindBootstrap(generation: UInt64) throws {
    try queue.sync {
      guard generation == snapshot.generation else { throw LaunchError.staleInstance }
      bootstrapGeneration = generation
    }
  }

  public func assertInstance(_ generation: UInt64) throws {
    try queue.sync {
      guard generation == snapshot.generation && bootstrapGeneration == generation else {
        throw LaunchError.staleInstance
      }
    }
  }

  public func hostReady(generation: UInt64) {
    queue.sync { if generation == snapshot.generation { hostGeneration = generation } }
  }

  public func setForeground(_ value: Bool, now: TimeInterval) {
    queue.sync {
      accountTime(now)
      foreground = value
      foregroundSince = value && snapshot.trialGeneration != nil ? now : nil
    }
  }

  public func setActivationGuard(_ value: Bool, from generation: UInt64? = nil) {
    queue.sync {
      if let generation = generation,
        generation != snapshot.generation || bootstrapGeneration != generation
      {
        return
      }
      guardActive = value
    }
  }

  public func observeBackgroundWork(from generation: UInt64) {
    queue.sync {
      if generation == snapshot.generation { backgroundWorkObserved = true }
    }
  }

  public func apply(from generation: UInt64, now: TimeInterval) throws -> UInt64 {
    try queue.sync {
      guard generation == snapshot.generation && bootstrapGeneration == generation else {
        throw LaunchError.staleInstance
      }
      guard
        foreground && !guardActive && !backgroundWorkObserved && hostGeneration == generation
          && snapshot.trialGeneration == nil
      else { throw LaunchError.activationDeferred }
      guard snapshot.staged != nil else { return generation }
      return try select(activateStaged: true, now: now)
    }
  }

  public func notifyReady(from generation: UInt64) throws {
    try queue.sync {
      guard generation == snapshot.generation && bootstrapGeneration == generation else {
        throw LaunchError.staleInstance
      }
      guard snapshot.trialGeneration == generation else { return }
      var next = snapshot
      Self.confirm(next.current, in: &next)
      next.trialGeneration = nil
      next.events.append(TrialEvent(id: UUID().uuidString, type: "applied", artifact: next.current))
      try persist(next)
      foregroundSince = nil
      trialElapsed = 0
    }
  }

  public func checkTimeout(now: TimeInterval) throws -> Bool {
    try queue.sync {
      accountTime(now)
      guard snapshot.trialGeneration != nil && trialElapsed >= readyTimeout else { return false }
      return try failCurrent()
    }
  }

  public func fail(from generation: UInt64) throws -> Bool {
    try queue.sync {
      guard generation == snapshot.trialGeneration else { return false }
      return try failCurrent()
    }
  }

  public func acknowledgeEvents(_ ids: Set<String>) throws {
    try queue.sync {
      var next = snapshot
      next.events.removeAll { ids.contains($0.id) }
      try persist(next)
    }
  }

  public func recordDownloadFailure(_ artifact: Artifact, detail: String) throws {
    try queue.sync {
      guard Self.compatible(artifact, builtin), artifact.releaseId != nil else { return }
      var next = snapshot
      var event = TrialEvent(id: UUID().uuidString, type: "download_error", artifact: artifact)
      event.detail = String(detail.prefix(500))
      next.events.append(event)
      try persist(next)
    }
  }

  public func eventForDelivery() throws -> TrialEvent? {
    try queue.sync {
      var next = snapshot
      Self.trimEvents(&next)
      let changed = next.events.count != snapshot.events.count
      let needsTimestamp = next.events.first != nil && next.events[0].createdAt == nil
      if needsTimestamp { next.events[0].createdAt = Date().timeIntervalSince1970 }
      if changed || needsTimestamp { try persist(next) }
      return snapshot.events.first
    }
  }

  public func discardEvent(_ id: String, reason: String) throws {
    try queue.sync {
      guard snapshot.events.contains(where: { $0.id == id }) else { return }
      var next = snapshot
      next.events.removeAll { $0.id == id }
      next.droppedEvents = (next.droppedEvents ?? 0) + 1
      next.lastEventError = String(reason.prefix(500))
      try persist(next)
    }
  }

  private static func trimEvents(_ state: inout LaunchSnapshot) {
    let count = state.events.count
    let now = Date().timeIntervalSince1970
    state.events.removeAll { $0.createdAt.map { now - $0 > 86400 } ?? false }
    if state.events.count > 256 { state.events.removeFirst(state.events.count - 256) }
    if state.events.count != count {
      state.droppedEvents = (state.droppedEvents ?? 0) + count - state.events.count
      state.lastEventError = "Event retention limit exceeded"
    }
  }

  private func select(activateStaged: Bool, now: TimeInterval) throws -> UInt64 {
    var next = snapshot
    // No second launch may erase an unresolved trial.
    if next.trialGeneration != nil { Self.failTrial(&next) }
    next.generation += 1
    if activateStaged, let staged = next.staged {
      guard Self.compatible(staged, builtin) else { throw LaunchError.incompatibleArtifact }
      guard !next.failed.contains(staged.contentHash) else { throw LaunchError.quarantined }
      next.current = staged
      next.staged = nil
      // Switching back to embedded code still needs readiness from the new instance.
      if staged.contentHash != next.lastGood.contentHash {
        next.trialGeneration = next.generation
      } else {
        Self.confirm(staged, in: &next)
      }
    } else {
      next.current = next.lastGood
    }
    try persist(next)
    bootstrapGeneration = nil
    hostGeneration = nil
    trialElapsed = 0
    guardActive = false
    foregroundSince = foreground && next.trialGeneration != nil ? now : nil
    return next.generation
  }

  private func accountTime(_ now: TimeInterval) {
    if let since = foregroundSince {
      trialElapsed += max(0, now - since)
      foregroundSince = now
    }
  }

  private func failCurrent() throws -> Bool {
    var next = snapshot
    Self.failTrial(&next)
    next.generation += 1
    try persist(next)
    bootstrapGeneration = nil
    hostGeneration = nil
    foregroundSince = nil
    guardActive = false
    return true
  }

  private static func failTrial(_ state: inout LaunchSnapshot) {
    guard state.trialGeneration != nil else { return }
    state.failed.insert(state.current.contentHash)
    state.events.append(
      TrialEvent(id: UUID().uuidString, type: "rollback", artifact: state.current))
    state.current = state.lastGood
    state.trialGeneration = nil
  }

  private static func confirm(_ artifact: Artifact, in state: inout LaunchSnapshot) {
    if state.lastGood.contentHash != artifact.contentHash && !state.lastGood.embedded {
      state.previousGood = state.lastGood
    }
    state.lastGood = artifact
  }

  private static func compatible(_ artifact: Artifact, _ builtin: Artifact) -> Bool {
    artifact.appId == builtin.appId && artifact.platform == builtin.platform
      && artifact.runtimeVersion == builtin.runtimeVersion
  }

  private static func relocateEmbedded(_ artifact: Artifact, _ builtin: Artifact) -> Artifact {
    Artifact(
      appId: builtin.appId, platform: builtin.platform, runtimeVersion: builtin.runtimeVersion,
      contentHash: builtin.contentHash, version: artifact.version, releaseId: artifact.releaseId,
      channel: artifact.channel, bundlePath: builtin.bundlePath, embedded: true)
  }

  private func persist(_ next: LaunchSnapshot) throws {
    var next = next
    Self.trimEvents(&next)
    guard !storageFailed else { throw LaunchError.storageUnavailable }
    // Any failed write can have an uncertain durable outcome. Stop this owner until cold recovery.
    storageFailed = true
    let directory = file.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp")
    defer { try? FileManager.default.removeItem(at: temporary) }
    let data = try JSONEncoder().encode(next)
    try data.write(to: temporary, options: [.withoutOverwriting])
    let fd = Darwin.open(temporary.path, O_RDONLY)
    guard fd >= 0 else { throw LaunchError.storageUnavailable }
    let synced = fsync(fd)
    close(fd)
    guard synced == 0 && rename(temporary.path, file.path) == 0 else {
      throw LaunchError.storageUnavailable
    }
    let dirfd = Darwin.open(directory.path, O_RDONLY)
    guard dirfd >= 0 else { throw LaunchError.storageUnavailable }
    let dirSynced = fsync(dirfd)
    close(dirfd)
    guard dirSynced == 0 else { throw LaunchError.storageUnavailable }
    snapshot = next
    storageFailed = false
  }
}
