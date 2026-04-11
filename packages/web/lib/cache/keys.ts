export const MANIFEST_CACHE_TTL_SECONDS = 60;
const MANIFEST_CACHE_PREFIX = 'otk:manifest:v2';
const BASE_CHANNEL_KEY = '__base__';
const BASE_RUNTIME_VERSION_KEY = '__runtime_null__';

export function getManifestChannelKey(channel: string | null): string {
  return channel ?? BASE_CHANNEL_KEY;
}

export function getManifestRuntimeVersionKey(runtimeVersion: string | null): string {
  return runtimeVersion ?? BASE_RUNTIME_VERSION_KEY;
}

export function getManifestAppAccessCacheKey(appId: string): string {
  return `${MANIFEST_CACHE_PREFIX}:app:${appId}`;
}

export function getManifestLatestReleaseCacheKey(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): string {
  return `${MANIFEST_CACHE_PREFIX}:release:${appId}:${getManifestChannelKey(channel)}:${getManifestRuntimeVersionKey(runtimeVersion)}`;
}
