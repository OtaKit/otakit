import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonicalJSON, type RNDescriptor } from '@otakit/rn-protocol';
import { archiveRNDirectory, verifyRNDirectory } from './artifacts.js';
import { hashBuffer } from '../hash.js';
import { encryptFile } from '../crypto.js';
import type { NativeBuildRecord } from './build-record.js';
import { completedBuildHash, type CompletedNativeBuild } from './completed-build.js';
import { embeddedBuildId, type EmbeddedExportReceipt } from './export-receipt.js';
import {
  adoptRNUploadBaseline,
  prepareRNUpload,
  uploadRNReceipt,
  type RNUploadReceipt,
  type UploadDeclaration,
} from './upload.js';
import { prepareRNUploadCollection, uploadRNCollection } from './upload-collection.js';

let root: string;
let directory: string;
let exportDirectory: string;
let encryptionKey: Buffer | null;
const scope = {
  serverUrl: 'https://console.example',
  organizationId: 'org',
  actorKey: 'key:actor',
};
const api = {
  initiateUpload: vi.fn(),
  resumeRNZipUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  prepareBaselineAdoption: vi.fn(),
  initiateDeltaUpload: vi.fn(),
  resumeRNDeltaUpload: vi.fn(),
  finalizeDeltaUpload: vi.fn(),
};
const fetcher = vi.fn<typeof fetch>();
const sessions = new Map<string, UploadDeclaration>();
const uploadedFiles = new Set<string>();
const options = () => ({ directory, scope, encryptionKey, api, fetcher });
const saved = async () =>
  JSON.parse(await readFile(join(directory, 'upload.json'), 'utf8')) as RNUploadReceipt;
const bundle = (id: string) => {
  const { files: _files, ...declaration } = sessions.get(id)!;
  expect(_files.length).toBeGreaterThan(0);
  return { ...declaration, id: `bundle-${id}` };
};

async function createExport(
  exportDirectory: string,
  platform: 'ios' | 'android' = 'android',
  appId = 'app',
  displayVersion = 'ota-1',
) {
  const baselineDirectory = `${exportDirectory}-baseline`;
  const identity: NativeBuildRecord['identity'] = {
    appId,
    platform,
    nativeApplicationId: 'com.example.app',
    variant: 'release',
    reactNativeVersion: '0.86.3',
    protocolVersion: 1,
    fingerprintTool: '@expo/fingerprint@0.20.6',
    fingerprintHash: 'fixture',
    fingerprintSources: [],
    autolinking: {},
    hermesCompiler: { path: 'hermesc', sha256: 'a'.repeat(64), bytecodeVersion: 98 },
    nativeFiles: [{ path: 'native.gradle', sha256: 'b'.repeat(64) }],
    nativeConfiguration: {},
  };
  const nativeBuild: NativeBuildRecord = {
    format: 'otakit-rn-native-build',
    version: 1,
    identity,
    runtimeVersion: createHash('sha256').update(canonicalJSON(identity)).digest('base64url'),
  };
  async function payload(path: string, version: string) {
    await mkdir(join(path, 'payload'), { recursive: true });
    const descriptor: RNDescriptor = {
      format: 'otakit-rn',
      formatVersion: 1,
      framework: 'react-native',
      platform,
      runtimeVersion: nativeBuild.runtimeVersion,
      version,
      entryPoint: 'index.bundle',
      engine: 'hermes',
      bundleFormat: 'hermes-bytecode',
      reactNativeVersion: '0.86.3',
    };
    const hbc = Buffer.alloc(16);
    Buffer.from('c61fbc03c103191f', 'hex').copy(hbc);
    hbc.writeUInt32LE(98, 8);
    await writeFile(join(path, 'payload/index.bundle'), hbc);
    await writeFile(join(path, 'payload/otakit-bundle.json'), JSON.stringify(descriptor));
    const verified = await verifyRNDirectory(join(path, 'payload'), descriptor, 98);
    await archiveRNDirectory(join(path, 'payload'), join(path, 'artifact.zip'), verified.files);
    return {
      format: 'otakit-rn-export' as const,
      version: 1 as const,
      appId,
      platform,
      runtimeVersion: nativeBuild.runtimeVersion,
      displayVersion: version,
      ...verified,
      sha256: hashBuffer(await readFile(join(path, 'artifact.zip'))),
      sourceMap: 'private/index.map' as const,
      archive: 'artifact.zip' as const,
      payload: 'payload' as const,
      mappingHash: 'c'.repeat(64),
    };
  }
  const embedded = await payload(baselineDirectory, 'embedded-1');
  const embeddedReceipt = {
    appId,
    framework: 'react-native' as const,
    platform,
    runtimeVersion: nativeBuild.runtimeVersion,
    version: embedded.displayVersion,
    embeddedContentHash: embedded.contentHash,
  };
  const baseline: EmbeddedExportReceipt = {
    ...embedded,
    purpose: 'embedded',
    embeddedReceipt,
    nativeBuildId: embeddedBuildId(embeddedReceipt),
  };
  const completed: CompletedNativeBuild = {
    format: 'otakit-rn-completed-build',
    version: 1,
    nativeBuild,
    baseline,
    binary: {
      format: platform === 'android' ? 'android-apk' : 'ios-app',
      nativeApplicationId: identity.nativeApplicationId,
      sha256: 'd'.repeat(64),
    },
  };
  const ota = {
    ...(await payload(exportDirectory, displayVersion)),
    purpose: 'ota',
    baseline: {
      embeddedReceipt,
      archive: 'private/baseline.zip',
      exportReceipt: 'private/baseline-export.json',
      completedBuild: 'private/completed-build.json',
      completedBuildHash: completedBuildHash(completed),
    },
  };
  await mkdir(join(exportDirectory, 'private'));
  await cp(join(baselineDirectory, 'artifact.zip'), join(exportDirectory, 'private/baseline.zip'));
  for (const [path, value] of Object.entries({
    'export.json': ota,
    'private/completed-build.json': completed,
    'private/native-build.json': nativeBuild,
    'private/baseline-export.json': baseline,
  }))
    await writeFile(join(exportDirectory, path), JSON.stringify(value));
}

beforeEach(async () => {
  vi.resetAllMocks();
  sessions.clear();
  uploadedFiles.clear();
  encryptionKey = null;
  root = await mkdtemp(join(tmpdir(), 'otakit-rn-upload-'));
  directory = join(root, 'upload');
  exportDirectory = join(root, 'export');
  await createExport(exportDirectory);
  api.initiateUpload.mockImplementation(async (input) => {
    const id = String(sessions.size + 1);
    sessions.set(id, {
      ...input,
      appId: 'app',
      framework: 'react-native',
      strategy: 'zip',
      encryption: input.encryption ?? null,
      embeddedReceipt: input.embeddedReceipt ?? null,
      baselineBundleId: input.baselineBundleId ?? null,
    });
    return {
      uploadId: id,
      presignedUrl: 'https://unused.example/?secret=init',
      expiresAt: '',
      storageKey: id,
    };
  });
  api.resumeRNZipUpload.mockImplementation(async (uploadId) => ({
    state: 'pending',
    uploadId,
    declaration: sessions.get(uploadId),
    presignedUrl: `https://storage.example/${uploadId}?secret=rotating`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }));
  api.finalizeUpload.mockImplementation(async ({ uploadId }) => bundle(uploadId));
  api.initiateDeltaUpload.mockImplementation(async (input) => {
    const id = String(sessions.size + 1);
    const files = input.files.map(({ md5: _md5, ...file }: { md5: string }) => {
      expect(_md5).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      return file;
    });
    sessions.set(id, {
      ...input,
      files,
      appId: 'app',
      framework: 'react-native',
      strategy: 'deltas',
      encryption: null,
      embeddedReceipt: input.embeddedReceipt ?? null,
      baselineBundleId: input.baselineBundleId ?? null,
      sha256: input.contentHash,
      size: input.files.reduce((sum: number, f: { size: number }) => sum + f.size, 0),
    });
    return { uploadId: id };
  });
  api.resumeRNDeltaUpload.mockImplementation(async (uploadId) => ({
    state: 'pending',
    uploadId,
    declaration: sessions.get(uploadId),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    uploads: [...new Set(sessions.get(uploadId)!.files.map((f) => f.sha256))]
      .filter((hash) => !uploadedFiles.has(hash))
      .map((sha256) => ({ sha256, presignedUrl: `https://storage.example/${sha256}` })),
  }));
  api.finalizeDeltaUpload.mockImplementation(async ({ uploadId }) => {
    for (const file of sessions.get(uploadId)!.files)
      expect(uploadedFiles.has(file.sha256)).toBe(true);
    return bundle(uploadId);
  });
  fetcher.mockResolvedValue(new Response(null, { status: 200 }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const prepare = (strategy: 'zip' | 'deltas' = 'zip') =>
  prepareRNUpload({ exportDirectory, directory, scope, encryptionKey, strategy });

function receiveDeltaFiles() {
  fetcher.mockImplementation(async (url, init) => {
    const bytes = Buffer.from(init!.body as Uint8Array);
    const sha256 = hashBuffer(bytes);
    expect(new URL(String(url)).pathname).toBe(`/${sha256}`);
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-MD5')).toBe(createHash('md5').update(bytes).digest('base64'));
    expect(headers.get('Content-Length')).toBe(String(bytes.length));
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    expect(headers.has('Authorization')).toBe(false);
    expect(init?.redirect).toBe('error');
    uploadedFiles.add(sha256);
    return new Response(null, { status: 200 });
  });
}

it('uploads verified delta files, deduplicates baseline/OTA content and replays without writes', async () => {
  await prepare('deltas');
  receiveDeltaFiles();
  const receipt = await uploadRNReceipt(options());
  expect(receipt.ota.bundle).toMatchObject({
    strategy: 'deltas',
    baselineBundleId: receipt.baseline.bundle!.id,
  });
  expect(fetcher).toHaveBeenCalledTimes(3); // Shared Hermes entry, two different descriptors.
  expect(api.initiateUpload).not.toHaveBeenCalled();
  await uploadRNReceipt(options());
  expect(api.initiateDeltaUpload).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('resumes only missing delta files after an interrupted PUT using the original session', async () => {
  await prepare('deltas');
  receiveDeltaFiles();
  const receive = fetcher.getMockImplementation()!;
  fetcher.mockImplementationOnce(async (...args) => {
    await receive(...args);
    throw new Error('response lost');
  });
  await expect(uploadRNReceipt(options())).rejects.toThrow('response lost');
  expect((await saved()).baseline).toMatchObject({ state: 'uploading', uploadId: '1' });
  await uploadRNReceipt(options());
  expect(api.initiateDeltaUpload).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('retries delta finalization without uploading files again', async () => {
  await prepare('deltas');
  receiveDeltaFiles();
  api.finalizeDeltaUpload.mockRejectedValueOnce(new Error('finalize lost'));
  await expect(uploadRNReceipt(options())).rejects.toThrow('finalize lost');
  expect((await saved()).baseline.state).toBe('finalizing');
  await uploadRNReceipt(options());
  expect(api.finalizeDeltaUpload.mock.calls.slice(0, 2)).toEqual([
    [{ uploadId: '1' }],
    [{ uploadId: '1' }],
  ]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each(['unknown', 'duplicate'] as const)(
  'rejects %s delta objects before any PUT',
  async (kind) => {
    await prepare('deltas');
    const resume = api.resumeRNDeltaUpload.getMockImplementation()!;
    api.resumeRNDeltaUpload.mockImplementationOnce(async (...args) => {
      const response = await resume(...args);
      response.uploads.push(
        kind === 'unknown'
          ? { sha256: 'f'.repeat(64), presignedUrl: 'https://storage.example/unknown' }
          : response.uploads[0],
      );
      return response;
    });
    await expect(uploadRNReceipt(options())).rejects.toThrow('invalid missing-file list');
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('rechecks delta archives after receiving upload URLs', async () => {
  await prepare('deltas');
  const resume = api.resumeRNDeltaUpload.getMockImplementation()!;
  api.resumeRNDeltaUpload.mockImplementationOnce(async (...args) => {
    const response = await resume(...args);
    await writeFile(join(directory, 'baseline.zip'), 'changed');
    return response;
  });
  await expect(uploadRNReceipt(options())).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects delta encryption before creating durable output', async () => {
  encryptionKey = Buffer.alloc(32, 7);
  await expect(prepare('deltas')).rejects.toThrow('use ZIP to preserve encryption');
  await expect(readFile(join(directory, 'upload.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('uploads baseline first, binds the OTA, saves no URL credentials and is a no-op after completion', async () => {
  await prepare();
  const result = await uploadRNReceipt(options());
  expect(result.ota.bundle?.baselineBundleId).toBe(result.baseline.bundle?.id);
  expect(result.ota.state).toBe('finalized');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await readFile(join(directory, 'upload.json'), 'utf8')).not.toMatch(
    /presigned|secret=|storage\.example/,
  );
  await uploadRNReceipt(options());
  expect(api.initiateUpload).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(api.prepareBaselineAdoption).not.toHaveBeenCalled();
});

it('reuses the same encrypted bytes and known ID after a lost PUT response', async () => {
  encryptionKey = Buffer.alloc(32, 7);
  await prepare();
  const original = await readFile(join(directory, 'baseline.zip'));
  fetcher.mockRejectedValueOnce(new Error('PUT response lost'));
  await expect(uploadRNReceipt(options())).rejects.toThrow('PUT response lost');
  expect((await saved()).baseline).toMatchObject({ state: 'uploading', uploadId: '1' });
  await expect(prepare()).rejects.toMatchObject({ code: 'EEXIST' });
  await uploadRNReceipt(options());
  expect(api.initiateUpload).toHaveBeenCalledTimes(2);
  expect(Buffer.from(fetcher.mock.calls[0][1]!.body as Uint8Array)).toEqual(original);
  expect(Buffer.from(fetcher.mock.calls[1][1]!.body as Uint8Array)).toEqual(original);
  expect(await readFile(join(directory, 'baseline.zip'))).toEqual(original);
});

it('retries only finalization after its response is lost and continues the OTA', async () => {
  await prepare();
  api.finalizeUpload.mockRejectedValueOnce(new Error('finalize response lost'));
  await expect(uploadRNReceipt(options())).rejects.toThrow('finalize response lost');
  expect((await saved()).baseline.state).toBe('finalizing');
  await uploadRNReceipt(options());
  expect(api.finalizeUpload.mock.calls.slice(0, 2)).toEqual([
    [{ uploadId: '1' }],
    [{ uploadId: '1' }],
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(api.resumeRNZipUpload).toHaveBeenCalledTimes(2);
});

it('accepts exact server finalization on resume without overwriting its storage object', async () => {
  await prepare();
  fetcher.mockRejectedValueOnce(new Error('response lost'));
  await expect(uploadRNReceipt(options())).rejects.toThrow();
  api.resumeRNZipUpload.mockResolvedValueOnce({
    state: 'finalized',
    uploadId: '1',
    bundle: bundle('1'),
  });
  await uploadRNReceipt(options());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(api.finalizeUpload).toHaveBeenCalledExactlyOnceWith({ uploadId: '2' });
});

it.each(['serverUrl', 'organizationId', 'actorKey'] as const)(
  'refuses changed %s before API calls',
  async (field) => {
    await prepare();
    await expect(
      uploadRNReceipt({ ...options(), scope: { ...scope, [field]: 'https://different.example' } }),
    ).rejects.toThrow('SCOPE_LOST');
    expect(api.initiateUpload).not.toHaveBeenCalled();
  },
);

it('refuses a rotated encryption key or corrupt local transport before API calls', async () => {
  encryptionKey = Buffer.alloc(32, 7);
  await prepare();
  await expect(
    uploadRNReceipt({ ...options(), encryptionKey: Buffer.alloc(32, 8) }),
  ).rejects.toThrow('encryption policy');
  await writeFile(join(directory, 'baseline.zip'), 'corrupt');
  await expect(uploadRNReceipt(options())).rejects.toThrow('file size');
  expect(api.initiateUpload).not.toHaveBeenCalled();
});

it('rechecks the exact bytes sent after obtaining the upload URL', async () => {
  await prepare();
  const resume = api.resumeRNZipUpload.getMockImplementation()!;
  api.resumeRNZipUpload.mockImplementationOnce(async (id) => {
    await writeFile(join(directory, 'baseline.zip'), 'replaced');
    return resume(id);
  });
  await expect(uploadRNReceipt(options())).rejects.toThrow('file size');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['expiry', 'declaration', 'bundle'])(
  'fails closed for a changed server %s without replacing the session',
  async (change) => {
    await prepare();
    const resume = api.resumeRNZipUpload.getMockImplementation()!;
    api.resumeRNZipUpload.mockImplementation(async (id) => {
      const result = await resume(id);
      if (change === 'expiry') result.expiresAt = new Date(0).toISOString();
      if (change === 'declaration')
        result.declaration = { ...result.declaration, sha256: '0'.repeat(64) };
      if (change === 'bundle')
        return {
          state: 'finalized',
          uploadId: id,
          bundle: { ...bundle(id), baselineBundleId: 'wrong' },
        };
      return result;
    });
    await expect(uploadRNReceipt(options())).rejects.toThrow();
    await expect(uploadRNReceipt(options())).rejects.toThrow();
    expect(api.initiateUpload).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('does not automatically adopt a conflict; explicit adoption verifies the winning ciphertext and tolerates URL rotation', async () => {
  encryptionKey = Buffer.alloc(32, 7);
  const prepared = await prepare();
  api.initiateUpload.mockRejectedValueOnce(new Error('409 baseline exists'));
  await expect(uploadRNReceipt(options())).rejects.toThrow('409');
  expect(api.prepareBaselineAdoption).not.toHaveBeenCalled();
  const winningPath = join(root, 'winning.zip');
  const encryption = await encryptFile(
    encryptionKey,
    join(exportDirectory, 'private/baseline.zip'),
    winningPath,
  );
  const winning = await readFile(winningPath);
  const stored = {
    ...prepared.baseline.declaration,
    id: 'adopted',
    sha256: hashBuffer(winning),
    size: winning.length,
    encryption,
    downloadUrl: 'https://storage.example/baseline?secret=first',
  };
  expect(stored.sha256).not.toBe(prepared.baseline.declaration.sha256);
  api.prepareBaselineAdoption.mockResolvedValue(stored);
  fetcher.mockResolvedValueOnce(new Response('corrupt'));
  await expect(adoptRNUploadBaseline(options())).rejects.toThrow('transport hash');
  expect((await saved()).baseline.adopted).toBeUndefined();
  fetcher.mockResolvedValueOnce(new Response(winning));
  await adoptRNUploadBaseline(options());
  api.prepareBaselineAdoption.mockResolvedValue({
    ...stored,
    downloadUrl: 'https://storage.example/baseline?secret=second',
  });
  fetcher.mockResolvedValueOnce(new Response(winning));
  await adoptRNUploadBaseline(options());
  expect(await readFile(join(directory, 'adoption.json'), 'utf8')).not.toMatch(
    /secret=|downloadUrl/,
  );
  const result = await uploadRNReceipt(options());
  expect(result.ota.bundle?.baselineBundleId).toBe('adopted');
  expect(api.initiateUpload).toHaveBeenCalledTimes(2);
  await expect(adoptRNUploadBaseline(options())).rejects.toThrow('already committed');
});

it('rejects inconsistent embedded provenance and a corrupt source archive before preparing uploads', async () => {
  const path = join(exportDirectory, 'private/completed-build.json');
  const completed = JSON.parse(await readFile(path, 'utf8'));
  completed.baseline.embeddedReceipt.version = 'other';
  await writeFile(path, JSON.stringify(completed));
  await expect(prepare()).rejects.toThrow('provenance');
  await expect(readFile(join(directory, 'upload.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

async function preparedCollection(appId = 'app', version = 'ota-1') {
  await prepare();
  const secondExport = join(root, 'ios-export');
  const second = join(root, 'ios-upload');
  await createExport(secondExport, 'ios', appId, version);
  await prepareRNUpload({ exportDirectory: secondExport, directory: second, scope, encryptionKey });
  const collectionOptions = { ...options(), receiptPath: join(root, 'upload-collection.json') };
  await prepareRNUploadCollection({ ...collectionOptions, directories: [directory, second] });
  return { second, secondExport, collectionOptions };
}

it('resumes an encrypted collection after lost finalization without resending completed variants', async () => {
  encryptionKey = Buffer.alloc(32, 7);
  const { second, collectionOptions } = await preparedCollection();
  const parent = await readFile(collectionOptions.receiptPath);
  const transport = await readFile(join(second, 'ota.zip'));
  api.finalizeUpload
    .mockImplementationOnce(async ({ uploadId }) => bundle(uploadId))
    .mockImplementationOnce(async ({ uploadId }) => bundle(uploadId))
    .mockImplementationOnce(async ({ uploadId }) => bundle(uploadId))
    .mockRejectedValueOnce(new Error('lost second OTA finalization'));
  await expect(uploadRNCollection(collectionOptions)).rejects.toThrow('1/2 targets finalized');
  expect((await saved()).ota.state).toBe('finalized');
  const result = await uploadRNCollection(collectionOptions);
  expect(result.targets.map((target) => target.platform)).toEqual(['android', 'ios']);
  expect(new Set(result.targets.map((target) => target.baselineBundleId)).size).toBe(2);
  expect(api.initiateUpload).toHaveBeenCalledTimes(4);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(api.finalizeUpload).toHaveBeenCalledTimes(5);
  await uploadRNCollection(collectionOptions);
  expect(api.finalizeUpload).toHaveBeenCalledTimes(5);
  expect(await readFile(join(second, 'ota.zip'))).toEqual(transport);
  expect(await readFile(collectionOptions.receiptPath)).toEqual(parent);
});

it.each([
  ['other-app', 'ota-1'],
  ['app', 'other-version'],
])(
  'rejects collection target mismatch before saving or uploading: %s %s',
  async (appId, version) => {
    await expect(preparedCollection(appId, version)).rejects.toThrow('targeting changed');
    await expect(readFile(join(root, 'upload-collection.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(api.initiateUpload).not.toHaveBeenCalled();
  },
);

it('rejects duplicate upload lanes and refuses to replace an existing collection', async () => {
  await prepare();
  const collectionOptions = { ...options(), receiptPath: join(root, 'upload-collection.json') };
  await expect(
    prepareRNUploadCollection({ ...collectionOptions, directories: [directory, directory] }),
  ).rejects.toThrow('Duplicate');
  await prepareRNUploadCollection({ ...collectionOptions, directories: [directory] });
  await expect(
    prepareRNUploadCollection({ ...collectionOptions, directories: [directory] }),
  ).rejects.toThrow('already exists');
  expect(api.initiateUpload).not.toHaveBeenCalled();
});

it('verifies the last collection archive before sending the first target', async () => {
  const { second, collectionOptions } = await preparedCollection();
  await writeFile(join(second, 'ota.zip'), 'corrupt transport');
  await expect(uploadRNCollection(collectionOptions)).rejects.toThrow();
  expect(api.initiateUpload).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

it('binds the originally prepared ciphertext even if replacement receipts are independently valid', async () => {
  encryptionKey = Buffer.alloc(32, 8);
  const { second, secondExport, collectionOptions } = await preparedCollection();
  const replacement = join(root, 'replacement');
  await prepareRNUpload({
    exportDirectory: secondExport,
    directory: replacement,
    scope,
    encryptionKey,
  });
  for (const name of ['upload.json', 'baseline.zip', 'ota.zip'])
    await cp(join(replacement, name), join(second, name));
  await expect(uploadRNCollection(collectionOptions)).rejects.toThrow(
    'selected collection transport',
  );
  expect(api.initiateUpload).not.toHaveBeenCalled();
});

it('rejects a collection account change before any upload', async () => {
  const { collectionOptions } = await preparedCollection();
  await expect(
    uploadRNCollection({ ...collectionOptions, scope: { ...scope, actorKey: 'key:other' } }),
  ).rejects.toThrow('RN_UPLOAD_SCOPE_LOST');
  expect(api.initiateUpload).not.toHaveBeenCalled();
});
