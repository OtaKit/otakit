import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  bindInstance(): string;
  getState(): Promise<string>;
  check(): Promise<string>;
  download(): Promise<string>;
  apply(): Promise<void>;
  notifyAppReady(): Promise<void>;
  setActivationGuard(active: boolean): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('OtaKitUpdater');
