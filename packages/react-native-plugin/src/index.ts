import { launchContext } from './bootstrap';
import NativeOtaKit from './specs/NativeOtaKit';

export { launchContext };
export const getState = async () => JSON.parse(await NativeOtaKit.getState());
export const check = async () => JSON.parse(await NativeOtaKit.check());
export const download = async () => JSON.parse(await NativeOtaKit.download());
export const apply = () => NativeOtaKit.apply();
export const notifyAppReady = () => NativeOtaKit.notifyAppReady();
export const setActivationGuard = (active: boolean) => NativeOtaKit.setActivationGuard(active);

export interface FailedBundleInfo {
  id: string;
  appId: string;
  version: string;
  runtimeVersion: string;
  framework: 'react-native';
  platform: 'ios' | 'android';
  contentHash: string;
  status: 'error';
  channel?: string;
  releaseId?: string;
}

/** Most recent rolled-back artifact for this native build, retained after telemetry delivery. */
export async function getLastFailure(): Promise<FailedBundleInfo | null> {
  const failed = (await getState()).lastFailure;
  if (!failed) return null;
  return {
    id: failed.contentHash,
    appId: failed.appId,
    version: failed.version,
    runtimeVersion: failed.runtimeVersion,
    framework: 'react-native',
    platform: failed.platform,
    contentHash: failed.contentHash,
    status: 'error',
    ...(failed.channel == null ? {} : { channel: failed.channel }),
    ...(failed.releaseId == null ? {} : { releaseId: failed.releaseId }),
  };
}
export async function update() {
  await check();
  await download();
  await apply();
}

export const OtaKit = {
  getState,
  check,
  download,
  apply,
  notifyAppReady,
  setActivationGuard,
  getLastFailure,
  update,
};
