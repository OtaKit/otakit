import type { Prisma, PrismaClient } from '@prisma/client';

import { db } from '@/lib/db';
import { signManifest, signRollout } from '@/lib/manifest-signing';
import { purgeCdnUrls } from '@/lib/cdn-purge';
import { previewChannel } from '@/lib/preview-links';
import { isRolling } from '@/lib/rollouts';
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
  rolloutPercent: number;
  bundle: ManifestBundle;
};

/**
 * What one lane manifest publishes: the release every device may take, and
 * optionally a rolling release that only a share of devices takes.
 */
export type LaneManifest = {
  stable: ManifestRelease;
  rolling: ManifestRelease | null;
};

export const manifestBundleSelect = {
  version: true,
  sha256: true,
  size: true,
  runtimeVersion: true,
  strategy: true,
  storageKey: true,
  encryption: true,
} satisfies Prisma.BundleSelect;

const manifestReleaseSelect = {
  id: true,
  forceImmediate: true,
  rolloutPercent: true,
  bundle: { select: manifestBundleSelect },
} satisfies Prisma.ReleaseSelect;

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

/**
 * Resolve a lane's manifest from its non-reverted releases, newest first.
 *
 * The current release is rolling when its rolloutPercent is below 100; the
 * release below it then stays the stable release everyone else receives.
 * Publishing guarantees that release exists, so a rolling release without
 * one is refused rather than published to every device.
 */
export function resolveLaneManifest<T extends ManifestRelease>(
  releases: readonly T[],
): { stable: T; rolling: T | null } | null {
  const [current, previous] = releases;
  if (!current) {
    return null;
  }
  if (!isRolling(current)) {
    return { stable: current, rolling: null };
  }
  if (!previous) {
    throw new Error(
      `Release ${current.id} is rolling out without a stable release on its lane; refusing to publish its manifest`,
    );
  }
  return { stable: previous, rolling: current };
}

export async function writeManifestFile(
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  lane: LaneManifest,
): Promise<void> {
  const storageKey = buildManifestStorageKey(appId, channel, runtimeVersion);
  const stable = await buildManifestEntry(appId, lane.stable);

  // Every field here that is also in the signed payload (strategy,
  // forceImmediate, encryption, sha256, size, …) must carry the exact same
  // value passed to the signer, or verification fails on-device.
  const manifest: Record<string, unknown> = {
    ...stable.fields,
    channel,
    signature: signManifest({ appId, channel, ...stable.signed }),
    ...stable.location,
  };

  if (lane.rolling) {
    // Plugins before 3.1 ignore this key and keep the stable release.
    const rolling = await buildManifestEntry(appId, lane.rolling);
    const rollout = {
      percent: lane.rolling.rolloutPercent,
      releaseId: lane.rolling.id,
      stableSha256: lane.stable.bundle.sha256,
    };
    manifest.rollout = {
      ...rolling.fields,
      ...rollout,
      signature: signRollout({ appId, channel, ...rolling.signed, ...rollout }),
      ...rolling.location,
    };
  }

  await putTextObject({
    storageKey,
    body: JSON.stringify(manifest),
    contentType: 'application/json; charset=utf-8',
    cacheControl: MANIFEST_CACHE_CONTROL,
  });

  await purgeCdnUrls([buildPublicObjectUrl(storageKey)]);
}

async function buildManifestEntry(appId: string, release: ManifestRelease) {
  const { bundle } = release;
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
  const signed = {
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
    strategy,
    forceImmediate: release.forceImmediate,
    encryption: parsedEncryption ?? null,
  } as const;

  let location: Record<string, unknown>;
  if (strategy === 'deltas') {
    // The bundle's storage object is the canonical file list written at
    // finalize; expand it into per-file CDN URLs. sha256 above == filesHash.
    const fileListRaw = await getTextObject(bundle.storageKey);
    const fileList = JSON.parse(fileListRaw) as { files: DeltaFileEntry[] };
    location = {
      filesHash: bundle.sha256,
      files: fileList.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
        size: file.size,
        url: buildPublicObjectUrl(buildFileObjectKey(appId, file.sha256)),
      })),
    };
  } else {
    location = { url: buildPublicObjectUrl(bundle.storageKey) };
  }

  return {
    signed,
    fields: {
      version: signed.version,
      sha256: signed.sha256,
      size: signed.size,
      runtimeVersion: signed.runtimeVersion,
      releaseId: release.id,
      strategy: signed.strategy,
      forceImmediate: signed.forceImmediate,
      encryption: signed.encryption,
    },
    location,
  };
}

/**
 * Publish a preview's bundle on its hidden channel: an ordinary signed
 * manifest whose release ID names the preview, so device events identify it.
 */
export async function writePreviewManifestFile(
  appId: string,
  preview: { id: string; token: string },
  bundle: ManifestBundle,
): Promise<void> {
  await writeManifestFile(appId, previewChannel(preview.token), bundle.runtimeVersion, {
    stable: { id: `preview_${preview.id}`, forceImmediate: false, rolloutPercent: 100, bundle },
    rolling: null,
  });
}

export async function deletePreviewManifestFile(
  appId: string,
  preview: { token: string },
  runtimeVersion: string | null,
): Promise<void> {
  await deleteManifestFile(appId, previewChannel(preview.token), runtimeVersion);
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
  database: PrismaClient | Prisma.TransactionClient = db,
): Promise<void> {
  const app = await database.app.findUnique({
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

  const lane = resolveLaneManifest(
    await database.release.findMany({
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
      take: 2,
      select: manifestReleaseSelect,
    }),
  );

  if (!lane) {
    await deleteManifestFile(appId, channel, runtimeVersion);
    return;
  }

  await writeManifestFile(appId, channel, runtimeVersion, lane);
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

  const releases = await db.release.findMany({
    where: {
      appId,
      revertedAt: null,
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    select: { ...manifestReleaseSelect, channel: true },
  });

  // Newest first, so each lane's list starts with its current release; a
  // lane manifest never needs more than its two newest releases.
  const laneReleases = new Map<string, typeof releases>();
  for (const release of releases) {
    const laneKey = `${getManifestChannelKey(release.channel)}:${getManifestRuntimeVersionKey(release.bundle.runtimeVersion)}`;
    const list = laneReleases.get(laneKey) ?? [];
    if (list.length < 2) list.push(release);
    laneReleases.set(laneKey, list);
  }

  // One broken lane must not leave every other lane of the app without a
  // manifest: resolve all lanes before deleting, write each independently,
  // and report the failures together.
  const failures: string[] = [];
  const lanes: Array<{ channel: string | null; manifest: LaneManifest }> = [];
  for (const list of laneReleases.values()) {
    try {
      const manifest = resolveLaneManifest(list);
      if (manifest) lanes.push({ channel: list[0].channel, manifest });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  await deleteAllManifestFilesForApp(appId);

  for (const { channel, manifest } of lanes) {
    try {
      await writeManifestFile(appId, channel, manifest.stable.bundle.runtimeVersion, manifest);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  // Active preview links were deleted with the app's manifests; bring them back.
  const previews = await db.bundlePreview.findMany({
    where: { appId, endedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, token: true, bundle: { select: manifestBundleSelect } },
  });
  for (const preview of previews) {
    try {
      await writePreviewManifestFile(appId, preview, preview.bundle);
      // A revoke or expiry that ran meanwhile already deleted this manifest.
      const stillActive = await db.bundlePreview.count({
        where: { id: preview.id, endedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!stillActive) {
        await deletePreviewManifestFile(appId, preview, preview.bundle.runtimeVersion);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Could not restore ${failures.length} manifest(s) for app ${appId}: ${failures.join('; ')}`,
    );
  }
}
