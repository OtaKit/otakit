import { isDeepStrictEqual } from 'node:util';
import { Prisma, type Bundle, type UploadSession } from '@prisma/client';

import { db } from '@/lib/db';
import {
  computeFilesHash,
  parseDeltaFiles,
  uniqueHashes,
  type DeltaFileEntry,
} from '@/lib/delta-files';
import { parseRNInventory } from '@/lib/rn-inventory';
import {
  BUNDLE_CACHE_CONTROL,
  createPresignedUpload,
  createPresignedFileUpload,
  buildFileObjectKey,
  getMaxBundleSize,
  inspectUploadedObject,
  putTextObject,
  statStorageObject,
  UploadedObjectNotFoundError,
} from '@/lib/storage';
import { parseBundleEncryption } from '@/lib/validation';
import { OtaKitServiceError } from './errors';
import {
  assertRNArtifactIdentity,
  assertRNTarget,
  resolveRNBaseline,
  type RNArtifact,
} from './rn-releases';

export async function getUploadFramework(appId: string, platform?: unknown) {
  const app = await db.app.findUnique({ where: { id: appId }, select: { framework: true } });
  if (!app) throw new OtaKitServiceError('APP_NOT_FOUND', 'App not found', 404);
  if (app.framework === 'capacitor' && platform !== undefined && platform !== 'cross')
    throw new OtaKitServiceError('INVALID_LANE', 'Capacitor uploads require the cross target', 400);
  return app.framework;
}

export async function prepareRNUpload(
  appId: string,
  body: Record<string, unknown>,
  transfer: {
    version: string;
    sha256: string;
    size: number;
    strategy: 'zip' | 'deltas';
    encryption?: unknown;
  },
) {
  assertRNTarget(body.platform, body.runtimeVersion);
  const parsed = parseRNInventory(body.files, getMaxBundleSize());
  if (!parsed.ok) throw new OtaKitServiceError('INVALID_INPUT', parsed.error, 400);
  if (body.contentHash !== computeFilesHash(parsed.files))
    throw new OtaKitServiceError('INVALID_INPUT', 'RN contentHash differs from its inventory', 400);
  if (
    body.baselineBundleId != null &&
    (typeof body.baselineBundleId !== 'string' || !body.baselineBundleId)
  )
    throw new OtaKitServiceError('RN_BASELINE_REQUIRED', 'Invalid RN baseline bundle ID', 400);

  const artifact: RNArtifact = {
    id: 'pending-upload',
    appId,
    ...transfer,
    platform: body.platform,
    runtimeVersion: body.runtimeVersion as string,
    encryption: (transfer.encryption ?? null) as Prisma.JsonValue,
    contentHash: body.contentHash as string,
    contentFiles: parsed.files as unknown as Prisma.JsonValue,
    embeddedReceipt: (body.embeddedReceipt ?? null) as Prisma.JsonValue,
    baselineBundleId: (body.baselineBundleId ?? null) as string | null,
  };
  await resolveRNBaseline(db, artifact);
  // Keep only the typed native identity, never arbitrary fields from metadata.
  const embeddedReceipt =
    artifact.embeddedReceipt === null
      ? undefined
      : {
          appId,
          framework: 'react-native',
          platform: artifact.platform,
          runtimeVersion: artifact.runtimeVersion,
          version: artifact.version,
          embeddedContentHash: artifact.contentHash,
        };
  return {
    platform: artifact.platform,
    contentHash: artifact.contentHash,
    files: parsed.files as unknown as Prisma.InputJsonValue,
    embeddedReceipt,
    baselineBundleId: artifact.baselineBundleId,
  };
}

function sessionArtifact(session: UploadSession): RNArtifact {
  return {
    id: session.bundleId ?? 'pending-upload',
    appId: session.appId,
    version: session.version,
    platform: session.platform,
    runtimeVersion: session.runtimeVersion,
    sha256: session.expectedSha256,
    size: session.expectedSize,
    strategy: session.strategy,
    encryption: session.encryption,
    contentHash: session.contentHash,
    contentFiles: session.files,
    embeddedReceipt: session.embeddedReceipt,
    baselineBundleId: session.baselineBundleId,
  };
}

function assertSameArtifact(bundle: Bundle, expected: RNArtifact) {
  assertRNArtifactIdentity(bundle);
  const scalarFields = [
    'appId',
    'version',
    'platform',
    'runtimeVersion',
    'sha256',
    'contentHash',
    'size',
    'strategy',
    'baselineBundleId',
  ] as const;
  const inventory = (value: Prisma.JsonValue | null) =>
    (value as unknown as DeltaFileEntry[])
      .slice()
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (
    scalarFields.some((field) => bundle[field] !== expected[field]) ||
    !isDeepStrictEqual(
      parseBundleEncryption(bundle.encryption),
      parseBundleEncryption(expected.encryption),
    ) ||
    !isDeepStrictEqual(bundle.embeddedReceipt, expected.embeddedReceipt) ||
    !Array.isArray(bundle.contentFiles) ||
    !isDeepStrictEqual(inventory(bundle.contentFiles), inventory(expected.contentFiles))
  ) {
    throw new OtaKitServiceError(
      'RN_UPLOAD_CONFLICT',
      'An RN bundle with this version has different artifact identity; reconcile the upload or explicitly adopt a matching baseline',
      409,
    );
  }
}

export function serializeRNUpload(bundle: Bundle) {
  return {
    id: bundle.id,
    appId: bundle.appId,
    framework: 'react-native',
    version: bundle.version,
    platform: bundle.platform,
    runtimeVersion: bundle.runtimeVersion,
    sha256: bundle.sha256,
    contentHash: bundle.contentHash,
    size: bundle.size,
    strategy: bundle.strategy,
    encryption: bundle.encryption,
    embeddedReceipt: bundle.embeddedReceipt,
    baselineBundleId: bundle.baselineBundleId,
    createdAt: bundle.createdAt.toISOString(),
  };
}

/** Refresh upload capability without creating a new session or extending its lifetime. */
export async function resumeRNZipUpload(appId: string, uploadId: string) {
  if ((await getUploadFramework(appId)) !== 'react_native')
    throw new OtaKitServiceError('INVALID_INPUT', 'Upload resume requires an RN app', 400);
  const session = await db.uploadSession.findFirst({ where: { id: uploadId, appId } });
  if (!session || session.platform === 'cross' || session.strategy !== 'zip')
    throw new OtaKitServiceError('INVALID_INPUT', 'RN ZIP upload session not found', 404);
  const artifact = sessionArtifact(session);
  await resolveRNBaseline(db, artifact);
  if (session.status === 'finalized') {
    const { bundle } = await finalizeRNUpload(session, 'zip');
    return { state: 'finalized' as const, uploadId, bundle: serializeRNUpload(bundle) };
  }
  if (session.status !== 'initiated' || session.expiresAt.getTime() <= Date.now())
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'Upload expired; reconcile the original session',
      410,
    );
  const signed = await createPresignedUpload(appId, uploadId, session.expectedSize);
  if (signed.storageKey !== session.storageKey)
    throw new OtaKitServiceError('RN_UPLOAD_CONFLICT', 'Upload storage location changed', 409);
  return {
    state: 'pending' as const,
    uploadId,
    presignedUrl: signed.presignedUrl,
    expiresAt: new Date(
      Math.min(signed.expiresAt.getTime(), session.expiresAt.getTime()),
    ).toISOString(),
    declaration: {
      appId,
      framework: 'react-native' as const,
      platform: session.platform,
      runtimeVersion: session.runtimeVersion,
      version: session.version,
      contentHash: session.contentHash,
      sha256: session.expectedSha256,
      size: session.expectedSize,
      strategy: 'zip' as const,
      files: session.files,
      embeddedReceipt: session.embeddedReceipt,
      baselineBundleId: session.baselineBundleId,
      encryption: session.encryption,
    },
  };
}

/** Refresh only the original delta session's missing objects; never extend its lifetime. */
export async function resumeRNDeltaUpload(appId: string, uploadId: string, files: unknown) {
  if ((await getUploadFramework(appId)) !== 'react_native')
    throw new OtaKitServiceError('INVALID_INPUT', 'Upload resume requires an RN app', 400);
  const session = await db.uploadSession.findFirst({ where: { id: uploadId, appId } });
  if (!session || session.platform === 'cross' || session.strategy !== 'deltas')
    throw new OtaKitServiceError('INVALID_INPUT', 'RN delta upload session not found', 404);
  const parsed = parseDeltaFiles(files, 'react_native');
  if (!parsed.ok || !isDeepStrictEqual(parsed.files, session.files))
    throw new OtaKitServiceError(
      'RN_UPLOAD_CONFLICT',
      'Delta inventory differs from the saved session',
      409,
    );
  const artifact = sessionArtifact(session);
  await resolveRNBaseline(db, artifact);
  if (session.status === 'finalized') {
    const { bundle } = await finalizeRNUpload(session, 'deltas');
    return { state: 'finalized' as const, uploadId, bundle: serializeRNUpload(bundle) };
  }
  if (session.status !== 'initiated' || session.expiresAt.getTime() <= Date.now())
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      'Upload expired; reconcile the original session',
      410,
    );
  const uploads: Array<{ sha256: string; presignedUrl: string }> = [];
  let expiresAt = session.expiresAt.getTime();
  const hashes = [...uniqueHashes(parsed.files)];
  for (let index = 0; index < hashes.length; index += 50) {
    const chunk = await Promise.all(
      hashes.slice(index, index + 50).map(async ([sha256, size]) => {
        const key = buildFileObjectKey(appId, sha256);
        const stat = await statStorageObject(key);
        if (stat?.size === size) return null;
        const signed = await createPresignedFileUpload(key, size, parsed.md5ByHash.get(sha256)!);
        return { sha256, presignedUrl: signed.presignedUrl, expiresAt: signed.expiresAt.getTime() };
      }),
    );
    for (const entry of chunk)
      if (entry) {
        uploads.push({ sha256: entry.sha256, presignedUrl: entry.presignedUrl });
        expiresAt = Math.min(expiresAt, entry.expiresAt);
      }
  }
  return {
    state: 'pending' as const,
    uploadId,
    uploads,
    expiresAt: new Date(expiresAt).toISOString(),
    declaration: {
      appId,
      framework: 'react-native' as const,
      platform: session.platform,
      runtimeVersion: session.runtimeVersion,
      version: session.version,
      contentHash: session.contentHash,
      sha256: session.expectedSha256,
      size: session.expectedSize,
      strategy: 'deltas' as const,
      files: session.files,
      embeddedReceipt: session.embeddedReceipt,
      baselineBundleId: session.baselineBundleId,
      encryption: session.encryption,
    },
  };
}

/** Both RN transports share identity, concurrency and finalize-retry rules. */
export async function finalizeRNUpload(session: UploadSession, strategy: 'zip' | 'deltas') {
  if (session.strategy !== strategy)
    throw new OtaKitServiceError(
      'INVALID_INPUT',
      `Use the ${session.strategy} finalization endpoint`,
      400,
    );
  const expected = sessionArtifact(session);
  const parsed = parseRNInventory(session.files, getMaxBundleSize());
  if (!parsed.ok) throw new OtaKitServiceError('RN_ARTIFACT_INVALID', parsed.error, 409);
  await resolveRNBaseline(db, expected);

  if (session.status !== 'finalized') {
    if (session.status === 'expired' || session.expiresAt < new Date())
      throw new OtaKitServiceError('INVALID_INPUT', 'Upload expired', 410);
    if (strategy === 'zip') {
      let info: { size: number };
      try {
        info = await inspectUploadedObject(session.storageKey);
      } catch (error) {
        if (error instanceof UploadedObjectNotFoundError)
          throw new OtaKitServiceError('INVALID_INPUT', error.message, 400);
        throw error;
      }
      if (info.size !== session.expectedSize)
        throw new OtaKitServiceError(
          'INVALID_INPUT',
          'Uploaded size differs from the RN declaration',
          400,
        );
    } else {
      const entries = [...uniqueHashes(parsed.files)];
      for (let index = 0; index < entries.length; index += 50) {
        await Promise.all(
          entries.slice(index, index + 50).map(async ([hash, size]) => {
            const stat = await statStorageObject(buildFileObjectKey(session.appId, hash));
            if (!stat || stat.size !== size)
              throw new OtaKitServiceError(
                'INVALID_INPUT',
                `Missing or wrong-sized RN file object: ${hash}`,
                400,
              );
          }),
        );
      }
      await putTextObject({
        storageKey: session.storageKey,
        body: JSON.stringify({
          version: session.version,
          filesHash: session.expectedSha256,
          files: parsed.files,
        }),
        contentType: 'application/json; charset=utf-8',
        cacheControl: BUNDLE_CACHE_CONTROL,
      });
    }
  }

  return db.$transaction(async (tx) => {
    // Serialize all sessions targeting this exact artifact identity.
    const key = `rn-upload:${JSON.stringify([session.appId, session.platform, session.runtimeVersion, session.version])}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const current = await tx.uploadSession.findUniqueOrThrow({ where: { id: session.id } });
    await resolveRNBaseline(tx, expected);
    if (current.status === 'finalized') {
      const bundle = current.bundleId
        ? await tx.bundle.findUnique({ where: { id: current.bundleId } })
        : null;
      if (!bundle)
        throw new OtaKitServiceError('RN_UPLOAD_CONFLICT', 'Finalized upload has no bundle', 409);
      assertSameArtifact(bundle, expected);
      return { bundle, created: false };
    }
    if (current.status === 'expired' || current.expiresAt < new Date())
      throw new OtaKitServiceError('INVALID_INPUT', 'Upload expired', 410);
    const existing = await tx.bundle.findFirst({
      where: {
        appId: session.appId,
        platform: session.platform,
        runtimeVersion: session.runtimeVersion,
        version: session.version,
      },
    });
    if (existing) assertSameArtifact(existing, expected);
    const bundle =
      existing ??
      (await tx.bundle.create({
        data: {
          appId: expected.appId,
          version: expected.version,
          platform: expected.platform,
          runtimeVersion: expected.runtimeVersion,
          sha256: expected.sha256,
          size: expected.size,
          strategy,
          storageKey: session.storageKey,
          contentHash: expected.contentHash,
          contentFiles: expected.contentFiles as Prisma.InputJsonValue,
          embeddedReceipt: expected.embeddedReceipt ?? Prisma.DbNull,
          baselineBundleId: expected.baselineBundleId,
          encryption: expected.encryption ?? Prisma.DbNull,
          metadata: session.metadata ?? Prisma.DbNull,
          nativePackages: session.nativePackages ?? Prisma.DbNull,
        },
      }));
    await tx.uploadSession.update({
      where: { id: current.id },
      data: {
        status: 'finalized',
        actualSize: expected.size,
        finalizedAt: new Date(),
        bundleId: bundle.id,
      },
    });
    return { bundle, created: !existing };
  });
}
