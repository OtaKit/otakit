import { WebPlugin } from '@capacitor/core';

import type {
  OtaKitBridgePlugin,
  BundleInfo,
  BundleListResult,
  LatestVersion,
  BundleStatus,
  OtaKitDebugState,
} from './definitions';

/**
 * Web implementation of the native bridge.
 * Most methods are no-ops since OTA updates don't apply to web
 */
export class OtaKitWeb extends WebPlugin implements OtaKitBridgePlugin {
  private readonly BUILTIN_BUNDLE: BundleInfo = {
    id: 'builtin',
    version: '0.0.0',
    status: 'builtin' as BundleStatus,
  };

  async debugGetState(): Promise<OtaKitDebugState> {
    return {
      current: this.BUILTIN_BUNDLE,
      fallback: this.BUILTIN_BUNDLE,
      staged: null,
      builtinVersion: this.BUILTIN_BUNDLE.version,
    };
  }

  async check(): Promise<LatestVersion | null> {
    console.warn('OtaKit.check() is not supported on web');
    return null;
  }

  async download(): Promise<BundleInfo | null> {
    console.warn('OtaKit.download() is not supported on web');
    return null;
  }

  async apply(): Promise<void> {
    console.warn('OtaKit.apply() is not supported on web');
    throw new Error('OtaKit.apply() is not supported on web');
  }

  async debugCheck(): Promise<LatestVersion | null> {
    console.warn('OtaKit.debug.check() is not supported on web');
    return null;
  }

  async debugDownload(_options?: { channel?: string }): Promise<BundleInfo | null> {
    console.warn('OtaKit.debug.download() is not supported on web');
    return null;
  }

  async notifyAppReady(): Promise<void> {
    // No-op on web, but don't warn - apps should call this unconditionally
  }

  async debugReset(): Promise<void> {
    console.warn('OtaKit.debug.reset() is not supported on web');
  }

  async debugListBundles(): Promise<BundleListResult> {
    return { bundles: [] };
  }

  async debugDeleteBundle(_options: { bundleId: string }): Promise<void> {
    console.warn('OtaKit.debug.deleteBundle() is not supported on web');
  }

  async debugGetLastFailure(): Promise<BundleInfo | null> {
    return null;
  }
}
