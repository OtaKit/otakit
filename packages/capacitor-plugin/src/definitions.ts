import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Bundle status enum.
 */
export enum BundleStatus {
  /** Factory-installed bundle */
  BUILTIN = 'builtin',
  /** Downloaded and staged, awaiting activation */
  PENDING = 'pending',
  /** Active but not yet confirmed */
  TRIAL = 'trial',
  /** Confirmed working */
  SUCCESS = 'success',
  /** Failed (hash mismatch, extraction error, rollback) */
  ERROR = 'error',
}

export interface BundleInfo {
  /** Opaque local installation identifier. Separate downloads can have different IDs for the same release. */
  id: string;
  /** Semantic version string */
  version: string;
  /** Native compatibility lane for this bundle. */
  runtimeVersion?: string;
  /** Current status of the bundle */
  status: BundleStatus;
  /** ISO timestamp when bundle was downloaded */
  downloadedAt?: string;
  /** SHA-256 hash of the bundle */
  sha256?: string;
  /** Channel this bundle was released to (if known) */
  channel?: string;
  /** Release history ID associated with this bundle (if known) */
  releaseId?: string;
  /** Release notes delivered with this bundle (plugin 3.3+). Plain text: render it as text. */
  notes?: string;
}

/** Release notes the app has not shown yet (plugin 3.3+). */
export interface ReleaseNotes {
  /** Plain text with line breaks. Render it as text, never as HTML. */
  text: string;
  /** Version of the running bundle. */
  version: string;
  /** Release the notes belong to. */
  releaseId: string;
}

export interface LatestVersion {
  /** Version string */
  version: string;
  /** Native compatibility lane for this update. */
  runtimeVersion?: string;
  /** Bundle download URL. Present for the 'zip' strategy; absent for 'deltas'. */
  url?: string;
  /** SHA-256 checksum: the zip hash for 'zip', the canonical filesHash for 'deltas'. */
  sha256: string;
  /** Bundle size in bytes (total decompressed size for 'deltas') */
  size: number;
  /** Release history ID associated with this manifest */
  releaseId: string;
  /** Update strategy this manifest was published with. Defaults to 'zip'. */
  strategy?: 'zip' | 'deltas';
  /**
   * True when the release is marked force-immediate: automatic flows apply
   * and reload it on the next lifecycle event regardless of shadow or
   * apply-staged policies. Manual API behavior is unchanged.
   */
  forceImmediate?: boolean;
}

/**
 * The lane's active percentage rollout, as seen by this device's last manifest
 * check in this app session.
 */
export interface RolloutState {
  /** Release ID of the rolling release */
  releaseId: string;
  /** Version of the rolling release */
  version: string;
  /** Share of devices (1-99) the rolling release goes to */
  percent: number;
  /** This device's number from 1 to 100 for this rollout */
  bucket: number;
  /** True when bucket <= percent, so this device follows the rolling release */
  included: boolean;
}

/** Values of a remote config: plain JSON, keyed by name. */
export type RemoteConfigValues = Record<string, unknown>;

/** The app's remote config (plugin 3.4+), merged over your code defaults. */
export interface RemoteConfig<T extends RemoteConfigValues = RemoteConfigValues> {
  /**
   * Remote values over your defaults: a top-level key from the remote config
   * replaces the default of the same name. Plain JSON; validate values you
   * depend on, since a key can be missing or have another type.
   */
  values: T;
  /** Version of the remote config, or null when only your defaults apply. */
  version: number | null;
  /**
   * Channel the remote config was published to: the app's channel, or null
   * for the base channel (which channels without their own config also use).
   */
  channel: string | null;
  /**
   * `remote`: fetched in this app session. `cache`: saved by an earlier
   * session. `defaults`: no remote config yet (or none was published).
   */
  source: 'remote' | 'cache' | 'defaults';
  /** When the device last fetched or confirmed this config (ISO 8601), or null. */
  fetchedAt: string | null;
}

/** `refreshConfig()`: the config after the fetch, and why the fetch failed, if it did. */
export interface RemoteConfigRefreshResult<
  T extends RemoteConfigValues = RemoteConfigValues,
> extends RemoteConfig<T> {
  /**
   * Set when the fetch failed (for example `network_error`, `http_503`,
   * `signature_invalid`); `values` are then the saved config or your defaults.
   */
  error?: string;
}

export interface GetConfigOptions<T extends RemoteConfigValues = RemoteConfigValues> {
  /** Values to use for keys the remote config does not set. */
  defaults?: T;
}

/** Remote config as the native layer reports it; the JS wrapper turns it into `RemoteConfig`. */
export interface NativeRemoteConfig {
  valuesJson: string | null;
  experimentsJson: string | null;
  version: number | null;
  channel: string | null;
  fetchedAt: string | null;
  source: 'remote' | 'cache' | 'none';
  error?: string;
}

/** An active preview link (see `previewLinks`). */
export interface PreviewInfo {
  /** ISO timestamp when the preview was opened */
  startedAt: string;
  /** Version of the previewed bundle, once it is running */
  version?: string;
}

export interface OtaKitState {
  current: BundleInfo;
  fallback: BundleInfo;
  staged: BundleInfo | null;
  builtinVersion: string;
  /** The active rollout seen by the last check in this session, or null when there is none. */
  rollout: RolloutState | null;
  /** The active preview link, or null when the app runs its normal release. */
  preview: PreviewInfo | null;
}

export type OtaKitPolicy = 'off' | 'shadow' | 'apply-staged' | 'immediate';

export interface OtaKitManifestKey {
  kid: string;
  key: string;
}

export interface OtaKitBundleKey {
  /** Key ID: first 16 hex chars of sha256(key). Printed by `otakit generate-encryption-key`. */
  kid: string;
  /** 256-bit AES key, base64. Inject from an env var at build time; do not commit. */
  key: string;
}

export interface CheckNoUpdateResult {
  kind: 'no_update';
}

export interface CheckAlreadyStagedResult {
  kind: 'already_staged';
  latest: LatestVersion;
}

export interface CheckUpdateAvailableResult {
  kind: 'update_available';
  latest: LatestVersion;
}

export type CheckResult =
  | CheckNoUpdateResult
  | CheckAlreadyStagedResult
  | CheckUpdateAvailableResult;

export interface DownloadNoUpdateResult {
  kind: 'no_update';
}

export interface DownloadStagedResult {
  kind: 'staged';
  bundle: BundleInfo;
}

export type DownloadResult = DownloadNoUpdateResult | DownloadStagedResult;

export interface ChannelInfo {
  /** The effective release channel, or null for the base channel. */
  channel: string | null;
  /** Where the effective channel comes from: a runtime override or static config. */
  source: 'override' | 'config';
}

/**
 * Payload for the `updateStaged` event: a bundle was downloaded, verified,
 * and staged, ready to apply.
 */
export interface UpdateStagedEvent {
  bundle: BundleInfo;
}

/**
 * Payload for the `updateApplied` event: a newly activated bundle was
 * confirmed healthy via notifyAppReady().
 */
export interface UpdateAppliedEvent {
  bundle: BundleInfo;
}

/**
 * Payload for the `downloadFailed` and `rollback` events.
 */
export interface UpdateFailedEvent {
  version: string;
  runtimeVersion?: string;
  releaseId?: string;
  channel?: string;
  /** Stable failure reason, e.g. "hash_mismatch", "insufficient_disk_space", "notify_timeout". */
  reason: string;
}

/** A preview link could not be opened. */
export interface PreviewFailedEvent {
  /**
   * `unavailable`: expired, revoked, or built for another runtime version.
   * `busy`: another update operation did not finish in time; open the link again.
   */
  reason: 'unavailable' | 'download_failed' | 'busy';
}

/**
 * Update lifecycle events emitted by the plugin.
 *
 * Events fire only while the app process is alive. Reconcile with
 * getState() and getLastFailure() on startup for anything that happened
 * while no listener was attached (e.g. a bundle staged in a previous
 * session, or a startup rollback).
 */
export type OtaKitEventName =
  | 'updateAvailable'
  | 'updateStaged'
  | 'updateApplied'
  | 'downloadFailed'
  | 'rollback'
  | 'previewFailed'
  | 'configChanged';

/**
 * Plugin configuration for capacitor.config.ts.
 */
export interface OtaKitConfig {
  /** OtaKit app ID used for manifest fetches and event ingest. */
  appId: string;
  /** Optional named release track. Omit to use the base channel. */
  channel?: string;
  /** Optional native compatibility lane. Set this when a new store build should start a new OTA line. */
  runtimeVersion?: string;
  /** Cold-start policy after runtime has already been resolved. Defaults to apply-staged. */
  launchPolicy?: OtaKitPolicy;
  /** Foreground resume policy. Defaults to shadow. */
  resumePolicy?: OtaKitPolicy;
  /** Cold-start policy when runtimeVersion changes or resolves for the first time. Defaults to immediate. */
  runtimePolicy?: OtaKitPolicy;
  /**
   * Minimum milliseconds between automatic background resume checks.
   * Applies only to `resumePolicy: "shadow"` and `resumePolicy: "apply-staged"`
   * when no staged bundle is already waiting, and to remote config fetches on
   * resume (plugin 3.4+). Defaults to 600000 (10 min).
   * Set to 0 or a negative value to disable resume throttling.
   */
  checkInterval?: number;
  /** Foreground milliseconds to wait for notifyAppReady(). Pauses while inactive/backgrounded. Defaults to 10000. */
  appReadyTimeout?: number;
  /** Custom event ingest base URL. Hosted default: https://ingest.otakit.app/v1 */
  ingestUrl?: string;
  /** Optional control-plane API base URL used by self-host tooling such as the CLI. The native runtime does not use it. */
  serverUrl?: string;
  /** Custom CDN base URL for manifest, bundle and remote config delivery. */
  cdnUrl?: string;
  /** Custom manifest verification keys for self-hosted or custom trust. */
  manifestKeys?: OtaKitManifestKey[];
  /**
   * Bundle decryption keys for end-to-end encrypted bundles.
   * Array to allow rotation: ship old + new keys together during a transition.
   */
  bundleKeys?: OtaKitBundleKey[];
  /** Allow HTTP only for localhost development. Defaults to false. */
  allowInsecureUrls?: boolean;
  /**
   * Open preview links (`<your-scheme>://otakit-preview?token=…`) from the
   * dashboard, CLI or an agent: the app runs that bundle until the tester
   * exits or the link expires. Needs a custom URL scheme. Defaults to false,
   * so only builds that opt in accept previews.
   */
  previewLinks?: boolean;
}

export interface OtaKitPlugin {
  /**
   * Inspect the current updater state.
   */
  getState(): Promise<OtaKitState>;

  /**
   * Check the configured channel for a newer version without downloading it.
   */
  check(): Promise<CheckResult>;

  /**
   * Check the configured channel and ensure the latest bundle is staged locally.
   */
  download(): Promise<DownloadResult>;

  /**
   * Activate the currently staged bundle and reload the WebView.
   *
   * **WARNING: TERMINAL OPERATION**
   * On success this call does not resolve back into the old JS context.
   * Code after this call may not execute. The WebView will reload.
   */
  apply(): Promise<void>;

  /**
   * Friendly manual-mode helper.
   * Bring the app to the newest available update now using one native
   * immediate-flow operation.
   *
   * **WARNING: TERMINAL OPERATION**
   * If an update is applied, this call does not resolve back into the old JS context.
   * Code after this call may not execute if an update is applied.
   */
  update(): Promise<void>;

  /**
   * **CRITICAL**: Call this when your app has successfully started.
   * Must be called within appReadyTimeout of foreground time (default 10s) or rollback occurs.
   */
  notifyAppReady(): Promise<void>;

  /**
   * Get the most recent failed update information for diagnostics.
   * Returns null if no failure has occurred.
   */
  getLastFailure(): Promise<BundleInfo | null>;

  /**
   * Override the release channel at runtime (e.g. a "Join beta" toggle).
   * Pass null to clear the override and return to the configured channel.
   *
   * The override is persisted across launches and takes effect on the next
   * check/download/automatic cycle — it does not trigger anything by itself.
   * Rejects invalid channel names without persisting.
   */
  setChannel(options: { channel: string | null }): Promise<void>;

  /**
   * Get the effective release channel and where it comes from
   * (a runtime override or the static plugin config).
   */
  getChannel(): Promise<ChannelInfo>;

  /**
   * Subscribe to update lifecycle events.
   *
   * Events fire only while the app is running. On startup, reconcile with
   * getState() (anything staged while not listening) and getLastFailure()
   * (startup rollbacks happen before JS boots and cannot reach a listener).
   * apply() reloads the WebView and destroys the JS context, so attach
   * `updateApplied` / `rollback` listeners early in app startup.
   */
  addListener(
    eventName: 'updateAvailable',
    listenerFunc: (latest: LatestVersion) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'updateStaged',
    listenerFunc: (event: UpdateStagedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'updateApplied',
    listenerFunc: (event: UpdateAppliedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'downloadFailed',
    listenerFunc: (event: UpdateFailedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'rollback',
    listenerFunc: (event: UpdateFailedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'previewFailed',
    listenerFunc: (event: PreviewFailedEvent) => void,
  ): Promise<PluginListenerHandle>;
  /**
   * The app's remote config changed after a fetch (plugin 3.4+). `values` are
   * the remote values only: merge them over your defaults, or call
   * `getConfig({ defaults })` again.
   */
  addListener(
    eventName: 'configChanged',
    listenerFunc: (config: RemoteConfig) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * The app's remote config over your defaults (plugin 3.4+). Answers
   * instantly from the device: the plugin fetches config at launch and when
   * the app returns to the foreground (at most every `checkInterval`), and
   * emits `configChanged` when it changes. With an older native plugin it
   * returns your defaults.
   *
   * ```ts
   * const { values } = await OtaKit.getConfig({ defaults: { checkoutEnabled: true } });
   * ```
   */
  getConfig<T extends RemoteConfigValues = RemoteConfigValues>(
    options?: GetConfigOptions<T>,
  ): Promise<RemoteConfig<T>>;

  /**
   * Fetch the remote config now, then resolve like `getConfig()` (plugin
   * 3.4+). Never rejects for network errors: the result carries `error` and
   * the saved config or your defaults.
   */
  refreshConfig<T extends RemoteConfigValues = RemoteConfigValues>(
    options?: GetConfigOptions<T>,
  ): Promise<RemoteConfigRefreshResult<T>>;

  /**
   * End the active preview link and return to the normal release.
   *
   * **WARNING: TERMINAL OPERATION** when a preview bundle is running: the
   * WebView reloads into the release and this call does not resolve back
   * into the old JS context.
   */
  stopPreview(): Promise<void>;

  /**
   * Notes of the running release that the app has not marked seen, or null
   * (plugin 3.3+). Show them once, for example in a "What's new" sheet, then
   * call `markReleaseNotesSeen()`.
   */
  getUnseenReleaseNotes(): Promise<ReleaseNotes | null>;

  /** Mark the running release's notes as shown (plugin 3.3+). */
  markReleaseNotesSeen(): Promise<void>;

  /**
   * Remove all registered event listeners.
   */
  removeAllListeners(): Promise<void>;
}

export interface OtaKitBridgePlugin {
  getState(): Promise<OtaKitState>;
  check(): Promise<CheckResult>;
  download(): Promise<DownloadResult>;
  apply(): Promise<void>;
  update(): Promise<void>;
  notifyAppReady(): Promise<void>;
  getLastFailure(): Promise<BundleInfo | null>;
  setChannel(options: { channel: string | null }): Promise<void>;
  getChannel(): Promise<ChannelInfo>;
  stopPreview(): Promise<void>;
  getUnseenReleaseNotes(): Promise<ReleaseNotes | null>;
  markReleaseNotesSeen(): Promise<void>;
  getConfig(): Promise<NativeRemoteConfig>;
  refreshConfig(): Promise<NativeRemoteConfig>;
  addListener(
    eventName: OtaKitEventName,
    listenerFunc: (event: unknown) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
