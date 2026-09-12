import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import {
  canonicalJSON,
  hashInventory,
  type DeltaFileEntry,
  type EmbeddedReceipt,
  type RNPlatform,
} from '@otakit/rn-protocol';
import type { ApiClient, Bundle } from '../api.js';
import { deriveKid, encryptFile, type BundleEncryptionParams } from '../crypto.js';
import { hashBuffer } from '../hash.js';
import { adoptBaseline, baselineIdentity } from './baseline-adoption.js';
import { decryptRNArchive, MAX_RN_PAYLOAD, readRNArchive, verifyRNArchive } from './artifacts.js';
import { assertOutputOutside, type CompletedNativeBuild } from './completed-build.js';
import type { OTAExportReceipt } from './export-receipt.js';
import {
  assertUploadProvenance,
  readOTAUploadExport,
  readUploadArchive,
} from './upload-artifact.js';
import { withReceiptLock, writeReceipt } from './receipts.js';

export interface UploadScope {
  serverUrl: string;
  organizationId: string;
  actorKey: string;
}
export interface UploadDeclaration {
  appId: string;
  framework: 'react-native';
  platform: RNPlatform;
  runtimeVersion: string;
  version: string;
  contentHash: string;
  files: DeltaFileEntry[];
  sha256: string;
  size: number;
  strategy: 'zip' | 'deltas';
  encryption: BundleEncryptionParams | null;
  embeddedReceipt: EmbeddedReceipt | null;
  baselineBundleId: string | null;
}
export interface UploadedArtifact extends Omit<UploadDeclaration, 'files'> {
  id: string;
}
export type ResumeUpload =
  | {
      state: 'pending';
      uploadId: string;
      presignedUrl: string;
      expiresAt: string;
      declaration: UploadDeclaration;
    }
  | { state: 'finalized'; uploadId: string; bundle: UploadedArtifact };
export type ResumeDeltaUpload =
  | {
      state: 'pending';
      uploadId: string;
      uploads: Array<{ sha256: string; presignedUrl: string }>;
      expiresAt: string;
      declaration: UploadDeclaration;
    }
  | { state: 'finalized'; uploadId: string; bundle: UploadedArtifact };
interface ArtifactUpload {
  declaration: UploadDeclaration;
  state: 'prepared' | 'uploading' | 'finalizing' | 'finalized';
  uploadId: string | null;
  adopted?: boolean;
  bundle?: UploadedArtifact;
}
export interface RNUploadReceipt {
  format: 'otakit-rn-upload';
  version: 1;
  scope: UploadScope;
  exported: OTAExportReceipt;
  completedBuild: CompletedNativeBuild;
  baseline: ArtifactUpload;
  ota: ArtifactUpload;
}
type UploadAPI = Pick<
  ApiClient,
  | 'initiateUpload'
  | 'resumeRNZipUpload'
  | 'finalizeUpload'
  | 'prepareBaselineAdoption'
  | 'initiateDeltaUpload'
  | 'resumeRNDeltaUpload'
  | 'finalizeDeltaUpload'
>;
type ResumeOptions = {
  directory: string;
  scope: UploadScope;
  encryptionKey: Buffer | null;
  api: UploadAPI;
  fetcher?: typeof fetch;
  expectedIdentity?: string;
};
const roles = ['baseline', 'ota'] as const;
const same = (a: unknown, b: unknown) =>
  a !== undefined && b !== undefined && canonicalJSON(a) === canonicalJSON(b);

export function normalizeUploadScope(value: UploadScope): UploadScope {
  const url = new URL(value.serverUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
    typeof value.organizationId !== 'string' ||
    !value.organizationId ||
    typeof value.actorKey !== 'string' ||
    !value.actorKey
  )
    throw new Error('Invalid RN upload scope');
  return {
    organizationId: value.organizationId,
    actorKey: value.actorKey,
    serverUrl: url.toString().replace(/\/$/, ''),
  };
}
function assertBundle(
  value: Bundle | UploadedArtifact,
  declaration: UploadDeclaration,
): asserts value is UploadedArtifact {
  if (!value || typeof value.id !== 'string' || !value.id)
    throw new Error('RN upload returned no bundle identity');
  for (const key of [
    'appId',
    'framework',
    'platform',
    'runtimeVersion',
    'version',
    'contentHash',
    'sha256',
    'size',
    'strategy',
    'encryption',
    'embeddedReceipt',
    'baselineBundleId',
  ] as const)
    if (!same(value[key], declaration[key]))
      throw new Error(`RN finalized bundle differs from the saved ${key}`);
}
function bundleIdentity(value: UploadedArtifact): UploadedArtifact {
  const {
    id,
    appId,
    framework,
    platform,
    runtimeVersion,
    version,
    contentHash,
    sha256,
    size,
    strategy,
    encryption,
    embeddedReceipt,
    baselineBundleId,
  } = value;
  return {
    id,
    appId,
    framework,
    platform,
    runtimeVersion,
    version,
    contentHash,
    sha256,
    size,
    strategy,
    encryption,
    embeddedReceipt,
    baselineBundleId,
  };
}
async function writeBytes(path: string, bytes: Buffer) {
  const file = await open(path, 'wx', 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}

/** No upload is sent until both exact transport files and their receipt are durable. */
export async function prepareRNUpload(options: {
  exportDirectory: string;
  directory: string;
  scope: UploadScope;
  encryptionKey: Buffer | null;
  strategy?: 'zip' | 'deltas';
}): Promise<RNUploadReceipt> {
  const strategy = options.strategy ?? 'zip';
  if (!['zip', 'deltas'].includes(strategy)) throw new Error('Unsupported RN upload strategy');
  if (strategy === 'deltas' && options.encryptionKey)
    throw new Error('RN delta uploads do not support encryption; use ZIP to preserve encryption');
  await assertOutputOutside(options.exportDirectory, options.directory);
  const exported = await readOTAUploadExport(options.exportDirectory);
  const selectedScope = normalizeUploadScope(options.scope);
  const directory = resolve(options.directory);
  return withReceiptLock(`${directory}.prepare`, async () => {
    // Exclusive directory creation also prevents silently re-encrypting a previous attempt.
    await mkdir(directory, { mode: 0o700 });
    async function prepare(role: (typeof roles)[number]): Promise<ArtifactUpload> {
      const source = role === 'baseline' ? exported.completed.baseline : exported.receipt;
      const bytes = role === 'baseline' ? exported.baselineBytes : exported.otaBytes;
      const path = join(directory, `${role}.zip`);
      await writeBytes(path, bytes);
      let encryption: BundleEncryptionParams | null = null;
      if (options.encryptionKey) {
        const encrypted = `${path}.encrypted`;
        await writeBytes(encrypted, Buffer.alloc(0));
        encryption = await encryptFile(options.encryptionKey, path, encrypted);
        const handle = await open(encrypted, 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rm(path);
        await rename(encrypted, path);
      }
      const transport = await readFile(path);
      if (transport.length > MAX_RN_PAYLOAD)
        throw new Error('Encrypted RN archive exceeds upload limit');
      return {
        declaration: {
          appId: source.appId,
          framework: 'react-native',
          platform: source.platform,
          runtimeVersion: source.runtimeVersion,
          version: source.displayVersion,
          contentHash: source.contentHash,
          files: source.files,
          sha256: strategy === 'deltas' ? source.contentHash : hashBuffer(transport),
          size:
            strategy === 'deltas'
              ? source.files.reduce((total, file) => total + file.size, 0)
              : transport.length,
          strategy,
          encryption,
          embeddedReceipt: role === 'baseline' ? exported.completed.baseline.embeddedReceipt : null,
          baselineBundleId: null,
        },
        state: 'prepared',
        uploadId: null,
      };
    }
    const receipt: RNUploadReceipt = {
      format: 'otakit-rn-upload',
      version: 1,
      scope: selectedScope,
      exported: exported.receipt,
      completedBuild: exported.completed,
      baseline: await prepare('baseline'),
      ota: await prepare('ota'),
    };
    await writeReceipt(join(directory, 'upload.json'), receipt);
    const parent = await open(dirname(directory), 'r');
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return receipt;
  });
}

async function readUpload(options: Omit<ResumeOptions, 'api'>) {
  const receipt = JSON.parse(
    await readFile(join(options.directory, 'upload.json'), 'utf8'),
  ) as RNUploadReceipt;
  if (
    receipt?.format !== 'otakit-rn-upload' ||
    receipt.version !== 1 ||
    !same(receipt.scope, normalizeUploadScope(options.scope))
  )
    throw new Error('RN_UPLOAD_SCOPE_LOST: preserve the original server, organization and actor');
  assertUploadProvenance(receipt.exported, receipt.completedBuild);
  for (const role of roles) {
    const artifact = receipt[role];
    const expected = role === 'baseline' ? receipt.completedBuild.baseline : receipt.exported;
    const declaration = artifact?.declaration;
    if (
      !declaration ||
      !['prepared', 'uploading', 'finalizing', 'finalized'].includes(artifact.state) ||
      (artifact.uploadId !== null &&
        (typeof artifact.uploadId !== 'string' || !artifact.uploadId)) ||
      (artifact.state === 'prepared' && artifact.uploadId !== null) ||
      (artifact.state === 'finalizing' && !artifact.uploadId) ||
      (artifact.state === 'finalized' && !artifact.adopted && !artifact.uploadId) ||
      declaration.framework !== 'react-native' ||
      !['zip', 'deltas'].includes(declaration.strategy) ||
      (declaration.strategy === 'deltas' &&
        (declaration.encryption !== null ||
          declaration.sha256 !== declaration.contentHash ||
          declaration.size !== expected.files.reduce((total, file) => total + file.size, 0))) ||
      declaration.appId !== expected.appId ||
      declaration.platform !== expected.platform ||
      declaration.runtimeVersion !== expected.runtimeVersion ||
      declaration.version !== expected.displayVersion ||
      declaration.contentHash !== expected.contentHash ||
      !same(declaration.files, expected.files) ||
      hashInventory(declaration.files) !== declaration.contentHash ||
      !same(
        declaration.embeddedReceipt,
        role === 'baseline' ? receipt.completedBuild.baseline.embeddedReceipt : null,
      ) ||
      (role === 'baseline' && declaration.baselineBundleId !== null) ||
      (role === 'ota' &&
        declaration.baselineBundleId !== null &&
        declaration.baselineBundleId !== receipt.baseline.bundle?.id) ||
      (role === 'ota' && artifact.state !== 'prepared' && !declaration.baselineBundleId) ||
      (role === 'ota' &&
        declaration.baselineBundleId !== null &&
        receipt.baseline.state !== 'finalized') ||
      (declaration.encryption?.kid ?? null) !==
        (options.encryptionKey ? deriveKid(options.encryptionKey) : null)
    )
      throw new Error('RN upload declaration, state or encryption policy changed');
    const transport = await readUploadArchive(
      join(options.directory, `${role}.zip`),
      declaration.strategy === 'deltas' ? expected.sha256 : declaration.sha256,
      declaration.strategy === 'deltas' ? undefined : declaration.size,
    );
    const plain = declaration.encryption
      ? decryptRNArchive(transport, declaration.encryption, options.encryptionKey!)
      : transport;
    if (hashBuffer(plain) !== expected.sha256)
      throw new Error('Saved transport does not contain the archived export');
    await verifyRNArchive(plain, declaration.files);
    if (artifact.adopted) {
      if (role !== 'baseline' || artifact.state !== 'finalized')
        throw new Error('Invalid adopted baseline state');
      const adoption = JSON.parse(await readFile(join(options.directory, 'adoption.json'), 'utf8'));
      if (
        adoption.format !== 'otakit-rn-baseline-adoption' ||
        adoption.version !== 1 ||
        !same(bundleIdentity(adoption.bundle), artifact.bundle) ||
        !same(adoption.bundle.files, declaration.files) ||
        !same(adoption.bundle.embeddedReceipt, declaration.embeddedReceipt) ||
        adoption.bundle.contentHash !== declaration.contentHash ||
        adoption.bundle.strategy !== declaration.strategy ||
        (adoption.bundle.encryption?.kid ?? null) !== (declaration.encryption?.kid ?? null)
      )
        throw new Error('Adopted baseline no longer matches its verification receipt');
      assertBundle(artifact.bundle!, {
        ...declaration,
        sha256: adoption.bundle.sha256,
        size: adoption.bundle.size,
        encryption: adoption.bundle.encryption,
      });
    } else if (artifact.state === 'finalized') assertBundle(artifact.bundle!, declaration);
    else if (artifact.bundle) throw new Error('Unfinished RN upload contains a finalized result');
  }
  if (options.expectedIdentity && uploadIdentity(receipt) !== options.expectedIdentity)
    throw new Error('RN upload differs from the selected collection transport');
  return receipt;
}

/** Bind immutable content and transport; progress and a verified baseline binding may advance. */
export function uploadIdentity(receipt: RNUploadReceipt): string {
  return hashBuffer(
    Buffer.from(
      canonicalJSON({
        scope: receipt.scope,
        exported: receipt.exported,
        completedBuild: receipt.completedBuild,
        baseline: receipt.baseline.declaration,
        ota: { ...receipt.ota.declaration, baselineBundleId: null },
      }),
    ),
  );
}

export async function inspectRNUpload(
  options: Omit<ResumeOptions, 'api'>,
): Promise<RNUploadReceipt> {
  return withReceiptLock(join(options.directory, 'upload.json'), () => readUpload(options));
}

async function put(url: string, bytes: Buffer, fetcher: typeof fetch, md5?: string) {
  const parsed = new URL(url);
  if (
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      ))
  )
    throw new Error('RN upload requires HTTPS');
  const response = await fetcher(url, {
    method: 'PUT',
    body: new Uint8Array(bytes),
    redirect: 'error',
    signal: AbortSignal.timeout(300_000),
    headers: {
      'Content-Type': md5 ? 'application/octet-stream' : 'application/zip',
      ...(md5 ? { 'Content-MD5': md5 } : {}),
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  if (!response.ok) throw new Error(`RN storage upload failed (${response.status})`);
}

export async function uploadRNReceipt(options: ResumeOptions): Promise<RNUploadReceipt> {
  const path = join(options.directory, 'upload.json');
  return withReceiptLock(path, async () => {
    const receipt = await readUpload(options);
    for (const role of roles) {
      const artifact = receipt[role];
      if (artifact.state === 'finalized') continue;
      if (role === 'ota') {
        if (receipt.baseline.state !== 'finalized' || !receipt.baseline.bundle)
          throw new Error('Finalize or explicitly adopt the baseline first');
        artifact.declaration.baselineBundleId = receipt.baseline.bundle.id;
      }
      const d = artifact.declaration;
      const delta = d.strategy === 'deltas';
      const archived = role === 'baseline' ? receipt.completedBuild.baseline : receipt.exported;
      const readDelta = async () =>
        readRNArchive(
          await readUploadArchive(join(options.directory, `${role}.zip`), archived.sha256),
          d.files,
        );
      const content = delta && artifact.state !== 'finalizing' ? await readDelta() : null;
      const descriptors = content
        ? d.files.map((file) => ({
            ...file,
            md5: createHash('md5').update(content.get(file.sha256)!).digest('base64'),
          }))
        : [];
      if (!artifact.uploadId) {
        artifact.state = 'uploading';
        await writeReceipt(path, receipt);
        const common = {
          platform: d.platform,
          runtimeVersion: d.runtimeVersion,
          version: d.version,
          contentHash: d.contentHash,
          embeddedReceipt: d.embeddedReceipt ?? undefined,
          baselineBundleId: d.baselineBundleId ?? undefined,
        };
        const initiated = delta
          ? await options.api.initiateDeltaUpload({
              ...common,
              files: descriptors,
            })
          : await options.api.initiateUpload({
              ...common,
              sha256: d.sha256,
              size: d.size,
              files: d.files,
              encryption: d.encryption ?? undefined,
            });
        if (!initiated || typeof initiated.uploadId !== 'string' || !initiated.uploadId)
          throw new Error('RN initiation returned no upload ID');
        artifact.uploadId = initiated.uploadId;
        await writeReceipt(path, receipt);
      }
      if (artifact.state !== 'finalizing') {
        const resumed = delta
          ? await options.api.resumeRNDeltaUpload(artifact.uploadId, descriptors)
          : await options.api.resumeRNZipUpload(artifact.uploadId);
        if (!resumed || resumed.uploadId !== artifact.uploadId)
          throw new Error('RN resume returned a different upload session');
        if (resumed.state === 'finalized') {
          assertBundle(resumed.bundle, artifact.declaration);
          artifact.bundle = bundleIdentity(resumed.bundle);
          artifact.state = 'finalized';
          await writeReceipt(path, receipt);
          continue;
        }
        if (
          resumed.state !== 'pending' ||
          !same(resumed.declaration, artifact.declaration) ||
          !Number.isFinite(Date.parse(resumed.expiresAt)) ||
          Date.parse(resumed.expiresAt) <= Date.now()
        )
          throw new Error(
            'RN upload expired or the saved declaration changed; reconcile the session',
          );
        if (delta) {
          const verified = await readDelta();
          if (!('uploads' in resumed) || !Array.isArray(resumed.uploads))
            throw new Error('RN delta resume returned no missing-file list');
          const seen = new Set<string>();
          for (const entry of resumed.uploads) {
            if (
              !entry ||
              !verified.has(entry.sha256) ||
              seen.has(entry.sha256) ||
              typeof entry.presignedUrl !== 'string'
            )
              throw new Error('RN delta resume returned an invalid missing-file list');
            seen.add(entry.sha256);
          }
          for (const entry of resumed.uploads) {
            const bytes = verified.get(entry.sha256)!;
            await put(
              entry.presignedUrl,
              bytes,
              options.fetcher ?? fetch,
              createHash('md5').update(bytes).digest('base64'),
            );
          }
        } else {
          if (!('presignedUrl' in resumed)) throw new Error('RN ZIP resume returned no upload URL');
          const bytes = await readUploadArchive(
            join(options.directory, `${role}.zip`),
            d.sha256,
            d.size,
          );
          await put(resumed.presignedUrl, bytes, options.fetcher ?? fetch);
        }
        artifact.state = 'finalizing';
        await writeReceipt(path, receipt);
      }
      const finalized = delta
        ? await options.api.finalizeDeltaUpload({ uploadId: artifact.uploadId })
        : await options.api.finalizeUpload({ uploadId: artifact.uploadId });
      assertBundle(finalized, artifact.declaration);
      artifact.bundle = bundleIdentity(finalized);
      artifact.state = 'finalized';
      await writeReceipt(path, receipt);
    }
    return receipt;
  });
}

/** Deliberate adoption is the only path that can replace the local baseline transport identity. */
export async function adoptRNUploadBaseline(options: ResumeOptions): Promise<RNUploadReceipt> {
  const path = join(options.directory, 'upload.json');
  return withReceiptLock(path, async () => {
    const receipt = await readUpload(options);
    if (
      receipt.ota.state !== 'prepared' ||
      receipt.ota.uploadId ||
      (receipt.baseline.state === 'finalized' && !receipt.baseline.adopted)
    )
      throw new Error(
        'Baseline binding is already committed; preserve the existing upload receipt',
      );
    const d = receipt.baseline.declaration;
    const stored = await options.api.prepareBaselineAdoption({
      version: d.version,
      platform: d.platform,
      runtimeVersion: d.runtimeVersion,
      contentHash: d.contentHash,
      files: d.files,
      embeddedReceipt: d.embeddedReceipt,
      strategy: d.strategy,
      encryptionKid: d.encryption?.kid ?? null,
    });
    const adopted = await adoptBaseline({
      stored,
      expected: d.embeddedReceipt!,
      files: d.files,
      strategy: d.strategy,
      encryptionKey: options.encryptionKey,
      receiptPath: join(options.directory, 'adoption.json'),
      fetcher: options.fetcher,
    });
    receipt.baseline.bundle = bundleIdentity(baselineIdentity(adopted) as UploadedArtifact);
    receipt.baseline.state = 'finalized';
    receipt.baseline.adopted = true;
    await writeReceipt(path, receipt);
    return receipt;
  });
}
