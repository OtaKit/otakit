import { db } from '@/lib/db';
import { signManifest } from '@/lib/manifest-signing';
import { purgeCdnUrls } from '@/lib/cdn-purge';
import { type DeltaFileEntry } from '@/lib/delta-files';
import {
  buildFileObjectKey,
  buildPublicObjectUrl,
  deleteStorageObject,
  getTextObject,
  listStorageKeys,
  putTextObject,
} from '@/lib/storage';
import { parseBundleEncryption } from '@/lib/validation';

const MANIFEST_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const MANIFEST_PREFIX = 'manifests';
const BASE_CHANNEL_KEY = '__base__';
const DEFAULT_RUNTIME_KEY = '__default__';

type ManifestBundle = {
  version: string;
  sha256: string;
  size: number;
  runtimeVersion: string | null;
  strategy: string;
  storageKey: string;
  encryption?: unknown;
};

type ManifestRelease = {
  id: string;
  forceImmediate: boolean;
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
  const strategy = bundle.strategy === 'deltas' ? 'deltas' : 'zip';
  // Stored as validated at initiate; re-parse defensively. A malformed row
  // must fail the sync loudly — silently publishing an unencrypted manifest
  // for an encrypted object would make every device fail extraction.
  const parsedEncryption = parseBundleEncryption(bundle.encryption);
  if (parsedEncryption === null) {
    throw new Error(
      `Bundle ${bundle.version} has a malformed stored encryption envelope; refusing to publish its manifest`,
    );
  }
  const encryption = parsedEncryption ?? null;
  const signature = signManifest({
    appId,
    channel,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
    strategy,
    forceImmediate: release.forceImmediate,
    encryption,
  });

  // Every field here that is also in the signed payload (strategy,
  // forceImmediate, encryption, sha256, size, …) must carry the exact same
  // value passed to signManifest above, or verification fails on-device.
  const manifest: Record<string, unknown> = {
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    channel,
    runtimeVersion: bundle.runtimeVersion,
    releaseId: release.id,
    strategy,
    forceImmediate: release.forceImmediate,
    encryption,
    signature,
  };

  if (strategy === 'deltas') {
    // The bundle's storage object is the canonical file list written at
    // finalize; expand it into per-file CDN URLs. sha256 above == filesHash.
    const fileListRaw = await getTextObject(bundle.storageKey);
    const fileList = JSON.parse(fileListRaw) as { files: DeltaFileEntry[] };
    manifest.filesHash = bundle.sha256;
    manifest.files = fileList.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      size: file.size,
      url: buildPublicObjectUrl(buildFileObjectKey(appId, file.sha256)),
    }));
  } else {
    manifest.url = buildPublicObjectUrl(bundle.storageKey);
  }

  await putTextObject({
    storageKey,
    body: JSON.stringify(manifest),
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
          strategy: true,
          storageKey: true,
          encryption: true,
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
          strategy: true,
          storageKey: true,
          encryption: true,
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
    await writeManifestFile(
      appId,
      release.channel,
      release.bundle.runtimeVersion,
      release,
      release.bundle,
    );
  }
}
