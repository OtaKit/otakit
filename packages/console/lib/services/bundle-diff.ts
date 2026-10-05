import type { PrismaClient } from '@prisma/client';

import {
  bundleWarnings,
  diffFileLists,
  downloadBytes,
  type BundleWarning,
  type FileChange,
} from '@/lib/bundle-diff';
import { getBundleFileList, type BundleFileListResult } from '@/lib/bundle-files';
import { db } from '@/lib/db';
import { isRolling } from '@/lib/rollouts';

import { OtaKitServiceError } from './errors';

/** Responses list at most this many changed files; summaries count all of them. */
export const MAX_LISTED_CHANGES = 5000;

const BUNDLE_SELECT = {
  id: true,
  appId: true,
  version: true,
  runtimeVersion: true,
  strategy: true,
  size: true,
  storageKey: true,
  encryption: true,
  createdAt: true,
} as const;

type BundleRow = {
  id: string;
  version: string;
  runtimeVersion: string | null;
  strategy: string;
  size: number;
  storageKey: string;
  encryption: unknown;
  createdAt: Date;
};

export type BundleDiffBundle = {
  id: string;
  version: string;
  runtimeVersion: string | null;
  strategy: string;
  /** Upload size: the zip archive, or the total of a delta bundle's files. */
  size: number;
  encrypted: boolean;
  createdAt: string;
};

export type BundleDiff = {
  target: BundleDiffBundle;
  /** What the target is compared with; null when there is nothing before it. */
  base: BundleDiffBundle | null;
  baseSource: 'against' | 'channel' | 'previous_upload';
  /** `ok`, or which side's files cannot be read and why. */
  status: 'ok' | 'target_unavailable' | 'base_unavailable';
  unavailableReason: 'encrypted' | 'unreadable' | null;
  /** False when one bundle is zip and the other deltas: changes are by size only. */
  comparable: boolean;
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    /** Unpacked bytes. */
    totalBefore: number | null;
    totalAfter: number;
    /** What a device on the base downloads; null when it depends on the device. */
    downloadBytes: number | null;
  } | null;
  changes: FileChange[];
  /** Changed files beyond MAX_LISTED_CHANGES that are counted but not listed. */
  unlistedChanges: number;
  warnings: BundleWarning[];
};

function describeBundle(bundle: BundleRow): BundleDiffBundle {
  return {
    id: bundle.id,
    version: bundle.version,
    runtimeVersion: bundle.runtimeVersion,
    strategy: bundle.strategy,
    size: bundle.size,
    encrypted: bundle.encryption !== null,
    createdAt: bundle.createdAt.toISOString(),
  };
}

/** The bundle devices on the lane run outside a rollout, or null. */
async function laneBundleId(
  database: PrismaClient,
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  target: BundleRow,
): Promise<string | null> {
  const [current, below] = await database.release.findMany({
    where: { appId, channel, revertedAt: null, bundle: { is: { runtimeVersion } } },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    take: 2,
    select: { bundleId: true, previousBundleId: true, rolloutPercent: true },
  });
  const stable = current && isRolling(current) ? below : current;
  if (!stable) return null;
  // Comparing the lane's own bundle with itself says nothing: use what it replaced.
  return stable.bundleId === target.id ? stable.previousBundleId : stable.bundleId;
}

/**
 * Compare a bundle with another one: `against` (a bundle of the same app),
 * `channel` (the bundle that lane runs, for the target's runtime version; null
 * is the base channel), or by default the previous upload with the same
 * runtime version.
 */
export async function getBundleDiff(
  input: {
    organizationId: string;
    appId: string;
    bundleId: string;
    against?: string;
    channel?: string | null;
  },
  dependencies: {
    database?: PrismaClient;
    readFiles?: typeof getBundleFileList;
  } = {},
): Promise<BundleDiff> {
  const database = dependencies.database ?? db;
  const readFiles = dependencies.readFiles ?? getBundleFileList;

  const target = await database.bundle.findFirst({
    where: {
      id: input.bundleId,
      appId: input.appId,
      app: { organizationId: input.organizationId },
    },
    select: BUNDLE_SELECT,
  });
  if (!target) throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);

  let baseSource: BundleDiff['baseSource'];
  let baseId: string | null;
  if (input.against !== undefined) {
    baseSource = 'against';
    baseId = input.against;
  } else if (input.channel !== undefined) {
    baseSource = 'channel';
    baseId = await laneBundleId(
      database,
      input.appId,
      input.channel,
      target.runtimeVersion,
      target,
    );
  } else {
    baseSource = 'previous_upload';
    const previous = await database.bundle.findFirst({
      where: {
        appId: input.appId,
        runtimeVersion: target.runtimeVersion,
        createdAt: { lt: target.createdAt },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    baseId = previous?.id ?? null;
  }
  const base = baseId
    ? await database.bundle.findFirst({
        where: { id: baseId, appId: input.appId },
        select: BUNDLE_SELECT,
      })
    : null;
  if (baseId && !base) {
    throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle to compare with not found', 404);
  }

  const [targetFiles, baseFiles]: [BundleFileListResult, BundleFileListResult | null] =
    await Promise.all([readFiles(target), base ? readFiles(base) : Promise.resolve(null)]);
  const result: Omit<BundleDiff, 'status' | 'unavailableReason'> = {
    target: describeBundle(target),
    base: base ? describeBundle(base) : null,
    baseSource,
    comparable: true,
    summary: null,
    changes: [],
    unlistedChanges: 0,
    warnings: [],
  };
  if (!targetFiles.ok) {
    return { ...result, status: 'target_unavailable', unavailableReason: targetFiles.reason };
  }
  if (baseFiles && !baseFiles.ok) {
    return {
      ...result,
      status: 'base_unavailable',
      unavailableReason: baseFiles.reason,
      warnings: bundleWarnings(targetFiles.list, null),
    };
  }

  const baseList = baseFiles?.ok ? baseFiles.list : null;
  const diff = diffFileLists(baseList, targetFiles.list);
  return {
    ...result,
    status: 'ok',
    unavailableReason: null,
    comparable: diff.comparable,
    summary: {
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      unchanged: diff.unchanged,
      totalBefore: diff.totalBefore,
      totalAfter: diff.totalAfter,
      downloadBytes: downloadBytes(base ? { strategy: base.strategy, list: baseList } : null, {
        strategy: target.strategy,
        size: target.size,
        list: targetFiles.list,
      }),
    },
    changes: diff.changes.slice(0, MAX_LISTED_CHANGES),
    unlistedChanges: Math.max(0, diff.changes.length - MAX_LISTED_CHANGES),
    warnings: bundleWarnings(targetFiles.list, diff),
  };
}
