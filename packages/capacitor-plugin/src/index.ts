import { registerPlugin } from '@capacitor/core';

import type {
  OtaKitBridgePlugin,
  OtaKitPlugin,
  BundleInfo,
  NativeRemoteConfig,
  OtaKitEventName,
  RemoteConfig,
  RemoteConfigRefreshResult,
  RemoteConfigValues,
} from './definitions';

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
 * call.resolve() without arguments returns {} on iOS and undefined on Android.
 */
function normalizeNullable<T>(value: T): T | null {
  return value == null || isEmptyObject(value) ? null : value;
}

function isPlainObject(value: unknown): value is RemoteConfigValues {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Native config as the app sees it: remote values over the defaults. A value
 * that does not parse is treated as no remote config, never as an error.
 */
function toRemoteConfig<T extends RemoteConfigValues>(
  native: NativeRemoteConfig | null | undefined,
  defaults: T | undefined,
): RemoteConfig<T> {
  let remote: RemoteConfigValues | null = null;
  if (native?.valuesJson && native.source !== 'none') {
    try {
      const parsed: unknown = JSON.parse(native.valuesJson);
      if (isPlainObject(parsed)) remote = parsed;
    } catch {
      console.warn('[OtaKit] Ignoring remote config that is not valid JSON');
    }
  }
  if (!remote) {
    return {
      values: { ...(defaults ?? {}) } as T,
      version: null,
      channel: null,
      source: 'defaults',
      fetchedAt: native?.fetchedAt ?? null,
    };
  }
  return {
    values: { ...(defaults ?? {}), ...remote } as T,
    version: native?.version ?? null,
    channel: native?.channel ?? null,
    source: native?.source === 'remote' ? 'remote' : 'cache',
    fetchedAt: native?.fetchedAt ?? null,
  };
}

/** Capacitor rejects calls to methods an older native plugin does not have. */
function isUnimplemented(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return code === 'UNIMPLEMENTED' || /not implemented/i.test(message);
}

let warnedConfigUnavailable = false;

/**
 * JavaScript can arrive over the air before the native plugin that supports
 * remote config is in the store build: fall back to the defaults then.
 */
async function nativeConfig(
  call: () => Promise<NativeRemoteConfig>,
): Promise<NativeRemoteConfig | null> {
  try {
    return await call();
  } catch (error) {
    if (!isUnimplemented(error)) throw error;
    if (!warnedConfigUnavailable) {
      warnedConfigUnavailable = true;
      console.warn(
        '[OtaKit] Remote config needs @otakit/capacitor-updater 3.4 or later in the native build; using defaults.',
      );
    }
    return null;
  }
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
  stopPreview: () => NativeOtaKit.stopPreview(),
  getUnseenReleaseNotes: async () => normalizeNullable(await NativeOtaKit.getUnseenReleaseNotes()),
  markReleaseNotesSeen: () => NativeOtaKit.markReleaseNotesSeen(),
  getConfig: async <T extends RemoteConfigValues = RemoteConfigValues>(options?: {
    defaults?: T;
  }): Promise<RemoteConfig<T>> =>
    toRemoteConfig(await nativeConfig(() => NativeOtaKit.getConfig()), options?.defaults),
  refreshConfig: async <T extends RemoteConfigValues = RemoteConfigValues>(options?: {
    defaults?: T;
  }): Promise<RemoteConfigRefreshResult<T>> => {
    const native = await nativeConfig(() => NativeOtaKit.refreshConfig());
    const config: RemoteConfigRefreshResult<T> = toRemoteConfig(native, options?.defaults);
    if (native?.error) config.error = native.error;
    return config;
  },
  // NativeOtaKit is the registerPlugin proxy, which implements Capacitor's
  // listener API; this plain-object wrapper must forward it explicitly.
  addListener: ((eventName: OtaKitEventName, listenerFunc: (event: unknown) => void) =>
    NativeOtaKit.addListener(
      eventName,
      eventName === 'configChanged'
        ? (event: unknown) => listenerFunc(toRemoteConfig(event as NativeRemoteConfig, undefined))
        : listenerFunc,
    )) as OtaKitPlugin['addListener'],
  removeAllListeners: () => NativeOtaKit.removeAllListeners(),
};

export * from './definitions';
export { OtaKit };
