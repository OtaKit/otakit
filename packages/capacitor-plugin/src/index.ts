import { registerPlugin } from '@capacitor/core';

import type {
  OtaKitBridgePlugin,
  OtaKitPlugin,
  BundleInfo,
  LatestVersion,
  OtaKitDebugState,
  OtaKitState,
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
 * iOS call.resolve() without arguments returns {} instead of null.
 */
function normalizeNullable<T>(value: T): T | null {
  return isEmptyObject(value) ? null : value;
}

function toPublicState(value: OtaKitDebugState): OtaKitState {
  return {
    current: value.current,
    staged: value.staged,
    builtinVersion: value.builtinVersion,
  };
}

async function getState(): Promise<OtaKitState> {
  return toPublicState(await NativeOtaKit.debugGetState());
}

async function check(): Promise<LatestVersion | null> {
  return normalizeNullable(await NativeOtaKit.check());
}

async function download(): Promise<BundleInfo | null> {
  return normalizeNullable(await NativeOtaKit.download());
}

function apply(): Promise<void> {
  return NativeOtaKit.apply();
}

async function update(): Promise<void> {
  const state = await getState();

  let latest: LatestVersion | null;
  try {
    latest = await check();
  } catch (error) {
    if (state.staged) {
      await apply();
      return;
    }
    throw error;
  }

  if (latest) {
    if (latest.downloaded) {
      await apply();
      return;
    }

    const bundle = await download();
    if (bundle) {
      await apply();
    }
    return;
  }

  if (state.staged) {
    await apply();
  }
}

const OtaKit: OtaKitPlugin = {
  getState,
  check,
  download,
  apply,
  update,
  notifyAppReady: () => NativeOtaKit.notifyAppReady(),
  debug: {
    check: async (options?: { channel?: string }): Promise<LatestVersion | null> =>
      normalizeNullable(await NativeOtaKit.debugCheck(options)),
    download: async (options?: { channel?: string }): Promise<BundleInfo | null> =>
      normalizeNullable(await NativeOtaKit.debugDownload(options)),
    reset: () => NativeOtaKit.debugReset(),
    listBundles: () => NativeOtaKit.debugListBundles(),
    deleteBundle: (options: { bundleId: string }) => NativeOtaKit.debugDeleteBundle(options),
    getLastFailure: async (): Promise<BundleInfo | null> =>
      normalizeNullable(await NativeOtaKit.debugGetLastFailure()),
  },
  addListener: NativeOtaKit.addListener.bind(NativeOtaKit) as OtaKitPlugin['addListener'],
  removeAllListeners: () => NativeOtaKit.removeAllListeners(),
};

export * from './definitions';
export { OtaKit };
