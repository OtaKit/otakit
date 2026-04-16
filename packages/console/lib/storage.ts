import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_MAX_BUNDLE_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_PRESIGN_EXPIRES_SECONDS = 3600; // 1 hour
export const BUNDLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export class UploadedObjectNotFoundError extends Error {
  constructor(message: string = 'Uploaded bundle object not found in storage') {
    super(message);
    this.name = 'UploadedObjectNotFoundError';
  }
}

type StorageConfig = {
  client: S3Client;
  bucket: string;
  maxBundleSize: number;
  presignExpiresSeconds: number;
};

let cachedConfig: StorageConfig | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getStorageConfig(): StorageConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const bucket = requiredEnv('R2_BUCKET');
  const accessKeyId = requiredEnv('R2_ACCESS_KEY');
  const secretAccessKey = requiredEnv('R2_SECRET_KEY');

  const endpoint =
    process.env.R2_ENDPOINT ??
    (process.env.R2_ACCOUNT_ID
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined);

  const client = new S3Client({
    region: process.env.R2_REGION ?? 'auto',
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  const maxBundleSize = Number.parseInt(
    process.env.MAX_BUNDLE_SIZE ?? `${DEFAULT_MAX_BUNDLE_SIZE}`,
    10,
  );
  const presignExpiresSeconds = Number.parseInt(
    process.env.PRESIGN_EXPIRES_SECONDS ?? `${DEFAULT_PRESIGN_EXPIRES_SECONDS}`,
    10,
  );

  cachedConfig = {
    client,
    bucket,
    maxBundleSize,
    presignExpiresSeconds,
  };

  return cachedConfig;
}

export function getMaxBundleSize(): number {
  return getStorageConfig().maxBundleSize;
}

export async function createPresignedUpload(
  appId: string,
  uploadId: string,
  size: number,
): Promise<{ presignedUrl: string; storageKey: string; expiresAt: Date }> {
  const { client, bucket, presignExpiresSeconds } = getStorageConfig();

  const storageKey = `bundles/${appId}/${uploadId}.zip`;
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: 'application/zip',
    ContentLength: size,
    CacheControl: BUNDLE_CACHE_CONTROL,
  });

  const presignedUrl = await getSignedUrl(client, command, {
    expiresIn: presignExpiresSeconds,
  });

  return {
    presignedUrl,
    storageKey,
    expiresAt: new Date(Date.now() + presignExpiresSeconds * 1000),
  };
}

export async function inspectUploadedObject(storageKey: string): Promise<{ size: number }> {
  const { client, bucket, maxBundleSize } = getStorageConfig();

  let headResponse;
  try {
    headResponse = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: storageKey,
      }),
    );
  } catch (error) {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      '$metadata' in error &&
      typeof (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode ===
        'number'
        ? (error as { $metadata: { httpStatusCode: number } }).$metadata.httpStatusCode
        : undefined;
    const errorName =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name)
        : '';

    if (statusCode === 404 || errorName === 'NotFound' || errorName === 'NoSuchKey') {
      throw new UploadedObjectNotFoundError();
    }

    throw error;
  }

  const size = headResponse.ContentLength ?? 0;
  if (size <= 0) {
    throw new Error('Uploaded bundle is empty');
  }
  if (size > maxBundleSize) {
    throw new Error(`Bundle too large: ${size} bytes (max ${maxBundleSize} bytes)`);
  }

  return { size };
}

function getCdnBaseUrl(): string {
  return requiredEnv('CDN_BASE_URL').trim().replace(/\/+$/, '');
}

function encodeStorageKeyForUrl(storageKey: string): string {
  return storageKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function buildPublicObjectUrl(storageKey: string): string {
  return `${getCdnBaseUrl()}/${encodeStorageKeyForUrl(storageKey)}`;
}

export async function putTextObject(args: {
  storageKey: string;
  body: string;
  contentType: string;
  cacheControl?: string;
}): Promise<void> {
  const { client, bucket } = getStorageConfig();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.storageKey,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: args.cacheControl,
    }),
  );
}

export async function deleteStorageObject(storageKey: string): Promise<void> {
  const { client, bucket } = getStorageConfig();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }),
  );
}

export async function listStorageKeys(prefix: string): Promise<string[]> {
  const { client, bucket } = getStorageConfig();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const entry of response.Contents ?? []) {
      if (entry.Key) {
        keys.push(entry.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

export async function deleteBundleObject(storageKey: string): Promise<void> {
  await deleteStorageObject(storageKey);
}
