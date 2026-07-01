import { WebPlugin } from '@capacitor/core';

import type {
  OtaKitBridgePlugin,
  BundleInfo,
  BundleStatus,
  ChannelInfo,
  CheckResult,
  DownloadResult,
  OtaKitState,
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

  async getLastFailure(): Promise<BundleInfo | null> {
    return null;
  }

  private static readonly OVERRIDE_CHANNEL_KEY = 'otakit_override_channel';

  async setChannel(options: { channel: string | null }): Promise<void> {
    if (options.channel === null) {
      window.localStorage.removeItem(OtaKitWeb.OVERRIDE_CHANNEL_KEY);
      return;
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
