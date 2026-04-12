import { db } from '@/lib/db';
import { signManifest } from '@/lib/manifest-signing';
import { purgeCdnUrls } from '@/lib/cdn-purge';
import {
  buildPublicObjectUrl,
  deleteStorageObject,
  listStorageKeys,
  putTextObject,
} from '@/lib/storage';

const MANIFEST_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const MANIFEST_PREFIX = 'manifests';
const BASE_CHANNEL_KEY = '__base__';
const DEFAULT_RUNTIME_KEY = '__default__';

type ManifestBundle = {
  version: string;
  sha256: string;
  size: number;
  runtimeVersion: string | null;
  storageKey: string;
};

type ManifestRelease = {
  id: string;
};

export function getManifestChannelKey(channel: string | null): string {
  return channel ?? BASE_CHANNEL_KEY;
}

export function getManifestRuntimeVersionKey(runtimeVersion: string | null): string {
  return runtimeVersion ?? DEFAULT_RUNTIME_KEY;
}

export function buildManifestStorageKey(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): string {
  return `${MANIFEST_PREFIX}/${appId}/${getManifestChannelKey(channel)}/${getManifestRuntimeVersionKey(runtimeVersion)}/manifest.json`;
}

export function buildManifestUrl(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): string {
  return buildPublicObjectUrl(buildManifestStorageKey(appId, channel, runtimeVersion));
}

export async function writeManifestFile(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  release: ManifestRelease,
  bundle: ManifestBundle,
): Promise<void> {
  const storageKey = buildManifestStorageKey(appId, channel, runtimeVersion);
  const signature = signManifest({
    appId,
    channel,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
  });

  await putTextObject({
    storageKey,
    body: JSON.stringify({
      version: bundle.version,
      url: buildPublicObjectUrl(bundle.storageKey),
      sha256: bundle.sha256,
      size: bundle.size,
      channel,
      runtimeVersion: bundle.runtimeVersion,
      releaseId: release.id,
      signature,
    }),
    contentType: 'application/json; charset=utf-8',
    cacheControl: MANIFEST_CACHE_CONTROL,
  });

  await purgeCdnUrls([buildPublicObjectUrl(storageKey)]);
}

export async function deleteManifestFile(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): Promise<void> {
  const storageKey = buildManifestStorageKey(appId, channel, runtimeVersion);
  await deleteStorageObject(storageKey);
  await purgeCdnUrls([buildPublicObjectUrl(storageKey)]);
}

export async function deleteAllManifestFilesForApp(appId: string): Promise<void> {
  const prefix = `${MANIFEST_PREFIX}/${appId}/`;
  const keys = await listStorageKeys(prefix);
  if (keys.length === 0) {
    return;
  }

  await Promise.all(keys.map((storageKey) => deleteStorageObject(storageKey)));
  await purgeCdnUrls(keys.map((storageKey) => buildPublicObjectUrl(storageKey)));
}

export async function syncManifestFileForLane(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): Promise<void> {
  const app = await db.app.findUnique({
    where: { id: appId },
    select: {
      organization: {
        select: {
          usageBlocked: true,
        },
      },
    },
  });

  if (!app || app.organization.usageBlocked) {
    await deleteManifestFile(appId, channel, runtimeVersion);
    return;
  }

  const release = await db.release.findFirst({
    where: {
      appId,
      channel,
      revertedAt: null,
      bundle: {
        is: {
          runtimeVersion,
        },
      },
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: {
      bundle: {
        select: {
          version: true,
          sha256: true,
          size: true,
          runtimeVersion: true,
          storageKey: true,
        },
      },
    },
  });

  if (!release) {
    await deleteManifestFile(appId, channel, runtimeVersion);
    return;
  }

  await writeManifestFile(appId, channel, runtimeVersion, release, release.bundle);
}

export async function restoreManifestFilesForApp(appId: string): Promise<void> {
  const app = await db.app.findUnique({
    where: { id: appId },
    select: {
      organization: {
        select: {
          usageBlocked: true,
        },
      },
    },
  });

  if (!app || app.organization.usageBlocked) {
    return;
  }

  await deleteAllManifestFilesForApp(appId);

  const releases = await db.release.findMany({
    where: {
      appId,
      revertedAt: null,
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: {
      bundle: {
        select: {
          version: true,
          sha256: true,
          size: true,
          runtimeVersion: true,
          storageKey: true,
        },
      },
    },
  });

  const seenLanes = new Set<string>();
  for (const release of releases) {
    const laneKey = `${getManifestChannelKey(release.channel)}:${getManifestRuntimeVersionKey(release.bundle.runtimeVersion)}`;
    if (seenLanes.has(laneKey)) {
      continue;
    }
    seenLanes.add(laneKey);
    await writeManifestFile(appId, release.channel, release.bundle.runtimeVersion, release, release.bundle);
  }
}
