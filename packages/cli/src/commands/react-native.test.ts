import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newPublicationReceipt, writeReceipt } from '../lib/react-native/receipts.js';

const mock = vi.hoisted(() => ({
  request: vi.fn(),
  prepare: vi.fn(),
  release: vi.fn(),
  config: vi.fn(),
}));
vi.mock('../lib/config.js', () => ({ requireConfig: mock.config }));
vi.mock('../lib/api.js', () => ({
  ApiClient: class {
    request = mock.request;
    prepareRNRelease = mock.prepare;
    release = mock.release;
  },
}));
let root: string;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  root = await mkdtemp(join(tmpdir(), 'otakit-rn-command-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mock.config.mockResolvedValue({
    appId: 'app',
    serverUrl: 'https://console.example',
    authToken: 'test-only',
  });
  mock.request.mockResolvedValue({
    organization: { id: 'org' },
    app: { id: 'app' },
    actor: { type: 'key', id: 'original' },
  });
});
afterEach(async () => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('prepares separately, retries a lost response with the saved intent, and rejects rotated actors', async () => {
  const { reactNativeCommand } = await import('./react-native.js');
  const receiptPath = join(root, 'publication.json');
  const intent = { version: 1, actorKey: 'key:original', preparedAt: new Date().toISOString() };
  mock.prepare.mockResolvedValue({
    platform: 'ios',
    runtimeVersion: 'A'.repeat(43),
    rnIntent: intent,
    expectedCurrentReleaseId: 'reviewed-release',
  });
  await reactNativeCommand.parseAsync([
    'node',
    'rn',
    'prepare-publication',
    'bundle',
    '--app-id',
    'app',
    '--platform',
    'ios',
    '--runtime',
    'A'.repeat(43),
    '--receipt',
    receiptPath,
  ]);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  expect(mock.release).not.toHaveBeenCalled();
  mock.release
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValue({ operationId: 'original-operation' });
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish', receiptPath]);
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
  expect(JSON.parse(await readFile(receiptPath, 'utf8')).state).toBe('outcome-unknown');
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish', receiptPath]);
  expect(mock.release.mock.calls[0]).toEqual(mock.release.mock.calls[1]);
  expect(mock.release.mock.calls[1][2]).toMatchObject({
    idempotencyKey: receipt.operationKey,
    rnIntent: intent,
    expectedCurrentReleaseId: 'reviewed-release',
  });
  expect(mock.prepare).toHaveBeenCalledOnce();
  mock.request.mockResolvedValue({
    organization: { id: 'org' },
    app: { id: 'app' },
    actor: { type: 'key', id: 'rotated' },
  });
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish', receiptPath]);
  expect(process.exitCode).toBe(1);
  expect(mock.release).toHaveBeenCalledTimes(2);
});

it('rejects a changed server before making an authenticated context request', async () => {
  const receiptPath = join(root, 'publication.json');
  const receipt = newPublicationReceipt({
    serverUrl: 'https://different.example',
    organizationId: 'org',
    intent: { version: 1, actorKey: 'key:original', preparedAt: new Date().toISOString() },
    arguments: {
      appId: 'app',
      platform: 'ios',
      runtimeVersion: 'A'.repeat(43),
      bundleId: 'bundle',
      channel: null,
      expectedCurrentReleaseId: null,
      forceImmediate: false,
      autoRevert: false,
    },
  });
  await writeReceipt(receiptPath, receipt);
  const { reactNativeCommand } = await import('./react-native.js');
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish', receiptPath]);
  expect(process.exitCode).toBe(1);
  expect(mock.request).not.toHaveBeenCalled();
  expect(mock.release).not.toHaveBeenCalled();
});

it('requires a completed build for OTA export before loading server credentials or creating output', async () => {
  const { reactNativeCommand } = await import('./react-native.js');
  const prepared = join(root, 'prepared.json');
  const inputs = join(root, 'inputs.json');
  await writeFile(prepared, JSON.stringify({ format: 'otakit-rn-native-build', version: 1 }));
  await writeFile(inputs, '{}');
  await reactNativeCommand.parseAsync([
    'node',
    'rn',
    'export',
    '--native-inputs',
    inputs,
    '--native-build',
    prepared,
    '--baseline-export',
    join(root, 'baseline'),
    '--version',
    'ota-1',
    '--output',
    join(root, 'output'),
  ]);
  expect(process.exitCode).toBe(1);
  expect(mock.config).not.toHaveBeenCalled();
  expect(mock.request).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('completed native build'));
});

it.each(['upload', 'adopt-baseline'])(
  'rejects a changed server before authenticated %s requests',
  async (command) => {
    const directory = join(root, 'upload');
    await mkdir(directory);
    await writeFile(
      join(directory, 'upload.json'),
      JSON.stringify({
        format: 'otakit-rn-upload',
        version: 1,
        exported: { appId: 'app' },
        scope: { serverUrl: 'https://different.example' },
      }),
    );
    const { reactNativeCommand } = await import('./react-native.js');
    await reactNativeCommand.parseAsync(['node', 'rn', command, directory]);
    expect(process.exitCode).toBe(1);
    expect(mock.request).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('RN_UPLOAD_SCOPE_LOST'));
  },
);

it('prepares all collection targets before publishing and resumes only the uncertain target', async () => {
  const { reactNativeCommand } = await import('./react-native.js');
  const receiptPath = join(root, 'collection.json');
  mock.prepare.mockImplementation(async (id) => ({
    platform: id,
    runtimeVersion: 'A'.repeat(43),
    proposedBundle: { id, version: 'ota-1', sha256: 'a'.repeat(64) },
    baselineBundleId: `baseline-${id}`,
    expectedCurrentReleaseId: null,
    rnIntent: { version: 1, actorKey: 'key:original', preparedAt: new Date().toISOString() },
  }));
  await reactNativeCommand.parseAsync([
    'node',
    'rn',
    'prepare-collection',
    'ios',
    'android',
    '--app-id',
    'app',
    '--receipt',
    receiptPath,
  ]);
  expect(mock.release).not.toHaveBeenCalled();
  mock.release
    .mockResolvedValueOnce({ operationId: 'android' })
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce({ operationId: 'ios' });
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish-collection', receiptPath]);
  expect(process.exitCode).toBe(1);
  process.exitCode = 0;
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish-collection', receiptPath]);
  expect(process.exitCode).toBe(0);
  expect(mock.release).toHaveBeenCalledTimes(3);
  expect(mock.release.mock.calls[1]).toEqual(mock.release.mock.calls[2]);
  mock.config.mockResolvedValue({
    appId: 'app',
    serverUrl: 'https://other.example',
    authToken: 'test-only',
  });
  mock.request.mockClear();
  await reactNativeCommand.parseAsync(['node', 'rn', 'publish-collection', receiptPath]);
  expect(mock.request).not.toHaveBeenCalled();
});
