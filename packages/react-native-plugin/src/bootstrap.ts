import NativeOtaKit from './specs/NativeOtaKit';

export interface LaunchContext {
  generation: string;
  appId: string;
  platform: 'ios' | 'android';
  runtimeVersion: string;
  contentHash: string;
  releaseId: string | null;
  channel: string | null;
  artifactRoot: string | null;
  expoConfig: Record<string, unknown> | null;
  expoDomRoot: string | null;
}

// This module runs before the app entrypoint. The value belongs to this JS
// instance and must never be refreshed from mutable coordinator state.
export const launchContext: Readonly<LaunchContext> = Object.freeze(
  JSON.parse(NativeOtaKit.bindInstance()),
);
