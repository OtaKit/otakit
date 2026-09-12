import Constants from 'otakit:original-expo-constants';
import { launchContext } from '../bootstrap';
export * from 'otakit:original-expo-constants';

const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(Constants);
descriptors.expoConfig = {
  enumerable: descriptors.expoConfig?.enumerable ?? true,
  configurable: false,
  get: () => (launchContext.artifactRoot ? launchContext.expoConfig : Constants.expoConfig),
};
export default Object.create(Object.getPrototypeOf(Constants), descriptors) as typeof Constants;
