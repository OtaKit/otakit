import type { AppFramework, BundleTarget, Prisma, PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';
import { signManifest, signRNManifest, type ManifestSignatureInput } from '@/lib/manifest-signing';
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
import { releaseLaneWhere } from '@/lib/release-lanes';
import {
  assertRNArtifactIdentity,
  assertRNTarget,
  rnArtifactSelect,
  type RNArtifact,
} from '@/lib/services/rn-releases';

const MANIFEST_CACHE_CONTROL = 'public, max-age=60, s-maxage=300';
const MANIFEST_PREFIX = 'manifests';
const BASE_CHANNEL_KEY = '__base__';
const DEFAULT_RUNTIME_KEY = '__default__';

type ManifestBundle = RNArtifact & { storageKey: string };
const manifestBundleSelect = { ...rnArtifactSelect, storageKey: true } as const;

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
  platform: BundleTarget = 'cross',
): string {
  if (platform !== 'cross') {
    assertRNTarget(platform, runtimeVersion);
    return `${MANIFEST_PREFIX}/${appId}/v3/${platform}/${getManifestChannelKey(channel)}/${runtimeVersion}/manifest.json`;
  }
  return `${MANIFEST_PREFIX}/${appId}/${getManifestChannelKey(channel)}/${getManifestRuntimeVersionKey(runtimeVersion)}/manifest.json`;
}

export function buildManifestUrl(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  platform: BundleTarget = 'cross',
): string {
  return buildPublicObjectUrl(buildManifestStorageKey(appId, channel, runtimeVersion, platform));
}

export async function writeManifestFile(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  release: ManifestRelease,
  bundle: ManifestBundle,
  framework: AppFramework = 'capacitor',
): Promise<void> {
  const rn = framework === 'react_native';
  if (rn) {
    assertRNArtifactIdentity(bundle);
    if (bundle.appId !== appId || bundle.runtimeVersion !== runtimeVersion)
      throw new Error('RN manifest target does not match its bundle');
  } else if (bundle.platform !== 'cross') {
    throw new Error('Cannot publish an RN artifact into a Capacitor manifest');
  }
  const storageKey = buildManifestStorageKey(
    appId,
    channel,
    runtimeVersion,
    rn ? bundle.platform : 'cross',
  );
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
  const signatureFields: ManifestSignatureInput = {
    appId,
    channel,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
    strategy,
    forceImmediate: release.forceImmediate,
    encryption,
  };
  const signature = rn
    ? signRNManifest({
        ...signatureFields,
        platform: bundle.platform as 'ios' | 'android',
        runtimeVersion: bundle.runtimeVersion!,
        contentHash: bundle.contentHash!,
        releaseId: release.id,
      })
    : signManifest(signatureFields);

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
    ...(rn
      ? {
          schemaVersion: 3,
          appId,
          framework: 'react-native',
          platform: bundle.platform,
          contentHash: bundle.contentHash,
        }
      : {}),
  };

  if (strategy === 'deltas') {
    // The bundle's storage object is the canonical file list written at
    // finalize; expand it into per-file CDN URLs. sha256 above == filesHash.
    const fileListRaw = await getTextObject(bundle.storageKey);
    const fileList = JSON.parse(fileListRaw) as { files: DeltaFileEntry[] };
    if (rn) {
      // Inventory ordering is not identity; compare canonical paths/hashes and sizes below.
      const declared = bundle.contentFiles as unknown as DeltaFileEntry[];
      const byPath = new Map(declared.map((file) => [file.path, file]));
      if (
        !Array.isArray(fileList.files) ||
        fileList.files.length !== declared.length ||
        new Set(fileList.files.map((file) => file.path)).size !== declared.length ||
        fileList.files.some(
          (file) =>
            !file ||
            byPath.get(file.path)?.sha256 !== file.sha256 ||
            byPath.get(file.path)?.size !== file.size,
        )
      ) {
        throw new Error('RN stored delta list differs from its verified inventory');
      }
    }
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
  platform: BundleTarget = 'cross',
): Promise<void> {
  const storageKey = buildManifestStorageKey(appId, channel, runtimeVersion, platform);
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
  database: PrismaClient | Prisma.TransactionClient = db,
  platform: BundleTarget = 'cross',
): Promise<void> {
  const app = await database.app.findUnique({
    where: { id: appId },
    select: {
      framework: true,
      organization: {
        select: {
          usageBlocked: true,
        },
      },
    },
  });

  if (app?.framework === 'react_native') assertRNTarget(platform, runtimeVersion);
  else if (app && platform !== 'cross')
    throw new Error('Capacitor manifests require the cross target');
  if (!app || app.organization.usageBlocked) {
    await deleteManifestFile(appId, channel, runtimeVersion, platform);
    return;
  }

  const release = await database.release.findFirst({
    where: {
      ...releaseLaneWhere(appId, channel, runtimeVersion, platform),
      revertedAt: null,
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: {
      bundle: {
        select: manifestBundleSelect,
      },
    },
  });

  if (!release) {
    await deleteManifestFile(appId, channel, runtimeVersion, platform);
    return;
  }

  if (
    app.framework === 'react_native' &&
    (release.platform !== release.bundle.platform ||
      release.runtimeVersion !== release.bundle.runtimeVersion ||
      release.appId !== release.bundle.appId)
  ) {
    throw new Error('RN release lane differs from its bundle');
  }
  await writeManifestFile(appId, channel, runtimeVersion, release, release.bundle, app.framework);
}

export async function restoreManifestFilesForApp(
  appId: string,
  database: PrismaClient = db,
): Promise<void> {
  const app = await database.app.findUnique({
    where: { id: appId },
    select: {
      framework: true,
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

  const releases = await database.release.findMany({
    where: {
      appId,
      revertedAt: null,
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: {
      bundle: {
        select: manifestBundleSelect,
      },
    },
  });

  const seenLanes = new Set<string>();
  for (const release of releases) {
    const laneKey =
      app.framework === 'react_native'
        ? JSON.stringify([release.bundle.platform, release.channel, release.bundle.runtimeVersion])
        : `${getManifestChannelKey(release.channel)}:${getManifestRuntimeVersionKey(release.bundle.runtimeVersion)}`;
    if (
      app.framework === 'react_native' &&
      (release.platform !== release.bundle.platform ||
        release.runtimeVersion !== release.bundle.runtimeVersion ||
        release.appId !== release.bundle.appId)
    ) {
      throw new Error('RN release lane differs from its bundle');
    }
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
      app.framework,
    );
  }
}
