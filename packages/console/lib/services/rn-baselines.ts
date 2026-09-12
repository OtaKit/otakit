import { isDeepStrictEqual } from 'node:util';
import { db } from '@/lib/db';
import { parseRNInventory, hashInventory } from '@otakit/rn-protocol';
import {
  buildPublicObjectUrl,
  getMaxBundleSize,
  statStorageObject,
  buildFileObjectKey,
} from '@/lib/storage';
import { parseBundleEncryption } from '@/lib/validation';
import { assertRNTarget, resolveRNBaseline } from './rn-releases';
import { OtaKitServiceError } from './errors';
import { serializeRNUpload } from './rn-uploads';

export async function prepareBaselineAdoption(appId: string, body: Record<string, unknown>) {
  const app = await db.app.findUnique({ where: { id: appId }, select: { framework: true } });
  if (app?.framework !== 'react_native')
    throw new OtaKitServiceError('INVALID_INPUT', 'Baseline adoption requires an RN app', 400);
  assertRNTarget(body.platform, body.runtimeVersion);
  if (typeof body.version !== 'string')
    throw new OtaKitServiceError('INVALID_INPUT', 'Missing baseline version', 400);
  const inventory = parseRNInventory(body.files, getMaxBundleSize());
  if (!inventory.ok) throw new OtaKitServiceError('INVALID_INPUT', inventory.error, 400);
  const bundle = await db.bundle.findFirst({
    where: {
      appId,
      platform: body.platform,
      runtimeVersion: body.runtimeVersion as string,
      version: body.version,
    },
  });
  if (!bundle)
    throw new OtaKitServiceError(
      'BUNDLE_NOT_FOUND',
      'Archived baseline has not been uploaded',
      404,
    );
  const baseline = await resolveRNBaseline(db, bundle);
  const encryption = parseBundleEncryption(bundle.encryption);
  const byPath = (files: typeof inventory.files) =>
    files.slice().sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (
    baseline.id !== bundle.id ||
    bundle.embeddedReceipt === null ||
    bundle.contentHash !== body.contentHash ||
    hashInventory(inventory.files) !== bundle.contentHash ||
    !isDeepStrictEqual(
      byPath(inventory.files),
      byPath(bundle.contentFiles as unknown as typeof inventory.files),
    ) ||
    !isDeepStrictEqual(body.embeddedReceipt, bundle.embeddedReceipt) ||
    body.strategy !== bundle.strategy ||
    body.encryptionKid !== (encryption?.kid ?? null)
  )
    throw new OtaKitServiceError(
      'RN_UPLOAD_CONFLICT',
      'Stored baseline content or encryption policy differs from the archived build',
      409,
    );
  const object = await statStorageObject(bundle.storageKey);
  if (!object || (bundle.strategy === 'zip' && object.size !== bundle.size))
    throw new OtaKitServiceError(
      'RN_UPLOAD_CONFLICT',
      'Stored baseline object is missing or has the wrong size',
      409,
    );
  return {
    ...serializeRNUpload(bundle),
    files: inventory.files,
    downloadUrl: buildPublicObjectUrl(bundle.storageKey),
    ...(bundle.strategy === 'deltas'
      ? {
          fileUrls: inventory.files.map((file) => ({
            ...file,
            url: buildPublicObjectUrl(buildFileObjectKey(appId, file.sha256)),
          })),
        }
      : {}),
    verificationRequired: true,
  };
}
