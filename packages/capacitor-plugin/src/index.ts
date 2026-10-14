import { Capacitor, registerPlugin } from '@capacitor/core';

import type {
  OtaKitBridgePlugin,
  OtaKitPlugin,
  BundleInfo,
  EventProperties,
  NativeRemoteConfig,
  OtaKitEventName,
  RemoteConfig,
  RemoteConfigRefreshResult,
  RemoteConfigValues,
} from './definitions';
import { createAnalytics } from './analytics';
import { createErrorTracking } from './error-tracking';
import { createExperiments } from './experiments';
import { createTelemetry } from './telemetry';

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

/** The config with the overrides of the A/B tests this device is in. */
async function withExperiments<C extends RemoteConfig<RemoteConfigValues>>(
  native: NativeRemoteConfig | null | undefined,
  config: C,
): Promise<C> {
  if (config.source === 'defaults') return config;
  config.values = await experiments.applyToConfig(native, config.values);
  return config;
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
  }): Promise<RemoteConfig<T>> => {
    const native = await nativeConfig(() => NativeOtaKit.getConfig());
    return withExperiments(native, toRemoteConfig(native, options?.defaults));
  },
  refreshConfig: async <T extends RemoteConfigValues = RemoteConfigValues>(options?: {
    defaults?: T;
  }): Promise<RemoteConfigRefreshResult<T>> => {
    const native = await nativeConfig(() => NativeOtaKit.refreshConfig());
    const config: RemoteConfigRefreshResult<T> = await withExperiments(
      native,
      toRemoteConfig(native, options?.defaults),
    );
    if (native?.error) config.error = native.error;
    return config;
  },
  getVariant: (key: string) => experiments.getVariant(key),
  // NativeOtaKit is the registerPlugin proxy, which implements Capacitor's
  // listener API; this plain-object wrapper must forward it explicitly.
  addListener: ((eventName: OtaKitEventName, listenerFunc: (event: unknown) => void) =>
    NativeOtaKit.addListener(
      eventName,
      eventName === 'configChanged'
        ? (event: unknown) => {
            const native = event as NativeRemoteConfig;
            void withExperiments(native, toRemoteConfig(native, undefined)).then(listenerFunc);
          }
        : listenerFunc,
    )) as OtaKitPlugin['addListener'],
  removeAllListeners: () => NativeOtaKit.removeAllListeners(),
  track: (name, properties) => track(name, properties),
};

// One buffer for errors and events, flushed to the native outbox.
const telemetry = createTelemetry(NativeOtaKit, {
  isNative: () => Capacitor.isNativePlatform(),
});
const experiments = createExperiments(NativeOtaKit, telemetry);
const errorTracking = createErrorTracking(telemetry, { onSent: () => experiments.onError() });
const analytics = createAnalytics(telemetry);

/**
 * Send uncaught errors and unhandled promise rejections to OtaKit (plugin
 * 3.4+), grouped into issues per OTA release. Call it once, as early as
 * possible (for example in main.ts). Emails, tokens and URL query strings are
 * removed before anything leaves the device. Does nothing on web.
 *
 * ```ts
 * import { initErrorTracking } from '@otakit/capacitor-updater';
 *
 * initErrorTracking();
 * ```
 */
export const initErrorTracking = errorTracking.initErrorTracking;

/**
 * Send an error you caught yourself (marked handled). Returns its event ID,
 * or null when it was dropped (sampling, `ignoreErrors`, `beforeSend`, or the
 * per-session limits). Call `initErrorTracking()` first.
 */
export const captureError = errorTracking.captureError;

/**
 * Send one test error to check the setup; it appears in the dashboard's
 * Errors section within a minute. Resolves true when the native plugin stored
 * it for delivery.
 */
export const testErrorTracking = errorTracking.testErrorTracking;

/**
 * Send a custom event (plugin 3.4+): a name of 1-64 letters, numbers, ".",
 * "_", ":" or "-" (with a letter or number), and up to 20 properties with
 * string, number or boolean values. OtaKit adds the release, channel, platform and OS version. Returns
 * false when the event was dropped. Also available as `OtaKit.track()`.
 *
 * ```ts
 * track('checkout_completed', { plan: 'pro', value: 49 });
 * ```
 */
export function track(name: string, properties?: EventProperties): boolean {
  // A/B test goals count even when analytics sampling or beforeSend drops the event.
  experiments.onEvent(name);
  return analytics.track(name, properties);
}

/**
 * Optional setup for custom events: sends `$session_start` once per app
 * launch (so OtaKit can compare releases per 1,000 app launches), with
 * sampling and `beforeSend`. Call it once at startup.
 */
export const initAnalytics = analytics.initAnalytics;

export * from './definitions';
export { OtaKit };
