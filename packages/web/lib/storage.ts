import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_MAX_BUNDLE_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_PRESIGN_EXPIRES_SECONDS = 3600; // 1 hour

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

const DEFAULT_DOWNLOAD_URL_TTL = 600; // 10 minutes

export async function createSignedDownloadUrl(
  storageKey: string,
  ttlSeconds: number = DEFAULT_DOWNLOAD_URL_TTL,
): Promise<string> {
  const { client, bucket } = getStorageConfig();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
  });

  return getSignedUrl(client, command, { expiresIn: ttlSeconds });
}

export async function deleteBundleObject(storageKey: string): Promise<void> {
  const { client, bucket } = getStorageConfig();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: storageKey,
    }),
  );
}
