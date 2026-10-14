import { WebPlugin } from '@capacitor/core';

import type {
  AppTelemetryBundle,
  AppTelemetryItem,
  OtaKitBridgePlugin,
  BundleInfo,
  BundleStatus,
  ChannelInfo,
  CheckResult,
  DownloadResult,
  NativeRemoteConfig,
  OtaKitState,
  ReleaseNotes,
} from './definitions';

/**
 * Web implementation of the native bridge.
 * Most methods are no-ops since OTA updates don't apply to web.
 */
export class OtaKitWeb extends WebPlugin implements OtaKitBridgePlugin {
  private readonly BUILTIN_BUNDLE: BundleInfo = {
    id: 'builtin',
    version: '0.0.0',
    status: 'builtin' as BundleStatus,
  };

  async getState(): Promise<OtaKitState> {
    return {
      current: this.BUILTIN_BUNDLE,
      fallback: this.BUILTIN_BUNDLE,
      staged: null,
      builtinVersion: this.BUILTIN_BUNDLE.version,
      rollout: null,
      preview: null,
    };
  }

  async check(): Promise<CheckResult> {
    console.warn('OtaKit.check() is not supported on web');
    return { kind: 'no_update' };
  }

  async download(): Promise<DownloadResult> {
    console.warn('OtaKit.download() is not supported on web');
    return { kind: 'no_update' };
  }

  async apply(): Promise<void> {
    console.warn('OtaKit.apply() is not supported on web');
    throw new Error('OtaKit.apply() is not supported on web');
  }

  async update(): Promise<void> {
    await this.download();
  }

  async notifyAppReady(): Promise<void> {
    // No-op on web, but don't warn - apps should call this unconditionally
  }

  async stopPreview(): Promise<void> {
    // Previews only exist in native builds.
  }

  async getUnseenReleaseNotes(): Promise<ReleaseNotes | null> {
    // Web builds are not updated over the air.
    return null;
  }

  async markReleaseNotesSeen(): Promise<void> {
    // Nothing to mark on web.
  }

  async getConfig(): Promise<NativeRemoteConfig> {
    // Remote config is read by the native plugin; on web the app uses its defaults.
    return OtaKitWeb.NO_CONFIG;
  }

  async refreshConfig(): Promise<NativeRemoteConfig> {
    return OtaKitWeb.NO_CONFIG;
  }

  async enqueueAppTelemetry(options: {
    items: AppTelemetryItem[];
    bundle?: AppTelemetryBundle;
  }): Promise<{ accepted: number; dropped: number }> {
    // Error tracking runs in the iOS and Android apps.
    return { accepted: 0, dropped: options.items.length };
  }

  private static readonly NO_CONFIG: NativeRemoteConfig = {
    valuesJson: null,
    experimentsJson: null,
    version: null,
    channel: null,
    fetchedAt: null,
    source: 'none',
  };

  async getLastFailure(): Promise<BundleInfo | null> {
    return null;
  }

  private static readonly OVERRIDE_CHANNEL_KEY = 'otakit_override_channel';

  private static isValidChannelName(name: string): boolean {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || name.includes('..') || name === '.') {
      return false;
    }
    const lower = name.toLowerCase();
    return lower !== 'base' && lower !== 'default';
  }

  async setChannel(options: { channel: string | null }): Promise<void> {
    if (options.channel === null) {
      window.localStorage.removeItem(OtaKitWeb.OVERRIDE_CHANNEL_KEY);
      return;
    }
    if (!OtaKitWeb.isValidChannelName(options.channel)) {
      throw new Error(
        `Invalid channel name '${options.channel}': use 1-64 letters, numbers, '.', '_' or '-' (reserved names: base, default)`,
      );
    }
    window.localStorage.setItem(OtaKitWeb.OVERRIDE_CHANNEL_KEY, options.channel);
  }

  async getChannel(): Promise<ChannelInfo> {
    const override = window.localStorage.getItem(OtaKitWeb.OVERRIDE_CHANNEL_KEY);
    if (override !== null) {
      return { channel: override, source: 'override' };
    }
    return { channel: null, source: 'config' };
  }
}
