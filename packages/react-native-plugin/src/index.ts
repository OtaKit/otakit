import { launchContext } from './bootstrap';
import NativeOtaKit from './specs/NativeOtaKit';

export { launchContext };
export const getState = async () => JSON.parse(await NativeOtaKit.getState());
export const check = async () => JSON.parse(await NativeOtaKit.check());
export const download = async () => JSON.parse(await NativeOtaKit.download());
export const apply = () => NativeOtaKit.apply();
export const notifyAppReady = () => NativeOtaKit.notifyAppReady();
export const setActivationGuard = (active: boolean) => NativeOtaKit.setActivationGuard(active);
export async function update() {
  await check();
  await download();
  await apply();
}
