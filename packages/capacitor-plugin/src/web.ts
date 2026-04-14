import { WebPlugin } from '@capacitor/core';

import type {
  OtaKitBridgePlugin,
  BundleInfo,
  LatestVersion,
  BundleStatus,
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

  async notifyAppReady(): Promise<void> {
    // No-op on web, but don't warn - apps should call this unconditionally
  }

  async getLastFailure(): Promise<BundleInfo | null> {
    return null;
  }
}
