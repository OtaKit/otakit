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
  /** True when this exact update is already staged locally. */
  downloaded?: boolean;
  /** Release history ID associated with this manifest */
  releaseId: string;
}

export interface OtaKitState {
  current: BundleInfo;
  fallback: BundleInfo;
  staged: BundleInfo | null;
  builtinVersion: string;
}

export type OtaKitUpdateMode = 'manual' | 'next-launch' | 'next-resume' | 'immediate';

export interface OtaKitManifestKey {
  kid: string;
  key: string;
}

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
  /** Overall update behavior. Defaults to next-launch. */
  updateMode?: OtaKitUpdateMode;
  /**
   * Minimum milliseconds between automatic update checks.
   * Applies only to automatic checks in `next-launch` and `next-resume`.
   * Manual APIs and `immediate` mode bypass this throttle. Defaults to 600000 (10 min).
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

export type OtaKitEvent =
  | 'downloadStarted'
  | 'downloadComplete'
  | 'downloadFailed'
  | 'updateAvailable'
  | 'noUpdateAvailable'
  | 'appReady'
  | 'rollback';

export interface OtaKitPlugin {
  /**
   * Inspect the current updater state.
   */
  getState(): Promise<OtaKitState>;

  /**
   * Check the configured channel for a newer version without downloading it.
   * When `downloaded` is true, the latest update is already staged locally.
   */
  check(): Promise<LatestVersion | null>;

  /**
   * Check the configured channel and download the latest bundle if available.
   * The latest bundle is staged for later activation. If it is already staged,
   * the existing staged bundle is returned without re-downloading it.
   */
  download(): Promise<BundleInfo | null>;

  /**
   * Activate the currently staged bundle and reload the WebView.
   *
   * **WARNING: TERMINAL OPERATION**
   * Code after this call may not execute. The WebView will reload.
   */
  apply(): Promise<void>;

  /**
   * Friendly manual-mode helper.
   * Bring the app to the newest available update now.
   * If the newest update is already staged, apply it.
   * Otherwise download it and apply it.
   *
   * **WARNING: TERMINAL OPERATION**
   * Code after this call may not execute if an update is applied.
   */
  update(): Promise<void>;

  /**
   * **CRITICAL**: Call this when your app has successfully started.
   * Must be called within appReadyTimeout (default 10s) or rollback occurs.
   *
   * This confirms the current bundle is working and:
   * - Marks the bundle as SUCCESS
   * - Updates the fallback bundle pointer
   * - Removes the older fallback bundle once the new bundle proves healthy
   */
  notifyAppReady(): Promise<void>;

  /**
   * Get the most recent failed update information for diagnostics.
   * Returns null if no failure has occurred.
   */
  getLastFailure(): Promise<BundleInfo | null>;

  /**
   * Add listener for update events
   */
  addListener(
    event: 'downloadStarted',
    callback: (data: { version: string }) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    event: 'downloadComplete',
    callback: (data: BundleInfo) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    event: 'downloadFailed',
    callback: (data: { version: string; error: string }) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    event: 'updateAvailable',
    callback: (data: LatestVersion) => void,
  ): Promise<PluginListenerHandle>;

  addListener(event: 'noUpdateAvailable', callback: () => void): Promise<PluginListenerHandle>;

  addListener(
    event: 'appReady',
    callback: (data: BundleInfo) => void,
  ): Promise<PluginListenerHandle>;

  addListener(
    event: 'rollback',
    callback: (data: { from: BundleInfo; to: BundleInfo; reason?: string }) => void,
  ): Promise<PluginListenerHandle>;

  /**
   * Remove all listeners for this plugin
   */
  removeAllListeners(): Promise<void>;
}

export interface OtaKitBridgePlugin {
  getState(): Promise<OtaKitState>;
  check(): Promise<LatestVersion | null>;
  download(): Promise<BundleInfo | null>;
  apply(): Promise<void>;
  notifyAppReady(): Promise<void>;
  getLastFailure(): Promise<BundleInfo | null>;
  addListener(
    event: 'downloadStarted',
    callback: (data: { version: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'downloadComplete',
    callback: (data: BundleInfo) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'downloadFailed',
    callback: (data: { version: string; error: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'updateAvailable',
    callback: (data: LatestVersion) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'noUpdateAvailable', callback: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: 'appReady',
    callback: (data: BundleInfo) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'rollback',
    callback: (data: { from: BundleInfo; to: BundleInfo; reason?: string }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
