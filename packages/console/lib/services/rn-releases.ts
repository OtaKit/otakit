import type { Bundle, Prisma, PrismaClient } from '@prisma/client';

import type { AuditActor } from '@/lib/audit-log';
import { computeFilesHash, type DeltaFileEntry } from '@/lib/delta-files';
import { parseBundleEncryption } from '@/lib/validation';
import { parseRNInventory } from '@/lib/rn-inventory';
import { OtaKitServiceError } from './errors';

type Database = PrismaClient | Prisma.TransactionClient;
export type RNIntent = { version: 1; actorKey: string; preparedAt: string };
export const RN_INTENT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RELEASE_IDEMPOTENCY_RETENTION_MS = 7 * RN_INTENT_WINDOW_MS;

export async function isReactNativeApp(
  database: Database,
  appId: string,
  organizationId: string,
): Promise<boolean> {
  const app = await database.app.findFirst({
    where: { id: appId, organizationId },
    select: { framework: true },
  });
  return app?.framework === 'react_native';
}

export async function databaseTime(database: Database): Promise<Date> {
  const [row] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return row.now;
}

function actorKey(actor: AuditActor): string {
  return `${actor.actorType}:${actor.actorId ?? actor.actorLabel}`;
}

export async function prepareRNIntent(database: Database, actor?: AuditActor): Promise<RNIntent> {
  if (!actor)
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'RN preparation requires an authenticated actor',
      400,
    );
  return {
    version: 1,
    actorKey: actorKey(actor),
    preparedAt: (await databaseTime(database)).toISOString(),
  };
}

export function parseRNIntent(
  raw: unknown,
  actor: AuditActor,
  idempotencyKey: string | undefined,
  expectedCurrentReleaseId: string | null | undefined,
): RNIntent {
  const value = raw as Partial<RNIntent> | null;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.preparedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    new Date(value.preparedAt).toISOString() !== value.preparedAt ||
    typeof value.actorKey !== 'string' ||
    !idempotencyKey?.trim() ||
    expectedCurrentReleaseId === undefined
  ) {
    throw new OtaKitServiceError(
      'RN_INTENT_REQUIRED',
      'Prepare the RN operation and supply its unchanged intent, operation key and expected current release',
      400,
    );
  }
  if (value.actorKey !== actorKey(actor)) {
    throw new OtaKitServiceError(
      'RN_REPLAY_SCOPE_LOST',
      'The RN operation belongs to another actor; reconcile its outcome before preparing a new operation',
      409,
    );
  }
  return { version: 1, actorKey: value.actorKey, preparedAt: value.preparedAt };
}

export async function assertFreshRNIntent(database: Database, intent: RNIntent): Promise<void> {
  if (RELEASE_IDEMPOTENCY_RETENTION_MS < RN_INTENT_WINDOW_MS + 60 * 60 * 1000) {
    throw new OtaKitServiceError(
      'RN_REPLAY_SCOPE_LOST',
      'RN replay retention is too short to accept new operations',
      503,
    );
  }
  const age = (await databaseTime(database)).getTime() - Date.parse(intent.preparedAt);
  if (age < 0 || age > RN_INTENT_WINDOW_MS) {
    throw new OtaKitServiceError(
      'RN_REPLAY_SCOPE_LOST',
      'The RN intent is expired or in the future; reconcile the original outcome before preparing a new operation',
      409,
    );
  }
}

export const rnArtifactSelect = {
  id: true,
  appId: true,
  version: true,
  platform: true,
  runtimeVersion: true,
  sha256: true,
  size: true,
  strategy: true,
  encryption: true,
  contentHash: true,
  contentFiles: true,
  embeddedReceipt: true,
  baselineBundleId: true,
} satisfies Prisma.BundleSelect;

export type RNArtifact = Pick<Bundle, keyof typeof rnArtifactSelect>;

export function assertRNTarget(
  platform: unknown,
  runtimeVersion: unknown,
): asserts platform is 'ios' | 'android' {
  if (
    (platform !== 'ios' && platform !== 'android') ||
    typeof runtimeVersion !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(runtimeVersion) ||
    Buffer.from(runtimeVersion, 'base64url').toString('base64url') !== runtimeVersion
  ) {
    throw new OtaKitServiceError(
      'INVALID_LANE',
      'RN requires an explicit iOS/Android target and a canonical native runtime digest',
      400,
    );
  }
}

// Recheck stored identity before publication. Upload and native installation
// separately validate the actual payload/path tree; declarations cannot prove
// the plaintext of an encrypted ZIP.
export function assertRNArtifactIdentity(bundle: RNArtifact): void {
  assertRNTarget(bundle.platform, bundle.runtimeVersion);
  const files = bundle.contentFiles as unknown as DeltaFileEntry[] | null;
  const inventory = parseRNInventory(files, Number.MAX_SAFE_INTEGER);
  const encryption = parseBundleEncryption(bundle.encryption);
  if (
    !bundle.version ||
    bundle.version.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(bundle.version) ||
    !bundle.contentHash ||
    !/^[a-f0-9]{64}$/.test(bundle.contentHash) ||
    !/^[a-f0-9]{64}$/.test(bundle.sha256) ||
    bundle.size <= 0 ||
    !['zip', 'deltas'].includes(bundle.strategy) ||
    encryption === null ||
    (bundle.strategy === 'deltas' && encryption !== undefined) ||
    !inventory.ok ||
    !Array.isArray(files) ||
    computeFilesHash(files) !== bundle.contentHash ||
    (bundle.strategy === 'deltas' &&
      (bundle.sha256 !== bundle.contentHash ||
        files.reduce((sum, file) => sum + file.size, 0) !== bundle.size))
  ) {
    throw new OtaKitServiceError(
      'RN_ARTIFACT_INVALID',
      'RN artifact has invalid stored content or transfer identity',
      409,
    );
  }
}

type Target = { appId: string; platform: string; runtimeVersion: string | null };
export function assertRNReleaseTarget(
  release: Target & { bundle: Target; previousBundle?: Target | null },
): void {
  assertRNTarget(release.platform, release.runtimeVersion);
  for (const bundle of [release.bundle, release.previousBundle]) {
    if (
      bundle &&
      (bundle.appId !== release.appId ||
        bundle.platform !== release.platform ||
        bundle.runtimeVersion !== release.runtimeVersion)
    ) {
      throw new OtaKitServiceError(
        'RN_ARTIFACT_INVALID',
        'RN release targeting differs from its bundle or rollback target',
        409,
      );
    }
  }
}

function assertBaseline(bundle: RNArtifact): void {
  assertRNArtifactIdentity(bundle);
  const receipt = bundle.embeddedReceipt as Record<string, unknown> | null;
  if (
    !receipt ||
    Array.isArray(receipt) ||
    bundle.baselineBundleId !== null ||
    receipt.appId !== bundle.appId ||
    receipt.framework !== 'react-native' ||
    receipt.platform !== bundle.platform ||
    receipt.runtimeVersion !== bundle.runtimeVersion ||
    receipt.version !== bundle.version ||
    receipt.embeddedContentHash !== bundle.contentHash
  ) {
    throw new OtaKitServiceError(
      'RN_BASELINE_REQUIRED',
      'RN baseline must match its archived native embedded receipt',
      409,
    );
  }
}

export async function resolveRNBaseline(
  database: Database,
  bundle: RNArtifact,
): Promise<RNArtifact> {
  assertRNArtifactIdentity(bundle);
  if (bundle.embeddedReceipt !== null) {
    assertBaseline(bundle);
    return bundle;
  }
  const baseline = bundle.baselineBundleId
    ? await database.bundle.findFirst({
        where: {
          id: bundle.baselineBundleId,
          appId: bundle.appId,
          platform: bundle.platform,
          runtimeVersion: bundle.runtimeVersion,
        },
        select: rnArtifactSelect,
      })
    : null;
  if (!baseline)
    throw new OtaKitServiceError(
      'RN_BASELINE_REQUIRED',
      'Upload the archived baseline and bind it to this RN artifact before publishing',
      409,
    );
  assertBaseline(baseline);
  return baseline;
}
