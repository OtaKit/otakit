import { db } from '@/lib/db';
import { getRedisOrNull } from '@/lib/redis';

import {
  getManifestAppAccessCacheKey,
  getManifestLatestReleaseCacheKey,
  MANIFEST_CACHE_TTL_SECONDS,
} from './keys';

export type ManifestAppAccess = {
  appId: string;
  usageBlocked: boolean;
};

export type ManifestReleaseBundle = {
  version: string;
  sha256: string;
  size: number;
  minNativeBuild: number | null;
  storageKey: string;
};

export type ManifestReleaseDescriptor = {
  id: string;
  channel: string | null;
  bundle: ManifestReleaseBundle;
};

type CachedManifestReleaseRecord =
  | {
      exists: false;
    }
  | {
      exists: true;
      release: ManifestReleaseDescriptor;
    };

async function readJsonCache<T>(key: string): Promise<T | undefined> {
  const redis = getRedisOrNull();
  if (!redis) {
    return undefined;
  }
  const value = await redis.get<T>(key);
  return value ?? undefined;
}

async function writeJsonCache(key: string, value: unknown): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis) {
    return;
  }
  await redis.set(key, value, { ex: MANIFEST_CACHE_TTL_SECONDS });
}

async function deleteCacheKeys(keys: string[]): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis || keys.length === 0) {
    return;
  }
  await redis.del(...keys);
}

export async function loadManifestAppAccessFromDb(
  appId: string,
): Promise<ManifestAppAccess | null> {
  const app = await db.app.findUnique({
    where: { id: appId },
    select: {
      id: true,
      organization: {
        select: {
          usageBlocked: true,
        },
      },
    },
  });

  if (!app) {
    return null;
  }

  return {
    appId: app.id,
    usageBlocked: app.organization.usageBlocked,
  };
}

export async function getCachedManifestAppAccess(appId: string): Promise<ManifestAppAccess | null> {
  const cacheKey = getManifestAppAccessCacheKey(appId);
  const cached = await readJsonCache<ManifestAppAccess>(cacheKey);
  if (cached) {
    return cached;
  }

  const loaded = await loadManifestAppAccessFromDb(appId);
  if (loaded) {
    await writeJsonCache(cacheKey, loaded);
  }
  return loaded;
}

export async function loadLatestManifestReleaseFromDb(
  appId: string,
  channel: string | null,
): Promise<ManifestReleaseDescriptor | null> {
  const latestRelease = await db.release.findFirst({
    where: {
      appId,
      channel,
      revertedAt: null,
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: {
      bundle: {
        select: {
          version: true,
          sha256: true,
          size: true,
          minNativeBuild: true,
          storageKey: true,
        },
      },
    },
  });

  if (!latestRelease) {
    return null;
  }

  return {
    id: latestRelease.id,
    channel: latestRelease.channel,
    bundle: latestRelease.bundle,
  };
}

export async function getCachedLatestManifestRelease(
  appId: string,
  channel: string | null,
): Promise<ManifestReleaseDescriptor | null> {
  const cacheKey = getManifestLatestReleaseCacheKey(appId, channel);
  const cached = await readJsonCache<CachedManifestReleaseRecord>(cacheKey);
  if (cached) {
    return cached.exists ? cached.release : null;
  }

  const loaded = await loadLatestManifestReleaseFromDb(appId, channel);
  const cachedValue: CachedManifestReleaseRecord = loaded
    ? { exists: true, release: loaded }
    : { exists: false };
  await writeJsonCache(cacheKey, cachedValue);
  return loaded;
}

export async function invalidateManifestReleaseCache(
  appId: string,
  channel: string | null,
): Promise<void> {
  await deleteCacheKeys([getManifestLatestReleaseCacheKey(appId, channel)]);
}

export async function invalidateManifestAppAccessCacheForApps(appIds: string[]): Promise<void> {
  await deleteCacheKeys(appIds.map((appId) => getManifestAppAccessCacheKey(appId)));
}
