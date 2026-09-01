import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { purgeCdnUrls } from '@/lib/cdn-purge';
import { db } from '@/lib/db';
import type { OrganizationAccess } from '@/lib/organization-access';
import { buildPublicObjectUrl, deleteBundleObject } from '@/lib/storage';

import { OtaKitServiceError } from './errors';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

const SAFE_BUNDLE_SELECT = {
  id: true,
  appId: true,
  version: true,
  sha256: true,
  size: true,
  runtimeVersion: true,
  strategy: true,
  metadata: true,
  nativePackages: true,
  encryption: true,
  createdAt: true,
} as const;

function serializeBundle(bundle: {
  id: string;
  version: string;
  sha256: string;
  size: number;
  runtimeVersion: string | null;
  strategy: string;
  metadata: unknown;
  nativePackages: unknown;
  encryption: unknown;
  createdAt: Date;
}) {
  return {
    id: bundle.id,
    version: bundle.version,
    sha256: bundle.sha256,
    size: bundle.size,
    runtimeVersion: bundle.runtimeVersion,
    strategy: bundle.strategy,
    metadata: bundle.metadata,
    nativePackages: bundle.nativePackages,
    hasNativePackages: Array.isArray(bundle.nativePackages),
    encrypted: bundle.encryption !== null,
    createdAt: bundle.createdAt.toISOString(),
  };
}

export async function listBundles(input: {
  appId: string;
  version?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const offset = Math.max(0, input.offset ?? 0);
  const version = input.version?.trim();
  const where = { appId: input.appId, ...(version ? { version } : {}) };
  const [bundles, total] = await Promise.all([
    db.bundle.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      select: SAFE_BUNDLE_SELECT,
    }),
    db.bundle.count({ where }),
  ]);
  return { bundles: bundles.map(serializeBundle), total, limit, offset };
}

export async function getBundle(appId: string, bundleId: string) {
  const bundle = await db.bundle.findUnique({
    where: { id: bundleId },
    select: SAFE_BUNDLE_SELECT,
  });
  if (!bundle || bundle.appId !== appId) {
    throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);
  }
  return serializeBundle(bundle);
}

export async function deleteBundle(input: {
  access: OrganizationAccess;
  appId: string;
  bundleId: string;
  auditMetadata?: Record<string, unknown>;
}) {
  const bundle = await db.bundle.findUnique({
    where: { id: input.bundleId },
    select: { id: true, appId: true, version: true, storageKey: true },
  });
  if (!bundle || bundle.appId !== input.appId) {
    throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);
  }

  const releaseReference = await db.release.findFirst({
    where: { bundleId: bundle.id, appId: input.appId },
    select: { id: true },
  });
  if (releaseReference) {
    throw new OtaKitServiceError(
      'BUNDLE_IN_RELEASE_HISTORY',
      'Cannot delete a bundle that is present in release history',
      409,
    );
  }

  await db.bundle.delete({ where: { id: bundle.id } });
  await recordAuditLog({
    organizationId: input.access.organizationId,
    actor: await accessActor(input.access),
    action: 'bundle.deleted',
    targetType: 'bundle',
    targetId: bundle.id,
    metadata: { appId: input.appId, version: bundle.version, ...input.auditMetadata },
  });

  let storageDeleted = true;
  try {
    await deleteBundleObject(bundle.storageKey);
    await purgeCdnUrls([buildPublicObjectUrl(bundle.storageKey)]);
  } catch (error) {
    storageDeleted = false;
    console.error('Failed to delete storage object for bundle', bundle.id, error);
  }

  return { deleted: true as const, id: bundle.id, storageDeleted };
}
