import { createHash, randomUUID } from 'node:crypto';

import type {
  Prisma,
  PrismaClient,
  ReleaseMutation,
  ReleaseMutationOperation,
} from '@prisma/client';

import {
  recordAuditLog,
  type AuditAction,
  type AuditActor,
  type AuditLogEntry,
} from '@/lib/audit-log';
import { db } from '@/lib/db';
import { syncManifestFileForLane } from '@/lib/manifest-files';
import { revertCurrentRelease } from '@/lib/releases';
import { FULL_ROLLOUT_PERCENT, isRolling, isRolloutPercent } from '@/lib/rollouts';
import {
  createEmptyEventCounts,
  getReleaseEventCountsWithStatus,
  getReleaseHealthWindowCounts,
} from '@/lib/tinybird/events';
import { isReleasableChannelName, isValidRuntimeVersion } from '@/lib/validation';

import { OtaKitServiceError } from './errors';
import {
  compareBundleNativePackages,
  type NativeCompatibilityResult,
} from './native-compatibility';

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RELEASE_TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;
const ROLLOUT_REPLACED_BY = 'system:rollout-replaced';

export const releaseWithBundlesInclude = {
  bundle: {
    select: {
      version: true,
      runtimeVersion: true,
      sha256: true,
      nativePackages: true,
    },
  },
  previousBundle: { select: { version: true } },
} satisfies Prisma.ReleaseInclude;

type ReleaseWithBundles = Prisma.ReleaseGetPayload<{
  include: typeof releaseWithBundlesInclude;
}>;
type ReleaseForSummary = Prisma.ReleaseGetPayload<{
  include: {
    bundle: { select: { version: true; runtimeVersion: true } };
    previousBundle: { select: { version: true } };
  };
}>;

type ManifestSync = (
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  database?: PrismaClient | Prisma.TransactionClient,
) => Promise<void>;

export type ReleaseSummary = {
  id: string;
  channel: string | null;
  runtimeVersion: string | null;
  bundleId: string;
  bundleVersion: string;
  previousBundleId: string | null;
  previousBundleVersion: string | null;
  forceImmediate: boolean;
  autoRevert: boolean;
  autoRevertRatePercent: number;
  autoRevertMinSample: number;
  /** Share of devices (1-100). Below 100 on a non-reverted release: an active rollout. */
  rolloutPercent: number;
  promotedAt: string;
  promotedBy: string | null;
  revertedAt: string | null;
  revertedBy: string | null;
};

export type PublicationStatus = 'published' | 'manifest_sync_pending';

export type PublishReleaseResult = {
  operationId: string;
  idempotencyKey: string;
  publicationStatus: PublicationStatus;
  release: ReleaseSummary;
  /** The release devices fall back to: the lane's stable release before this one. */
  previousRelease: ReleaseSummary | null;
  /** The rolling release this publish reverted, when replaceRollout was used. */
  replacedRelease?: ReleaseSummary;
  compatibility?: NativeCompatibilityResult;
};

export type RevertReleaseResult = {
  operationId: string;
  idempotencyKey: string;
  publicationStatus: PublicationStatus;
  release: ReleaseSummary;
  currentRelease: ReleaseSummary | null;
};

export type UpdateRolloutResult = {
  operationId: string;
  idempotencyKey: string;
  publicationStatus: PublicationStatus;
  release: ReleaseSummary;
  previousPercent: number;
};

type ReleaseMutationResult = PublishReleaseResult | RevertReleaseResult | UpdateRolloutResult;

export type PrepareReleaseResult = {
  appId: string;
  channel: string | null;
  runtimeVersion: string | null;
  proposedBundle: {
    id: string;
    version: string;
    sha256: string;
  };
  currentRelease: ReleaseSummary | null;
  expectedCurrentReleaseId: string | null;
  compatibility: NativeCompatibilityResult;
};

export type PrepareRevertResult = {
  appId: string;
  channel: string | null;
  runtimeVersion: string | null;
  release: ReleaseSummary;
  resultingRelease: ReleaseSummary | null;
  expectedCurrentReleaseId: string;
};

export type ListReleasesResult = {
  releases: Array<ReleaseSummary & { eventCounts: ReturnType<typeof createEmptyEventCounts> }>;
  total: number;
  limit: number;
  offset: number;
  analyticsAvailable: boolean;
};

export type PublishReleaseInput = {
  organizationId: string;
  actor: AuditActor;
  appId: string;
  bundleId: string;
  channel: string | null;
  forceImmediate?: boolean;
  autoRevert?: boolean;
  autoRevertRatePercent?: number;
  autoRevertMinSample?: number;
  /** 1-100; below 100 starts a rollout on a lane that already has a release. */
  rolloutPercent?: number;
  /** Revert the lane's active rollout and publish this bundle in its place. */
  replaceRollout?: boolean;
  expectedCurrentReleaseId?: string | null;
  idempotencyKey?: string;
  auditMetadata?: Record<string, unknown>;
  compatibilityDecision?: 'block' | 'proceed' | 'skip';
  enforceCompatibility?: boolean;
};

export type RevertReleaseInput = {
  organizationId: string;
  actor: AuditActor;
  appId: string;
  releaseId: string;
  forceImmediate?: boolean;
  expectedCurrentReleaseId?: string | null;
  idempotencyKey?: string;
  revertedBy?: string;
  /** Cancelling a rollout: refuse the revert unless the release is still at this share. */
  expectedRolloutPercent?: number;
  auditAction?: AuditAction;
  auditMetadata?: Record<string, unknown>;
  autoRevertAlertPayload?: Record<string, unknown>;
};

export type UpdateRolloutInput = {
  organizationId: string;
  actor: AuditActor;
  appId: string;
  releaseId: string;
  /** 1-100; 100 completes the rollout. */
  percent: number;
  expectedPercent?: number;
  idempotencyKey?: string;
  auditMetadata?: Record<string, unknown>;
};

type ServiceDependencies = {
  database?: PrismaClient;
  syncManifest?: ManifestSync;
};

function actorKey(actor: AuditActor): string {
  return `${actor.actorType}:${actor.actorId ?? actor.actorLabel}`;
}

function normalizeIdempotencyKey(value: string | undefined): string {
  const key = value?.trim() || randomUUID();
  if (key.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'Idempotency key must be 1-200 characters using letters, numbers, dot, underscore, colon, or hyphen',
      400,
    );
  }
  return key;
}

function stableHash(value: Record<string, unknown>): string {
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(entries)))
    .digest('hex');
}

function laneLockKey(appId: string, channel: string | null, runtimeVersion: string | null): string {
  return `release-lane:${appId}:${channel ?? '__base__'}:${runtimeVersion ?? '__default__'}`;
}

export async function lockTransaction(tx: Prisma.TransactionClient, key: string): Promise<void> {
  // The PostgreSQL lock function returns the pseudo-type `void`, which Prisma
  // cannot deserialize through $queryRaw. Execute it without reading a result.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export function toReleaseSummary(release: ReleaseForSummary): ReleaseSummary {
  return {
    id: release.id,
    channel: release.channel,
    runtimeVersion: release.bundle.runtimeVersion,
    bundleId: release.bundleId,
    bundleVersion: release.bundle.version,
    previousBundleId: release.previousBundleId,
    previousBundleVersion: release.previousBundle?.version ?? null,
    forceImmediate: release.forceImmediate,
    autoRevert: release.autoRevert,
    autoRevertRatePercent: release.autoRevertRatePercent,
    autoRevertMinSample: release.autoRevertMinSample,
    rolloutPercent: release.rolloutPercent,
    promotedAt: release.promotedAt.toISOString(),
    promotedBy: release.promotedBy ?? null,
    revertedAt: release.revertedAt?.toISOString() ?? null,
    revertedBy: release.revertedBy ?? null,
  };
}

function jsonValue<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function storedResult<T>(mutation: ReleaseMutation): T {
  if (!mutation.result) {
    throw new Error(`Release mutation ${mutation.id} has no stored result`);
  }
  return mutation.result as T;
}

function assertIdempotencyHash(mutation: ReleaseMutation, requestHash: string): void {
  if (mutation.requestHash !== requestHash) {
    throw new OtaKitServiceError(
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used with different release arguments',
      409,
      'Retry with the original arguments or use a new idempotency key.',
    );
  }
}

function assertExpectedCurrent(
  expectedCurrentReleaseId: string | null | undefined,
  actualCurrentReleaseId: string | null,
): void {
  if (
    expectedCurrentReleaseId !== undefined &&
    expectedCurrentReleaseId !== actualCurrentReleaseId
  ) {
    throw new OtaKitServiceError(
      'STALE_RELEASE_STATE',
      'The current release changed after it was reviewed',
      409,
      'Prepare the release again and review the new lane state.',
    );
  }
}

function validateReleaseOptions(input: PublishReleaseInput): void {
  validateLane(input.channel);
  if (
    input.compatibilityDecision !== undefined &&
    !['block', 'proceed', 'skip'].includes(input.compatibilityDecision)
  ) {
    throw new OtaKitServiceError('INVALID_INPUT', 'Invalid compatibility decision', 400);
  }
  if (
    input.autoRevertRatePercent !== undefined &&
    (!Number.isInteger(input.autoRevertRatePercent) ||
      input.autoRevertRatePercent < 1 ||
      input.autoRevertRatePercent > 95)
  ) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'autoRevertRatePercent must be an integer between 1 and 95',
      400,
    );
  }
  if (
    input.autoRevertMinSample !== undefined &&
    (!Number.isInteger(input.autoRevertMinSample) ||
      input.autoRevertMinSample < 10 ||
      input.autoRevertMinSample > 100000)
  ) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'autoRevertMinSample must be an integer between 10 and 100000',
      400,
    );
  }
  if (
    !input.autoRevert &&
    (input.autoRevertRatePercent !== undefined || input.autoRevertMinSample !== undefined)
  ) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'Auto-revert thresholds require autoRevert to be true',
      400,
    );
  }
  if (input.rolloutPercent !== undefined && !isRolloutPercent(input.rolloutPercent)) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'rolloutPercent must be an integer between 1 and 100',
      400,
    );
  }
}

function validateLane(channel: string | null, runtimeVersion?: string | null): void {
  if (channel !== null && !isReleasableChannelName(channel)) {
    throw new OtaKitServiceError(
      'INVALID_LANE',
      'Invalid channel. Use null for the base channel.',
      400,
    );
  }
  if (
    runtimeVersion !== undefined &&
    runtimeVersion !== null &&
    !isValidRuntimeVersion(runtimeVersion)
  ) {
    throw new OtaKitServiceError('INVALID_LANE', 'Invalid runtime version', 400);
  }
}

function releaseCompatibility(
  targetNativePackages: unknown,
  currentNativePackages: unknown,
  decision: PublishReleaseInput['compatibilityDecision'],
): NativeCompatibilityResult {
  if (decision === 'skip') {
    return { status: 'skipped', reason: 'explicitly_skipped', findings: [] };
  }
  return compareBundleNativePackages(targetNativePackages, currentNativePackages);
}

function enforceReleaseCompatibility(
  compatibility: NativeCompatibilityResult,
  decision: PublishReleaseInput['compatibilityDecision'],
): void {
  if (compatibility.status === 'incompatible' && decision !== 'proceed') {
    throw new OtaKitServiceError(
      'INCOMPATIBLE_NATIVE_CHANGE',
      'Native code differs from the current release lane',
      409,
      'Review prepare_release. Proceed only after confirming a store build is not required.',
    );
  }
}

async function finishManifestSync<T extends ReleaseMutationResult>(
  database: PrismaClient,
  mutation: ReleaseMutation,
  result: T,
  syncManifest: ManifestSync,
): Promise<T> {
  try {
    const publishedResult = { ...result, publicationStatus: 'published' as const };
    // The database mutation committed before this point. Hold the same lane
    // lock while rebuilding the derived manifest so two successful database
    // writes cannot publish object-storage state in the opposite order.
    await database.$transaction(async (tx) => {
      await lockTransaction(
        tx,
        laneLockKey(mutation.appId, mutation.channel, mutation.runtimeVersion),
      );
      await syncManifest(mutation.appId, mutation.channel, mutation.runtimeVersion, tx);
      await tx.releaseMutation.update({
        where: { id: mutation.id },
        data: {
          status: 'published',
          result: jsonValue(publishedResult),
          errorMessage: null,
        },
      });
    }, RELEASE_TRANSACTION_OPTIONS);
    return publishedResult;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown error';
    try {
      await database.releaseMutation.update({
        where: { id: mutation.id },
        data: { errorMessage: message },
      });
    } catch (updateError) {
      console.error('Failed to record pending manifest synchronization', updateError);
    }
    return { ...result, publicationStatus: 'manifest_sync_pending' };
  }
}

async function findCurrentRelease(
  database: PrismaClient | Prisma.TransactionClient,
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): Promise<ReleaseWithBundles | null> {
  const [current] = await findLaneReleases(database, appId, channel, runtimeVersion, 1);
  return current ?? null;
}

/**
 * The lane's current release and its stable release: the one every device
 * outside an active rollout runs, which is the release below a rolling one.
 */
async function findLaneState(
  database: PrismaClient | Prisma.TransactionClient,
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
): Promise<{ current: ReleaseWithBundles | null; stable: ReleaseWithBundles | null }> {
  const [current = null, below = null] = await findLaneReleases(
    database,
    appId,
    channel,
    runtimeVersion,
    2,
  );
  return { current, stable: isRolling(current) ? below : current };
}

/** The lane's newest non-reverted releases; the first is the current release. */
function findLaneReleases(
  database: PrismaClient | Prisma.TransactionClient,
  appId: string,
  channel: string | null,
  runtimeVersion: string | null,
  take: number,
): Promise<ReleaseWithBundles[]> {
  return database.release.findMany({
    where: {
      appId,
      channel,
      revertedAt: null,
      bundle: { is: { runtimeVersion } },
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    take,
    include: releaseWithBundlesInclude,
  });
}

export async function listReleases(input: {
  organizationId: string;
  appId: string;
  channelPresent?: boolean;
  channel?: string | null;
  limit?: number;
  offset?: number;
}): Promise<ListReleasesResult> {
  if (input.channelPresent) validateLane(input.channel ?? null);
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200));
  const offset = Math.max(0, input.offset ?? 0);
  const app = await db.app.findFirst({
    where: { id: input.appId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!app) {
    throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
  }

  const where = {
    appId: input.appId,
    ...(input.channelPresent ? { channel: input.channel ?? null } : {}),
  };
  const [releases, total] = await Promise.all([
    db.release.findMany({
      where,
      orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      include: releaseWithBundlesInclude,
    }),
    db.release.count({ where }),
  ]);
  const countsByReleaseId = await getReleaseEventCountsWithStatus(
    input.appId,
    releases.map((release) => release.id),
  );

  return {
    releases: releases.map((release) => ({
      ...toReleaseSummary(release),
      eventCounts: countsByReleaseId.data.get(release.id) ?? createEmptyEventCounts(),
    })),
    total,
    limit,
    offset,
    analyticsAvailable: countsByReleaseId.available,
  };
}

export async function prepareRelease(
  input: Pick<
    PublishReleaseInput,
    'organizationId' | 'appId' | 'bundleId' | 'channel' | 'compatibilityDecision'
  >,
  dependencies: Pick<ServiceDependencies, 'database'> = {},
): Promise<PrepareReleaseResult> {
  validateLane(input.channel);
  const database = dependencies.database ?? db;
  const bundle = await database.bundle.findFirst({
    where: {
      id: input.bundleId,
      appId: input.appId,
      app: { organizationId: input.organizationId },
    },
    select: {
      id: true,
      version: true,
      sha256: true,
      runtimeVersion: true,
      nativePackages: true,
    },
  });
  if (!bundle) {
    throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);
  }

  const { current: currentRelease, stable } = await findLaneState(
    database,
    input.appId,
    input.channel,
    bundle.runtimeVersion,
  );
  const compatibility = releaseCompatibility(
    bundle.nativePackages,
    stable?.bundle.nativePackages ?? null,
    input.compatibilityDecision,
  );

  return {
    appId: input.appId,
    channel: input.channel,
    runtimeVersion: bundle.runtimeVersion,
    proposedBundle: { id: bundle.id, version: bundle.version, sha256: bundle.sha256 },
    currentRelease: currentRelease ? toReleaseSummary(currentRelease) : null,
    expectedCurrentReleaseId: currentRelease?.id ?? null,
    compatibility,
  };
}

export async function getReleaseState(
  input: {
    organizationId: string;
    appId: string;
    channel: string | null;
    runtimeVersion: string | null;
  },
  dependencies: Pick<ServiceDependencies, 'database'> = {},
) {
  validateLane(input.channel, input.runtimeVersion);
  const database = dependencies.database ?? db;
  const app = await database.app.findFirst({
    where: { id: input.appId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!app) {
    throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
  }
  const release = await findCurrentRelease(
    database,
    input.appId,
    input.channel,
    input.runtimeVersion,
  );
  return {
    appId: input.appId,
    channel: input.channel,
    runtimeVersion: input.runtimeVersion,
    currentRelease: release ? toReleaseSummary(release) : null,
  };
}

type MutationBookkeeping = 'operationId' | 'idempotencyKey' | 'publicationStatus';

/**
 * Run one durable, idempotent release change. `apply` makes the database
 * change under the idempotency lock and takes the lane lock itself. The result
 * is stored with the mutation, so a retry with the same key replays it; the
 * audit entry is written once; the lane manifest is synced after commit and a
 * failed sync is reported as manifest_sync_pending for later repair.
 */
async function runReleaseMutation<T extends ReleaseMutationResult>(args: {
  dependencies: ServiceDependencies;
  organizationId: string;
  appId: string;
  actor: AuditActor;
  operation: ReleaseMutationOperation;
  idempotencyKey: string;
  requestHash: string;
  apply: (tx: Prisma.TransactionClient) => Promise<{
    result: Omit<T, MutationBookkeeping>;
    lane: { releaseId: string; channel: string | null; runtimeVersion: string | null };
  }>;
  audit: (result: T) => Omit<AuditLogEntry, 'organizationId' | 'actor'>;
}): Promise<T> {
  const database = args.dependencies.database ?? db;
  const syncManifest = args.dependencies.syncManifest ?? syncManifestFileForLane;
  const keyActor = actorKey(args.actor);

  const transactionResult = await database.$transaction(async (tx) => {
    await lockTransaction(
      tx,
      `release-mutation:${args.organizationId}:${keyActor}:${args.operation}:${args.idempotencyKey}`,
    );
    let existing = await tx.releaseMutation.findUnique({
      where: {
        organizationId_actorKey_operation_idempotencyKey: {
          organizationId: args.organizationId,
          actorKey: keyActor,
          operation: args.operation,
          idempotencyKey: args.idempotencyKey,
        },
      },
    });
    if (existing && existing.expiresAt <= new Date() && existing.status !== 'database_committed') {
      await tx.releaseMutation.delete({ where: { id: existing.id } });
      existing = null;
    }
    if (existing) {
      assertIdempotencyHash(existing, args.requestHash);
      return { mutation: existing, created: false };
    }

    const { result, lane } = await args.apply(tx);
    const mutationId = randomUUID();
    const initialResult = {
      operationId: mutationId,
      idempotencyKey: args.idempotencyKey,
      publicationStatus: 'manifest_sync_pending',
      ...result,
    } as T;
    const mutation = await tx.releaseMutation.create({
      data: {
        id: mutationId,
        organizationId: args.organizationId,
        actorKey: keyActor,
        operation: args.operation,
        idempotencyKey: args.idempotencyKey,
        requestHash: args.requestHash,
        status: 'database_committed',
        appId: args.appId,
        releaseId: lane.releaseId,
        channel: lane.channel,
        runtimeVersion: lane.runtimeVersion,
        result: jsonValue(initialResult),
        expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
      },
    });
    return { mutation, created: true };
  }, RELEASE_TRANSACTION_OPTIONS);

  const result = storedResult<T>(transactionResult.mutation);
  if (transactionResult.mutation.status === 'published') {
    return result;
  }
  if (transactionResult.created) {
    await recordAuditLog({
      organizationId: args.organizationId,
      actor: args.actor,
      ...args.audit(result),
    });
  }
  return finishManifestSync(database, transactionResult.mutation, result, syncManifest);
}

export async function publishRelease(
  input: PublishReleaseInput,
  dependencies: ServiceDependencies = {},
): Promise<PublishReleaseResult> {
  validateReleaseOptions(input);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const rolloutPercent = input.rolloutPercent ?? FULL_ROLLOUT_PERCENT;
  const requestHash = stableHash({
    appId: input.appId,
    bundleId: input.bundleId,
    channel: input.channel,
    forceImmediate: input.forceImmediate ?? false,
    autoRevert: input.autoRevert ?? false,
    autoRevertRatePercent: input.autoRevertRatePercent ?? 20,
    autoRevertMinSample: input.autoRevertMinSample ?? 50,
    expectedCurrentReleaseId: input.expectedCurrentReleaseId ?? null,
    enforceCompatibility: input.enforceCompatibility ?? false,
    compatibilityDecision: input.compatibilityDecision ?? 'block',
    // Only non-default values join the hash, so retries of requests made
    // before rollouts existed keep matching their stored mutation.
    ...(rolloutPercent !== FULL_ROLLOUT_PERCENT ? { rolloutPercent } : {}),
    ...(input.replaceRollout ? { replaceRollout: true } : {}),
  });

  return runReleaseMutation<PublishReleaseResult>({
    dependencies,
    organizationId: input.organizationId,
    appId: input.appId,
    actor: input.actor,
    operation: 'publish',
    idempotencyKey,
    requestHash,
    apply: async (tx) => {
      const bundle = await tx.bundle.findFirst({
        where: {
          id: input.bundleId,
          appId: input.appId,
          app: { organizationId: input.organizationId },
        },
        select: {
          id: true,
          version: true,
          runtimeVersion: true,
          nativePackages: true,
        },
      });
      if (!bundle) {
        throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);
      }

      await lockTransaction(tx, laneLockKey(input.appId, input.channel, bundle.runtimeVersion));
      const { current: currentRelease, stable: stableRelease } = await findLaneState(
        tx,
        input.appId,
        input.channel,
        bundle.runtimeVersion,
      );
      assertExpectedCurrent(input.expectedCurrentReleaseId, currentRelease?.id ?? null);
      if (currentRelease?.bundleId === bundle.id) {
        throw new OtaKitServiceError(
          'STALE_RELEASE_STATE',
          'Bundle is already current for this release lane',
          409,
          'Read the current release state before publishing again.',
        );
      }

      const rollingRelease = isRolling(currentRelease) ? currentRelease : null;
      if (rollingRelease && !input.replaceRollout) {
        throw new OtaKitServiceError(
          'ROLLOUT_IN_PROGRESS',
          `Release ${rollingRelease.bundle.version} is rolling out to ${rollingRelease.rolloutPercent}% of this lane`,
          409,
          'Complete or cancel the rollout first, or publish with replaceRollout to revert it and release this bundle instead.',
        );
      }
      if (rollingRelease && stableRelease?.bundleId === bundle.id) {
        throw new OtaKitServiceError(
          'STALE_RELEASE_STATE',
          'Bundle is already the stable release of this lane',
          409,
          'Cancel the rollout to return every device to it.',
        );
      }
      if (rolloutPercent < FULL_ROLLOUT_PERCENT && !stableRelease) {
        throw new OtaKitServiceError(
          'ROLLOUT_NEEDS_STABLE',
          'The first release on a lane goes to every device',
          409,
          'Publish this bundle at 100%; later releases on this lane can roll out gradually.',
        );
      }

      // Compare with the stable release: most devices run it, and it is what
      // this release falls back to (a replaced rollout is discarded).
      const compatibility = releaseCompatibility(
        bundle.nativePackages,
        stableRelease?.bundle.nativePackages ?? null,
        input.compatibilityDecision,
      );
      if (input.enforceCompatibility) {
        enforceReleaseCompatibility(compatibility, input.compatibilityDecision);
      }

      const replacedRelease = rollingRelease
        ? await tx.release.update({
            where: { id: rollingRelease.id },
            data: { revertedAt: new Date(), revertedBy: ROLLOUT_REPLACED_BY },
            include: releaseWithBundlesInclude,
          })
        : null;
      const release = await tx.release.create({
        data: {
          appId: input.appId,
          bundleId: bundle.id,
          previousBundleId: stableRelease?.bundleId ?? null,
          channel: input.channel,
          forceImmediate: input.forceImmediate ?? false,
          autoRevert: input.autoRevert ?? false,
          autoRevertRatePercent: input.autoRevertRatePercent ?? 20,
          autoRevertMinSample: input.autoRevertMinSample ?? 50,
          rolloutPercent,
          promotedBy: input.actor.actorLabel,
        },
        include: releaseWithBundlesInclude,
      });

      return {
        lane: {
          releaseId: release.id,
          channel: input.channel,
          runtimeVersion: bundle.runtimeVersion,
        },
        result: {
          release: toReleaseSummary(release),
          previousRelease: stableRelease ? toReleaseSummary(stableRelease) : null,
          ...(replacedRelease ? { replacedRelease: toReleaseSummary(replacedRelease) } : {}),
          ...(input.enforceCompatibility ? { compatibility } : {}),
        },
      };
    },
    audit: (result) => ({
      action: 'release.created',
      targetType: 'release',
      targetId: result.release.id,
      metadata: {
        appId: input.appId,
        bundleVersion: result.release.bundleVersion,
        runtimeVersion: result.release.runtimeVersion,
        channel: input.channel,
        forceImmediate: result.release.forceImmediate,
        autoRevert: result.release.autoRevert,
        ...(result.release.autoRevert
          ? {
              autoRevertRatePercent: result.release.autoRevertRatePercent,
              autoRevertMinSample: result.release.autoRevertMinSample,
            }
          : {}),
        previousBundleVersion: result.previousRelease?.bundleVersion ?? null,
        ...(result.release.rolloutPercent < FULL_ROLLOUT_PERCENT
          ? { rolloutPercent: result.release.rolloutPercent }
          : {}),
        ...(result.replacedRelease
          ? {
              replacedReleaseId: result.replacedRelease.id,
              replacedBundleVersion: result.replacedRelease.bundleVersion,
            }
          : {}),
        idempotencyKey,
        ...(input.enforceCompatibility
          ? {
              compatibilityDecision: input.compatibilityDecision ?? 'block',
              compatibilityStatus: result.compatibility?.status,
            }
          : {}),
        ...input.auditMetadata,
      },
    }),
  });
}

/**
 * Schema-independent compatibility path used until an operator explicitly
 * enables the additive ReleaseMutation migration. This intentionally keeps
 * the established production behavior while returning the superset response
 * shape understood by newer clients.
 */
export async function publishReleaseLegacy(
  input: PublishReleaseInput,
  dependencies: Pick<ServiceDependencies, 'database' | 'syncManifest'> = {},
): Promise<PublishReleaseResult> {
  validateReleaseOptions(input);
  // replaceRollout needs no guard: this path never replaces a rollout, and a
  // lane that still has one is refused below.
  if ((input.rolloutPercent ?? FULL_ROLLOUT_PERCENT) < FULL_ROLLOUT_PERCENT) {
    throw rolloutsUnavailable();
  }
  const database = dependencies.database ?? db;
  const syncManifest = dependencies.syncManifest ?? syncManifestFileForLane;
  const bundle = await database.bundle.findFirst({
    where: {
      id: input.bundleId,
      appId: input.appId,
      app: { organizationId: input.organizationId },
    },
    select: { id: true, runtimeVersion: true },
  });
  if (!bundle) {
    throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);
  }

  const currentRelease = await findCurrentRelease(
    database,
    input.appId,
    input.channel,
    bundle.runtimeVersion,
  );
  assertExpectedCurrent(input.expectedCurrentReleaseId, currentRelease?.id ?? null);
  if (currentRelease?.bundleId === bundle.id) {
    throw new OtaKitServiceError(
      'STALE_RELEASE_STATE',
      'Bundle is already current for this release lane',
      409,
    );
  }
  if (isRolling(currentRelease)) {
    // Publishing on top would strand the rollout as a non-current rolling release.
    throw new OtaKitServiceError(
      'ROLLOUT_IN_PROGRESS',
      'A rollout is in progress on this lane',
      409,
      'Cancel the rollout before publishing.',
    );
  }

  const release = await database.release.create({
    data: {
      appId: input.appId,
      bundleId: bundle.id,
      previousBundleId: currentRelease?.bundleId ?? null,
      channel: input.channel,
      forceImmediate: input.forceImmediate ?? false,
      autoRevert: input.autoRevert ?? false,
      autoRevertRatePercent: input.autoRevertRatePercent ?? 20,
      autoRevertMinSample: input.autoRevertMinSample ?? 50,
      promotedBy: input.actor.actorLabel,
    },
    include: releaseWithBundlesInclude,
  });
  await syncManifest(input.appId, input.channel, bundle.runtimeVersion);
  await recordAuditLog({
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'release.created',
    targetType: 'release',
    targetId: release.id,
    metadata: {
      appId: input.appId,
      bundleVersion: release.bundle.version,
      runtimeVersion: release.bundle.runtimeVersion,
      channel: input.channel,
      forceImmediate: release.forceImmediate,
      autoRevert: release.autoRevert,
      ...(release.autoRevert
        ? {
            autoRevertRatePercent: release.autoRevertRatePercent,
            autoRevertMinSample: release.autoRevertMinSample,
          }
        : {}),
      previousBundleVersion: currentRelease?.bundle.version ?? null,
      ...input.auditMetadata,
    },
  });

  return {
    operationId: `legacy:${release.id}`,
    idempotencyKey: input.idempotencyKey ?? `legacy:${release.id}`,
    publicationStatus: 'published',
    release: toReleaseSummary(release),
    previousRelease: currentRelease ? toReleaseSummary(currentRelease) : null,
  };
}

export async function prepareRevert(
  input: Pick<RevertReleaseInput, 'organizationId' | 'appId' | 'releaseId'>,
  dependencies: Pick<ServiceDependencies, 'database'> = {},
): Promise<PrepareRevertResult> {
  const database = dependencies.database ?? db;
  const release = await database.release.findFirst({
    where: {
      id: input.releaseId,
      appId: input.appId,
      app: { organizationId: input.organizationId },
    },
    include: releaseWithBundlesInclude,
  });
  if (!release) {
    throw new OtaKitServiceError('RELEASE_NOT_FOUND', 'Release not found', 404);
  }
  if (release.revertedAt) {
    throw new OtaKitServiceError('RELEASE_NOT_CURRENT', 'Release is already reverted', 409);
  }

  const currentRelease = await findCurrentRelease(
    database,
    input.appId,
    release.channel,
    release.bundle.runtimeVersion,
  );
  if (currentRelease?.id !== release.id) {
    throw new OtaKitServiceError(
      'RELEASE_NOT_CURRENT',
      'Release is no longer current on this lane',
      409,
    );
  }

  const resultingRelease = await database.release.findFirst({
    where: {
      appId: input.appId,
      channel: release.channel,
      revertedAt: null,
      id: { not: release.id },
      bundle: { is: { runtimeVersion: release.bundle.runtimeVersion } },
    },
    orderBy: [{ promotedAt: 'desc' }, { id: 'desc' }],
    include: releaseWithBundlesInclude,
  });

  return {
    appId: input.appId,
    channel: release.channel,
    runtimeVersion: release.bundle.runtimeVersion,
    release: toReleaseSummary(release),
    resultingRelease: resultingRelease ? toReleaseSummary(resultingRelease) : null,
    expectedCurrentReleaseId: release.id,
  };
}

const RELEASE_HEALTH_WINDOWS_MS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const;

export type ReleaseHealthWindow = keyof typeof RELEASE_HEALTH_WINDOWS_MS;

export async function getReleaseHealth(
  input: {
    organizationId: string;
    appId: string;
    releaseId: string;
    window?: ReleaseHealthWindow;
  },
  dependencies: Pick<ServiceDependencies, 'database'> = {},
) {
  const database = dependencies.database ?? db;
  const release = await database.release.findFirst({
    where: {
      id: input.releaseId,
      appId: input.appId,
      app: { organizationId: input.organizationId },
    },
    include: releaseWithBundlesInclude,
  });
  if (!release) {
    throw new OtaKitServiceError('RELEASE_NOT_FOUND', 'Release not found', 404);
  }

  const analytics = await getReleaseEventCountsWithStatus(input.appId, [release.id]);
  const counts = analytics.data.get(release.id) ?? createEmptyEventCounts();
  const window = input.window ?? '24h';
  const from = new Date(Date.now() - RELEASE_HEALTH_WINDOWS_MS[window]);
  const windowAnalytics = await getReleaseHealthWindowCounts(input.appId, [release.id], from);
  const windowCounts = windowAnalytics?.get(release.id) ?? { applied: 0, rollbacks: 0 };
  const attempts = windowCounts.applied + windowCounts.rollbacks;
  const thresholdReached = attempts >= release.autoRevertMinSample;
  return {
    release: toReleaseSummary(release),
    eventCounts: counts,
    window: {
      key: window,
      from: from.toISOString(),
      applied: windowCounts.applied,
      rollbacks: windowCounts.rollbacks,
      completedActivationEvents: attempts,
    },
    rollbackSharePercent:
      attempts === 0 ? null : Math.round((windowCounts.rollbacks / attempts) * 10_000) / 100,
    autoRevertThreshold: {
      enabled: release.autoRevert,
      minSample: release.autoRevertMinSample,
      rollbackRatePercent: release.autoRevertRatePercent,
      sampleReached: thresholdReached,
      rollbackRateReached:
        thresholdReached && attempts > 0
          ? (windowCounts.rollbacks / attempts) * 100 >= release.autoRevertRatePercent
          : false,
    },
    analyticsAvailable: analytics.available && windowAnalytics !== null,
    dataIntegrity: 'client_reported_unauthenticated_events' as const,
  };
}

export async function revertRelease(
  input: RevertReleaseInput,
  dependencies: ServiceDependencies = {},
): Promise<RevertReleaseResult> {
  if (
    input.expectedRolloutPercent !== undefined &&
    !isRolloutPercent(input.expectedRolloutPercent)
  ) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'expectedRolloutPercent must be an integer between 1 and 100',
      400,
    );
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = stableHash({
    appId: input.appId,
    releaseId: input.releaseId,
    forceImmediate: input.forceImmediate ?? null,
    expectedCurrentReleaseId: input.expectedCurrentReleaseId ?? null,
    revertedBy: input.revertedBy ?? input.actor.actorLabel,
    autoRevertAlertPayload: input.autoRevertAlertPayload ?? null,
    ...(input.expectedRolloutPercent !== undefined
      ? { expectedRolloutPercent: input.expectedRolloutPercent }
      : {}),
  });

  return runReleaseMutation<RevertReleaseResult>({
    dependencies,
    organizationId: input.organizationId,
    appId: input.appId,
    actor: input.actor,
    operation: 'revert',
    idempotencyKey,
    requestHash,
    apply: async (tx) => {
      const release = await tx.release.findFirst({
        where: {
          id: input.releaseId,
          appId: input.appId,
          app: { organizationId: input.organizationId },
        },
        include: releaseWithBundlesInclude,
      });
      if (!release) {
        throw new OtaKitServiceError('RELEASE_NOT_FOUND', 'Release not found', 404);
      }

      await lockTransaction(
        tx,
        laneLockKey(input.appId, release.channel, release.bundle.runtimeVersion),
      );
      // `release` was read before the lane lock; `currentRelease` is read
      // under it, so decisions about the lane's state use it.
      const currentRelease = await findCurrentRelease(
        tx,
        input.appId,
        release.channel,
        release.bundle.runtimeVersion,
      );
      assertExpectedCurrent(input.expectedCurrentReleaseId, currentRelease?.id ?? null);
      if (!currentRelease || currentRelease.id !== release.id) {
        throw new OtaKitServiceError(
          'RELEASE_NOT_CURRENT',
          release.revertedAt
            ? 'Release is already reverted'
            : 'Release is no longer current on this lane',
          409,
        );
      }
      if (
        input.expectedRolloutPercent !== undefined &&
        currentRelease.rolloutPercent !== input.expectedRolloutPercent
      ) {
        throw new OtaKitServiceError(
          'STALE_RELEASE_STATE',
          `The rollout is at ${currentRelease.rolloutPercent}%, not ${input.expectedRolloutPercent}%`,
          409,
          'Read the release state again before cancelling.',
        );
      }

      const revertedRelease = await tx.release.update({
        where: { id: release.id },
        data: {
          revertedAt: new Date(),
          revertedBy: input.revertedBy ?? input.actor.actorLabel,
          ...(input.autoRevertAlertPayload
            ? { autoRevertAlertPayload: jsonValue(input.autoRevertAlertPayload) }
            : {}),
        },
        include: releaseWithBundlesInclude,
      });
      let resultingRelease = await findCurrentRelease(
        tx,
        input.appId,
        release.channel,
        release.bundle.runtimeVersion,
      );
      if (input.forceImmediate !== undefined && resultingRelease) {
        resultingRelease = await tx.release.update({
          where: { id: resultingRelease.id },
          data: { forceImmediate: input.forceImmediate },
          include: releaseWithBundlesInclude,
        });
      }

      return {
        lane: {
          releaseId: release.id,
          channel: release.channel,
          runtimeVersion: release.bundle.runtimeVersion,
        },
        result: {
          release: toReleaseSummary(revertedRelease),
          currentRelease: resultingRelease ? toReleaseSummary(resultingRelease) : null,
        },
      };
    },
    audit: (result) => ({
      action: input.auditAction ?? 'release.reverted',
      targetType: 'release',
      targetId: result.release.id,
      metadata: {
        appId: input.appId,
        channel: result.release.channel,
        bundleVersion: result.release.bundleVersion,
        runtimeVersion: result.release.runtimeVersion,
        forceImmediate: input.forceImmediate,
        idempotencyKey,
        ...input.auditMetadata,
      },
    }),
  });
}

/**
 * Change an active rollout's percentage; 100 completes it. Cancelling is a
 * revert of the rolling release. Only the lane-current rolling release can
 * change, and a completed rollout stays complete.
 */
export async function updateRollout(
  input: UpdateRolloutInput,
  dependencies: ServiceDependencies = {},
): Promise<UpdateRolloutResult> {
  if (!isRolloutPercent(input.percent)) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'percent must be an integer between 1 and 100',
      400,
    );
  }
  if (input.expectedPercent !== undefined && !isRolloutPercent(input.expectedPercent)) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'expectedPercent must be an integer between 1 and 100',
      400,
    );
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestHash = stableHash({
    appId: input.appId,
    releaseId: input.releaseId,
    percent: input.percent,
    expectedPercent: input.expectedPercent ?? null,
  });

  return runReleaseMutation<UpdateRolloutResult>({
    dependencies,
    organizationId: input.organizationId,
    appId: input.appId,
    actor: input.actor,
    operation: 'rollout',
    idempotencyKey,
    requestHash,
    apply: async (tx) => {
      const release = await tx.release.findFirst({
        where: {
          id: input.releaseId,
          appId: input.appId,
          app: { organizationId: input.organizationId },
        },
        include: releaseWithBundlesInclude,
      });
      if (!release) {
        throw new OtaKitServiceError('RELEASE_NOT_FOUND', 'Release not found', 404);
      }

      await lockTransaction(
        tx,
        laneLockKey(input.appId, release.channel, release.bundle.runtimeVersion),
      );
      // `release` was read before the lane lock and may be stale (a concurrent
      // change can have completed or moved the rollout); decide on the lane's
      // current release as read under the lock.
      const current = await findCurrentRelease(
        tx,
        input.appId,
        release.channel,
        release.bundle.runtimeVersion,
      );
      if (!current || current.id !== release.id || !isRolling(current)) {
        throw new OtaKitServiceError(
          'ROLLOUT_NOT_ACTIVE',
          current?.id === release.id
            ? 'This release already reaches every device'
            : 'Release is no longer current on this lane',
          409,
          'Only the current release of a lane can change its rollout while it is below 100%.',
        );
      }
      if (input.expectedPercent !== undefined && input.expectedPercent !== current.rolloutPercent) {
        throw new OtaKitServiceError(
          'STALE_RELEASE_STATE',
          `The rollout is at ${current.rolloutPercent}%, not ${input.expectedPercent}%`,
          409,
          'Read the release state again and review the new percentage.',
        );
      }
      if (input.percent === current.rolloutPercent) {
        throw new OtaKitServiceError(
          'ROLLOUT_UNCHANGED',
          `The rollout is already at ${current.rolloutPercent}%`,
          409,
        );
      }

      const updatedRelease = await tx.release.update({
        where: { id: current.id },
        data: { rolloutPercent: input.percent },
        include: releaseWithBundlesInclude,
      });
      return {
        lane: {
          releaseId: current.id,
          channel: current.channel,
          runtimeVersion: current.bundle.runtimeVersion,
        },
        result: {
          release: toReleaseSummary(updatedRelease),
          previousPercent: current.rolloutPercent,
        },
      };
    },
    audit: (result) => ({
      action: 'release.rollout_updated',
      targetType: 'release',
      targetId: result.release.id,
      metadata: {
        appId: input.appId,
        channel: result.release.channel,
        bundleVersion: result.release.bundleVersion,
        runtimeVersion: result.release.runtimeVersion,
        fromPercent: result.previousPercent,
        toPercent: result.release.rolloutPercent,
        idempotencyKey,
        ...input.auditMetadata,
      },
    }),
  });
}

export function rolloutsUnavailable(): OtaKitServiceError {
  return new OtaKitServiceError(
    'ROLLOUTS_UNAVAILABLE',
    'Percentage rollouts need durable release mutations, which are not enabled on this server',
    409,
    'Publish at 100%, or enable OTAKIT_RELEASE_RELIABILITY_ENABLED.',
  );
}

export async function revertReleaseLegacy(input: RevertReleaseInput): Promise<RevertReleaseResult> {
  if (
    input.expectedCurrentReleaseId !== undefined &&
    input.expectedCurrentReleaseId !== input.releaseId
  ) {
    throw new OtaKitServiceError(
      'STALE_RELEASE_STATE',
      'The current release changed after it was reviewed',
      409,
    );
  }
  if (input.expectedRolloutPercent !== undefined) {
    const release = await db.release.findFirst({
      where: { id: input.releaseId, appId: input.appId },
      select: { rolloutPercent: true },
    });
    if (release && release.rolloutPercent !== input.expectedRolloutPercent) {
      throw new OtaKitServiceError(
        'STALE_RELEASE_STATE',
        `The rollout is at ${release.rolloutPercent}%, not ${input.expectedRolloutPercent}%`,
        409,
      );
    }
  }
  const outcome = await revertCurrentRelease({
    appId: input.appId,
    releaseId: input.releaseId,
    revertedBy: input.revertedBy ?? input.actor.actorLabel,
    actor: input.actor,
    organizationId: input.organizationId,
    forceImmediate: input.forceImmediate,
    auditAction: input.auditAction,
    auditMetadata: input.auditMetadata,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'not_found') {
      throw new OtaKitServiceError('RELEASE_NOT_FOUND', 'Release not found', 404);
    }
    throw new OtaKitServiceError(
      'RELEASE_NOT_CURRENT',
      outcome.reason === 'already_reverted'
        ? 'Release is already reverted'
        : 'Release is no longer current on this lane',
      409,
    );
  }

  return {
    operationId: `legacy:${outcome.targetRelease.id}`,
    idempotencyKey: input.idempotencyKey ?? `legacy:${outcome.targetRelease.id}`,
    publicationStatus: 'published',
    release: {
      ...toReleaseSummary(outcome.targetRelease),
      revertedAt: outcome.revertedAt.toISOString(),
      revertedBy: outcome.revertedBy,
    },
    currentRelease: outcome.nextCurrentRelease
      ? toReleaseSummary(outcome.nextCurrentRelease)
      : null,
  };
}

export async function reconcilePendingReleaseMutations(
  options: {
    limit?: number;
    olderThan?: Date;
  } = {},
  dependencies: ServiceDependencies = {},
): Promise<{ checked: number; repaired: number; pending: number }> {
  const database = dependencies.database ?? db;
  const syncManifest = dependencies.syncManifest ?? syncManifestFileForLane;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const mutations = await database.releaseMutation.findMany({
    where: {
      status: 'database_committed',
      ...(options.olderThan ? { updatedAt: { lt: options.olderThan } } : {}),
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });

  let repaired = 0;
  for (const mutation of mutations) {
    const result = storedResult<ReleaseMutationResult>(mutation);
    const finalResult = await finishManifestSync(database, mutation, result, syncManifest);
    if (finalResult.publicationStatus === 'published') {
      repaired += 1;
    }
  }

  await database.releaseMutation.deleteMany({
    where: {
      status: 'published',
      expiresAt: { lt: new Date() },
    },
  });

  return {
    checked: mutations.length,
    repaired,
    pending: mutations.length - repaired,
  };
}
