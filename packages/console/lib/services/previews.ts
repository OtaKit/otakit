import { randomBytes } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { accessActor, recordAuditLog } from '@/lib/audit-log';
import { db } from '@/lib/db';
import {
  deletePreviewManifestFile,
  manifestBundleSelect,
  writePreviewManifestFile,
} from '@/lib/manifest-files';
import type { OrganizationAccess } from '@/lib/organization-access';
import {
  DEFAULT_PREVIEW_EXPIRY,
  MAX_ACTIVE_PREVIEWS_PER_APP,
  PREVIEW_EXPIRY_OPTIONS,
  PREVIEW_TOKEN_ALPHABET,
  PREVIEW_TOKEN_LENGTH,
  isPreviewToken,
  normalizeUrlScheme,
  previewDeepLink,
  previewExitLink,
  previewPageUrl,
  previewQrUrl,
  type PreviewExpiry,
} from '@/lib/preview-links';

import { OtaKitServiceError } from './errors';

export type PreviewSummary = {
  id: string;
  bundleId: string;
  bundleVersion: string;
  runtimeVersion: string | null;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string;
  /** Page to share or scan; it offers the buttons that open the app. */
  url: string;
  /** PNG QR code of `url`. */
  qrUrl: string;
  /** Opens the app on this preview, once the app's URL scheme is known. */
  deepLink: string | null;
};

const previewInclude = {
  bundle: { select: { version: true, runtimeVersion: true } },
  app: { select: { previewUrlScheme: true } },
} satisfies Prisma.BundlePreviewInclude;

type PreviewWithRelations = Prisma.BundlePreviewGetPayload<{ include: typeof previewInclude }>;

function toPreviewSummary(preview: PreviewWithRelations): PreviewSummary {
  const scheme = preview.app.previewUrlScheme;
  return {
    id: preview.id,
    bundleId: preview.bundleId,
    bundleVersion: preview.bundle.version,
    runtimeVersion: preview.bundle.runtimeVersion,
    createdAt: preview.createdAt.toISOString(),
    createdBy: preview.createdBy,
    expiresAt: preview.expiresAt.toISOString(),
    url: previewPageUrl(preview.token),
    qrUrl: previewQrUrl(preview.token),
    deepLink: scheme ? previewDeepLink(scheme, preview.token) : null,
  };
}

function generatePreviewToken(): string {
  let token = '';
  for (const byte of randomBytes(PREVIEW_TOKEN_LENGTH)) {
    // 256 is a multiple of 32, so the low 5 bits are uniform.
    token += PREVIEW_TOKEN_ALPHABET[byte & 31];
  }
  return token;
}

function activeWhere(now: Date) {
  return { endedAt: null, expiresAt: { gt: now } } satisfies Prisma.BundlePreviewWhereInput;
}

export function isPreviewExpiry(value: unknown): value is PreviewExpiry {
  return typeof value === 'string' && Object.hasOwn(PREVIEW_EXPIRY_OPTIONS, value);
}

export async function createPreview(input: {
  access: OrganizationAccess;
  appId: string;
  bundleId: string;
  expiresIn?: PreviewExpiry;
  /** The app's custom URL scheme; remembered on the app for later previews. */
  urlScheme?: string;
  auditMetadata?: Record<string, unknown>;
}): Promise<PreviewSummary> {
  const expiresIn = input.expiresIn ?? DEFAULT_PREVIEW_EXPIRY;
  if (!isPreviewExpiry(expiresIn)) {
    throw new OtaKitServiceError('INVALID_INPUT', 'expiresIn must be 1h, 24h, 7d or 30d', 400);
  }
  const urlScheme = input.urlScheme === undefined ? undefined : normalizeUrlScheme(input.urlScheme);
  if (urlScheme === null) {
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'urlScheme must be a custom URL scheme such as "myapp"',
      400,
    );
  }

  const bundle = await db.bundle.findFirst({
    where: {
      id: input.bundleId,
      appId: input.appId,
      app: { organizationId: input.access.organizationId },
    },
    select: {
      id: true,
      ...manifestBundleSelect,
      app: { select: { organization: { select: { usageBlocked: true } } } },
    },
  });
  if (!bundle) {
    throw new OtaKitServiceError('BUNDLE_NOT_FOUND', 'Bundle not found', 404);
  }
  if (bundle.app.organization.usageBlocked) {
    throw usageBlocked();
  }

  const actor = await accessActor(input.access);
  const now = new Date();
  const preview = await db.$transaction(async (tx) => {
    // Serialize creations per app so the active-preview limit holds.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bundle-previews:${input.appId}`}, 0))`;
    const active = await tx.bundlePreview.count({
      where: { appId: input.appId, ...activeWhere(now) },
    });
    if (active >= MAX_ACTIVE_PREVIEWS_PER_APP) {
      throw new OtaKitServiceError(
        'PREVIEW_LIMIT_REACHED',
        `An app can have ${MAX_ACTIVE_PREVIEWS_PER_APP} active preview links`,
        409,
        'Revoke preview links you no longer need, or wait for them to expire.',
      );
    }
    if (urlScheme) {
      await tx.app.update({ where: { id: input.appId }, data: { previewUrlScheme: urlScheme } });
    }
    return tx.bundlePreview.create({
      data: {
        appId: input.appId,
        bundleId: bundle.id,
        token: generatePreviewToken(),
        createdBy: actor.actorLabel,
        expiresAt: new Date(now.getTime() + PREVIEW_EXPIRY_OPTIONS[expiresIn]),
      },
      include: previewInclude,
    });
  });

  try {
    await writePreviewManifestFile(input.appId, preview, bundle);
    // Blocking deletes every manifest of the app; a block that landed while
    // this one was being written must not leave it behind.
    const organization = await db.organization.findUnique({
      where: { id: input.access.organizationId },
      select: { usageBlocked: true },
    });
    if (organization?.usageBlocked) {
      await deletePreviewManifestFile(input.appId, preview, bundle.runtimeVersion);
      throw usageBlocked();
    }
  } catch (error) {
    await db.bundlePreview.delete({ where: { id: preview.id } });
    throw error;
  }

  await recordAuditLog({
    organizationId: input.access.organizationId,
    actor,
    action: 'preview.created',
    targetType: 'bundle',
    targetId: bundle.id,
    metadata: {
      appId: input.appId,
      previewId: preview.id,
      bundleVersion: bundle.version,
      expiresAt: preview.expiresAt.toISOString(),
      ...input.auditMetadata,
    },
  });
  return toPreviewSummary(preview);
}

export async function listPreviews(input: {
  organizationId: string;
  appId: string;
  bundleId?: string;
}): Promise<{ previews: PreviewSummary[]; urlScheme: string | null }> {
  const app = await db.app.findFirst({
    where: { id: input.appId, organizationId: input.organizationId },
    select: { previewUrlScheme: true },
  });
  if (!app) {
    throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
  }
  const previews = await db.bundlePreview.findMany({
    where: {
      appId: input.appId,
      ...(input.bundleId ? { bundleId: input.bundleId } : {}),
      ...activeWhere(new Date()),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: previewInclude,
  });
  return { previews: previews.map(toPreviewSummary), urlScheme: app.previewUrlScheme };
}

export async function revokePreview(input: {
  access: OrganizationAccess;
  appId: string;
  previewId: string;
  auditMetadata?: Record<string, unknown>;
}): Promise<{ status: 'revoked' | 'already_ended'; previewId: string }> {
  const preview = await db.bundlePreview.findFirst({
    where: {
      id: input.previewId,
      appId: input.appId,
      app: { organizationId: input.access.organizationId },
    },
    include: previewInclude,
  });
  if (!preview) {
    throw new OtaKitServiceError('PREVIEW_NOT_FOUND', 'Preview not found', 404);
  }
  if (!(await endPreview(preview))) {
    return { status: 'already_ended', previewId: preview.id };
  }
  await recordAuditLog({
    organizationId: input.access.organizationId,
    actor: await accessActor(input.access),
    action: 'preview.revoked',
    targetType: 'bundle',
    targetId: preview.bundleId,
    metadata: {
      appId: input.appId,
      previewId: preview.id,
      bundleVersion: preview.bundle.version,
      ...input.auditMetadata,
    },
  });
  return { status: 'revoked', previewId: preview.id };
}

/**
 * Delete a preview's manifest, then mark it ended. The manifest goes first,
 * so a failure leaves the preview open for the next attempt rather than a
 * live manifest nobody tracks. Returns false when it had already ended.
 */
async function endPreview(preview: {
  id: string;
  appId: string;
  token: string;
  endedAt: Date | null;
  bundle: { runtimeVersion: string | null };
}): Promise<boolean> {
  if (preview.endedAt) return false;
  await deletePreviewManifestFile(preview.appId, preview, preview.bundle.runtimeVersion);
  const { count } = await db.bundlePreview.updateMany({
    where: { id: preview.id, endedAt: null },
    data: { endedAt: new Date() },
  });
  return count > 0;
}

/** Cron: delete the manifests of expired previews. Idempotent and bounded. */
export async function endExpiredPreviews(
  options: { now?: Date; limit?: number } = {},
): Promise<{ ended: number; failed: number }> {
  const previews = await db.bundlePreview.findMany({
    where: { endedAt: null, expiresAt: { lte: options.now ?? new Date() } },
    orderBy: { expiresAt: 'asc' },
    take: options.limit ?? 100,
    include: previewInclude,
  });
  let ended = 0;
  let failed = 0;
  for (const preview of previews) {
    try {
      if (await endPreview(preview)) ended += 1;
    } catch (error) {
      failed += 1;
      console.error('[Previews] could not end expired preview', preview.id, error);
    }
  }
  return { ended, failed };
}

/** End a bundle's previews before the bundle (and its storage object) goes away. */
export async function endBundlePreviews(bundleId: string): Promise<void> {
  const previews = await db.bundlePreview.findMany({
    where: { bundleId, endedAt: null },
    include: previewInclude,
  });
  for (const preview of previews) {
    await endPreview(preview);
  }
}

export type PublicPreview = {
  status: 'active' | 'ended';
  appSlug: string;
  bundleVersion: string;
  runtimeVersion: string | null;
  expiresAt: string;
  deepLink: string | null;
  exitLink: string | null;
};

/** What the public preview page may show for a token; null for unknown tokens. */
export async function getPublicPreview(token: string): Promise<PublicPreview | null> {
  if (!isPreviewToken(token)) return null;
  const preview = await db.bundlePreview.findUnique({
    where: { token },
    include: {
      bundle: { select: { version: true, runtimeVersion: true } },
      app: { select: { slug: true, previewUrlScheme: true } },
    },
  });
  if (!preview) return null;
  const active = preview.endedAt === null && preview.expiresAt > new Date();
  const scheme = preview.app.previewUrlScheme;
  return {
    status: active ? 'active' : 'ended',
    appSlug: preview.app.slug,
    bundleVersion: preview.bundle.version,
    runtimeVersion: preview.bundle.runtimeVersion,
    expiresAt: preview.expiresAt.toISOString(),
    deepLink: active && scheme ? previewDeepLink(scheme, token) : null,
    exitLink: scheme ? previewExitLink(scheme) : null,
  };
}

function usageBlocked(): OtaKitServiceError {
  return new OtaKitServiceError(
    'USAGE_BLOCKED',
    'This workspace has reached its usage limit, so no update can be served',
    402,
    'Upgrade the plan or wait for the next billing period.',
  );
}
