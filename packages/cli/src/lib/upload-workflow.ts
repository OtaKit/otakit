import { createReadStream, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, posix, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import type { ApiClient, Bundle, DeltaFileDescriptor } from './api.js';
import { CliError } from './errors.js';
import { hashFile, hashFileWithMd5 } from './hash.js';
import { getCliUserAgent } from './version.js';
import { createZip, removeFileIfExists, validateBundleDirectory } from './zip.js';

const MAX_VERSION_LENGTH = 64;
const MAX_DELTA_FILES = 5000; // mirrors the server cap (console/lib/delta-files.ts)

const COMMIT_ENV_KEYS = [
  'OTAKIT_COMMIT_SHA',
  'GITHUB_SHA',
  'CI_COMMIT_SHA',
  'BUILDKITE_COMMIT',
  'BITBUCKET_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
];

const RUN_ENV_KEYS = [
  'OTAKIT_RUN_ID',
  'GITHUB_RUN_NUMBER',
  'GITHUB_RUN_ID',
  'CI_PIPELINE_IID',
  'CI_PIPELINE_ID',
  'BUILD_NUMBER',
  'BUILDKITE_BUILD_NUMBER',
];

export type VersionSource = 'flag' | 'env' | 'auto';

export type ResolvedVersion = {
  value: string;
  source: VersionSource;
};

export function resolveBundlePath(
  explicit: string | undefined,
  config: { outputDir?: string },
): string {
  if (explicit) {
    return resolve(explicit);
  }

  if (config.outputDir) {
    return resolve(config.outputDir);
  }

  throw new CliError(
    [
      'No bundle path found. Provide it using one of:',
      '  1. otakit upload <path>',
      '  2. Set webDir in capacitor.config.*',
      '  3. Set OTAKIT_BUILD_DIR or OTAKIT_OUTPUT_DIR in your environment',
    ].join('\n'),
  );
}

export async function resolveVersion(
  explicit: string | undefined,
  options?: {
    strict?: boolean;
    bundlePath?: string;
  },
): Promise<ResolvedVersion> {
  const explicitVersion = validateVersion(explicit, '--version');
  if (explicitVersion) {
    return { value: explicitVersion, source: 'flag' };
  }

  const envVersion = validateVersion(process.env.OTAKIT_VERSION, 'OTAKIT_VERSION');
  if (envVersion) {
    return { value: envVersion, source: 'env' };
  }

  if (isStrictVersionMode(options?.strict)) {
    throw new CliError(
      [
        'Strict version mode is enabled but no version was provided.',
        '- Pass --version <value>',
        '- or set OTAKIT_VERSION',
      ].join('\n'),
    );
  }

  return {
    value: buildAutoVersion(options?.bundlePath),
    source: 'auto',
  };
}

async function uploadFileToPresignedUrl(filePath: string, presignedUrl: string): Promise<void> {
  const fileStat = await stat(filePath);
  const body = createReadStream(filePath);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const requestOptions: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    body,
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(fileStat.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'User-Agent': getCliUserAgent(),
    },
    duplex: 'half',
  };

  try {
    const response = await fetch(presignedUrl, requestOptions);

    if (!response.ok) {
      const message = await response.text();
      throw new CliError(`Upload failed (${response.status}): ${message || 'unknown error'}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export type UploadWorkflowOptions = {
  api: ApiClient;
  sourcePath: string;
  version: string;
  runtimeVersion?: string;
  releaseChannel?: string | null;
  strategy?: 'zip' | 'deltas';
  onStatus?: (message: string) => void;
};

export type UploadWorkflowResult = {
  bundle: Bundle;
  releaseChannel?: string | null;
};

export async function runUploadWorkflow(
  options: UploadWorkflowOptions,
): Promise<UploadWorkflowResult> {
  if (options.strategy === 'deltas') {
    return runDeltaUploadWorkflow(options);
  }

  const { api, sourcePath, version, runtimeVersion, releaseChannel, onStatus } = options;

  validateBundleDirectory(sourcePath);

  const tempZipPath = join(tmpdir(), `otakit-${version}-${randomUUID()}.zip`);

  const cleanup = () => {
    try {
      unlinkSync(tempZipPath);
    } catch {
      // Best-effort cleanup — the temp zip may never have been created.
    }
    process.exit(1);
  };
  process.on('SIGINT', cleanup);

  try {
    onStatus?.('Creating zip archive...');
    await createZip(sourcePath, tempZipPath);

    onStatus?.('Calculating SHA-256 checksum...');
    const sha256 = await hashFile(tempZipPath);
    const zipStat = await stat(tempZipPath);

    onStatus?.('Requesting upload URL...');
    const initiated = await api.initiateUpload({
      version,
      runtimeVersion,
      size: zipStat.size,
      sha256,
    });

    const expiresAt = new Date(initiated.expiresAt);
    if (expiresAt.getTime() - Date.now() < 60_000) {
      throw new CliError('Presigned upload URL has expired or is about to expire. Please retry.');
    }

    onStatus?.('Uploading bundle...');
    await uploadFileToPresignedUrl(tempZipPath, initiated.presignedUrl);

    onStatus?.('Finalizing...');
    const bundle = await api.finalizeUpload({
      uploadId: initiated.uploadId,
    });

    if (releaseChannel !== undefined) {
      onStatus?.(`Releasing to ${releaseChannel ?? 'base channel'}...`);
      await api.release(releaseChannel, bundle.id);
    }

    return { bundle, releaseChannel };
  } finally {
    process.off('SIGINT', cleanup);
    await removeFileIfExists(tempZipPath);
  }
}

/**
 * Walk a bundle directory into relative posix file descriptors.
 * Mirrors the zip walker's rules: symlinks are rejected, empty files included.
 */
export async function collectDeltaFiles(sourceDirectory: string): Promise<DeltaFileDescriptor[]> {
  const files: DeltaFileDescriptor[] = [];

  const walk = async (relativePath: string): Promise<void> => {
    const currentPath = join(sourceDirectory, relativePath);
    const entries = readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const nextRelativePath = relativePath ? join(relativePath, entry.name) : entry.name;
      const absolutePath = join(sourceDirectory, nextRelativePath);
      const posixPath = nextRelativePath.split('\\').join(posix.sep);

      if (entry.isSymbolicLink()) {
        throw new CliError(
          [
            `Unsupported symlink in bundle output: ${posixPath}`,
            'Remove symlinks from the web build output before uploading.',
          ].join('\n'),
        );
      }
      if (entry.isDirectory()) {
        await walk(nextRelativePath);
        continue;
      }
      if (entry.isFile()) {
        const fileStat = await stat(absolutePath);
        const hashes = await hashFileWithMd5(absolutePath);
        files.push({
          path: posixPath,
          sha256: hashes.sha256,
          size: fileStat.size,
          md5: hashes.md5,
        });
      }
    }
  };

  await walk('');
  return files;
}

async function uploadDeltaFileToPresignedUrl(
  filePath: string,
  size: number,
  md5: string,
  presignedUrl: string,
): Promise<void> {
  const body = createReadStream(filePath);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300_000);

  const requestOptions: RequestInit & { duplex?: 'half' } = {
    method: 'PUT',
    body,
    signal: controller.signal,
    headers: {
      // Must match the headers pinned into the presigned signature
      // (console/lib/storage.ts::createPresignedFileUpload).
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-MD5': md5,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'User-Agent': getCliUserAgent(),
    },
    duplex: 'half',
  };

  try {
    const response = await fetch(presignedUrl, requestOptions);
    if (!response.ok) {
      const message = await response.text();
      throw new CliError(`File upload failed (${response.status}): ${message || 'unknown error'}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

const DELTA_UPLOAD_CONCURRENCY = 8;

async function runDeltaUploadWorkflow(
  options: UploadWorkflowOptions,
): Promise<UploadWorkflowResult> {
  const { api, sourcePath, version, runtimeVersion, releaseChannel, onStatus } = options;

  validateBundleDirectory(sourcePath);

  onStatus?.('Hashing bundle files...');
  const files = await collectDeltaFiles(sourcePath);
  if (files.length === 0) {
    throw new CliError(`No files found in ${sourcePath}`);
  }
  if (files.length > MAX_DELTA_FILES) {
    throw new CliError(
      `Too many files for the delta strategy: ${files.length} (max ${MAX_DELTA_FILES}). ` +
        'Consider updateStrategy: "zip" for this app.',
    );
  }

  onStatus?.(`Requesting delta upload for ${files.length} files...`);
  const initiated = await api.initiateDeltaUpload({
    version,
    runtimeVersion,
    files,
  });

  const expiresAt = new Date(initiated.expiresAt);
  if (expiresAt.getTime() - Date.now() < 60_000) {
    throw new CliError('Presigned upload URLs have expired or are about to expire. Please retry.');
  }

  const pathByHash = new Map<string, { path: string; size: number; md5: string }>();
  for (const file of files) {
    if (!pathByHash.has(file.sha256)) {
      pathByHash.set(file.sha256, { path: file.path, size: file.size, md5: file.md5 });
    }
  }

  const uploads = initiated.uploads;
  if (uploads.length > 0) {
    onStatus?.(`Uploading ${uploads.length} new files (${files.length} total)...`);
    let uploaded = 0;
    for (let index = 0; index < uploads.length; index += DELTA_UPLOAD_CONCURRENCY) {
      const chunk = uploads.slice(index, index + DELTA_UPLOAD_CONCURRENCY);
      await Promise.all(
        chunk.map(async (upload) => {
          const source = pathByHash.get(upload.sha256);
          if (!source) {
            throw new CliError(`Server requested unknown file hash: ${upload.sha256}`);
          }
          await uploadDeltaFileToPresignedUrl(
            join(sourcePath, source.path),
            source.size,
            source.md5,
            upload.presignedUrl,
          );
          uploaded += 1;
          onStatus?.(`Uploading new files: ${uploaded}/${uploads.length}`);
        }),
      );
    }
  } else {
    onStatus?.('All files already uploaded (content reuse) — skipping upload.');
  }

  onStatus?.('Finalizing...');
  const bundle = await api.finalizeDeltaUpload({ uploadId: initiated.uploadId });

  if (releaseChannel !== undefined) {
    onStatus?.(`Releasing to ${releaseChannel ?? 'base channel'}...`);
    await api.release(releaseChannel, bundle.id);
  }

  return { bundle, releaseChannel };
}

function validateVersion(value: string | undefined, label: string): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/\s/.test(trimmed)) {
    throw new CliError(`${label} cannot contain whitespace.`);
  }

  if (trimmed.length > MAX_VERSION_LENGTH) {
    throw new CliError(`${label} exceeds ${MAX_VERSION_LENGTH} characters.`);
  }

  return trimmed;
}

function buildAutoVersion(bundlePath?: string): string {
  const baseVersion = normalizeBaseVersion(
    process.env.OTAKIT_BASE_VERSION?.trim() || readNearestPackageVersion(bundlePath) || '0.0.0',
  );

  const commitPart = normalizeToken(resolveCommitRef() ?? 'local', 12, 'local');
  const runPart = normalizeToken(resolveRunRef() ?? utcCompactTimestamp(), 20, 'run');

  const suffix = `+otk.${commitPart}.${runPart}`;
  const maxBaseLength = Math.max(1, MAX_VERSION_LENGTH - suffix.length);
  const compactBase = baseVersion.slice(0, maxBaseLength);
  const candidate = `${compactBase}${suffix}`;

  const validated = validateVersion(candidate, 'auto-generated version');
  if (!validated) {
    throw new CliError('Failed to generate a valid version.');
  }
  return validated;
}

function normalizeBaseVersion(value: string): string {
  const withoutMetadata = value.split('+')[0]?.trim() || '0.0.0';
  const compact = withoutMetadata.replace(/\s+/g, '-');
  return compact.length > 0 ? compact : '0.0.0';
}

function readNearestPackageVersion(startPath?: string): string | null {
  let currentDir = resolve(startPath ?? process.cwd());

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json');

    try {
      const raw = readFileSync(packageJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) {
        return parsed.version.trim();
      }
    } catch {
      // Keep walking upward until we find package metadata or hit the filesystem root.
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function isStrictVersionMode(explicitStrict: boolean | undefined): boolean {
  if (explicitStrict) {
    return true;
  }

  const raw = process.env.OTAKIT_STRICT_VERSION?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveCommitRef(): string | null {
  for (const key of COMMIT_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  try {
    const fromGit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return fromGit.length > 0 ? fromGit : null;
  } catch {
    return null;
  }
}

function resolveRunRef(): string | null {
  for (const key of RUN_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function normalizeToken(value: string, maxLength: number, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length === 0) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function utcCompactTimestamp(): string {
  const now = new Date();
  const pad = (num: number) => String(num).padStart(2, '0');

  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    't',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
    'z',
  ].join('');
}
