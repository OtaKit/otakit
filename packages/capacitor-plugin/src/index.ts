import { registerPlugin } from '@capacitor/core';

import type { OtaKitBridgePlugin, OtaKitPlugin, BundleInfo, OtaKitEventName } from './definitions';

const NativeOtaKit = registerPlugin<OtaKitBridgePlugin>('OtaKit', {
  web: () => import('./web').then((m) => new m.OtaKitWeb()),
});

/**
 * Check if result is an empty object (iOS returns {} instead of null)
 */
function isEmptyObject(obj: unknown): boolean {
  return obj !== null && typeof obj === 'object' && Object.keys(obj).length === 0;
}

/**
 * Wrapped plugin that normalizes null returns from native code.
 * iOS call.resolve() without arguments returns {} instead of null.
 */
function normalizeNullable<T>(value: T): T | null {
  return isEmptyObject(value) ? null : value;
}

const OtaKit: OtaKitPlugin = {
  getState: () => NativeOtaKit.getState(),
  check: () => NativeOtaKit.check(),
  download: () => NativeOtaKit.download(),
  apply: () => NativeOtaKit.apply(),
  update: () => NativeOtaKit.update(),
  notifyAppReady: () => NativeOtaKit.notifyAppReady(),
  getLastFailure: async (): Promise<BundleInfo | null> =>
    normalizeNullable(await NativeOtaKit.getLastFailure()),
  setChannel: (options) => NativeOtaKit.setChannel(options),
  getChannel: () => NativeOtaKit.getChannel(),
  // NativeOtaKit is the registerPlugin proxy, which implements Capacitor's
  // listener API; this plain-object wrapper must forward it explicitly.
  addListener: ((eventName: OtaKitEventName, listenerFunc: (event: unknown) => void) =>
    NativeOtaKit.addListener(eventName, listenerFunc)) as OtaKitPlugin['addListener'],
  removeAllListeners: () => NativeOtaKit.removeAllListeners(),
};

export * from './definitions';
export { OtaKit };
