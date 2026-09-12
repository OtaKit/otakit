import type { BundleTarget, Prisma } from '@prisma/client';

// Preserve the Capacitor lock identity and bundle join during mixed deployment.
// RN lanes have required snapshots and an explicit OS; never infer it from runtime.
export function releaseLaneLockKey(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  platform: BundleTarget = 'cross',
): string {
  return platform === 'cross'
    ? `release-lane:${appId}:${channel ?? '__base__'}:${runtimeVersion ?? '__default__'}`
    : `release-lane:rn:${JSON.stringify([appId, platform, channel, runtimeVersion])}`;
}

export function releaseLaneWhere(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  platform: BundleTarget = 'cross',
): Prisma.ReleaseWhereInput {
  return {
    appId,
    channel,
    ...(platform === 'cross'
      ? { bundle: { is: { runtimeVersion } } }
      : { platform, runtimeVersion }),
  };
}
