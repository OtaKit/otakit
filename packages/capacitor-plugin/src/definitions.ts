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
  /** Unique bundle identifier */
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
}

export interface LatestVersion {
  /** Version string */
  version: string;
  /** Native compatibility lane for this update. */
  runtimeVersion?: string;
  /** Download URL */
  url: string;
  /** SHA-256 checksum */
  sha256: string;
  /** Bundle size in bytes */
  size: number;
  /** Release history ID associated with this manifest */
  releaseId: string;
}

export interface OtaKitState {
  current: BundleInfo;
  fallback: BundleInfo;
  staged: BundleInfo | null;
  builtinVersion: string;
}

export type OtaKitPolicy = 'off' | 'shadow' | 'apply-staged' | 'immediate';

export interface OtaKitManifestKey {
  kid: string;
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
   * when no staged bundle is already waiting. Defaults to 600000 (10 min).
   * Set to 0 or a negative value to disable resume throttling.
   */
  checkInterval?: number;
  /** Milliseconds to wait for notifyAppReady(). Defaults to 10000. */
  appReadyTimeout?: number;
  /** Custom event ingest base URL. Hosted default: https://ingest.otakit.app/v1 */
  ingestUrl?: string;
  /** Optional control-plane API base URL used by self-host tooling such as the CLI. The native runtime does not use it. */
  serverUrl?: string;
  /** Custom CDN base URL for manifest and bundle delivery. */
  cdnUrl?: string;
  /** Custom manifest verification keys for self-hosted or custom trust. */
  manifestKeys?: OtaKitManifestKey[];
  /** Allow HTTP only for localhost development. Defaults to false. */
  allowInsecureUrls?: boolean;
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
   * Must be called within appReadyTimeout (default 10s) or rollback occurs.
   */
  notifyAppReady(): Promise<void>;

  /**
   * Get the most recent failed update information for diagnostics.
   * Returns null if no failure has occurred.
   */
  getLastFailure(): Promise<BundleInfo | null>;
}

export interface OtaKitBridgePlugin {
  getState(): Promise<OtaKitState>;
  check(): Promise<CheckResult>;
  download(): Promise<DownloadResult>;
  apply(): Promise<void>;
  update(): Promise<void>;
  notifyAppReady(): Promise<void>;
  getLastFailure(): Promise<BundleInfo | null>;
}
