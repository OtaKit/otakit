import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareRNCollection, publishRNCollection } from './collection.js';
import { writeReceipt } from './receipts.js';

let root: string;
const api = { prepareRNRelease: vi.fn(), release: vi.fn() };
const options = () => ({
  api,
  appId: 'app',
  organizationId: 'org',
  actorKey: 'key:actor',
  serverUrl: 'https://console.example',
  receiptPath: join(root, 'collection.json'),
});
const prepare = () =>
  prepareRNCollection({
    ...options(),
    bundleIds: ['ios', 'android'],
    channel: null,
    forceImmediate: false,
  });
const saved = async () => JSON.parse(await readFile(options().receiptPath, 'utf8'));
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(join(tmpdir(), 'otakit-rn-collection-'));
  api.prepareRNRelease.mockImplementation(async (id) => ({
    platform: id,
    runtimeVersion: 'A'.repeat(43),
    proposedBundle: { id, version: 'ota-1', sha256: 'a'.repeat(64) },
    baselineBundleId: `baseline-${id}`,
    expectedCurrentReleaseId: `reviewed-${id}`,
    rnIntent: { version: 1, actorKey: 'key:actor', preparedAt: new Date().toISOString() },
  }));
  api.release.mockImplementation(async (_channel, bundleId) => ({
    operationId: `operation-${bundleId}`,
    publicationStatus: 'published',
  }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('preflights every variant before any publication and preserves partial commits and uncertain IDs across retries', async () => {
  const receipt = await prepare();
  expect(api.release).not.toHaveBeenCalled();
  await expect(prepare()).rejects.toThrow('already exists');
  api.release
    .mockImplementationOnce(async () => {
      const state = await saved();
      expect(
        state.targets.map((target: { publication: { state: string } }) => target.publication.state),
      ).toEqual(['outcome-unknown', 'not-sent']);
      return { operationId: 'android-operation', publicationStatus: 'manifest_sync_pending' };
    })
    .mockRejectedValueOnce(new Error('response lost after commit'));
  await expect(publishRNCollection(options())).rejects.toThrow('1/2 other targets committed');
  expect(
    (await saved()).targets.map(
      (target: { publication: { state: string } }) => target.publication.state,
    ),
  ).toEqual(['committed', 'outcome-unknown']);
  await publishRNCollection(options());
  await publishRNCollection(options());
  expect(api.release).toHaveBeenCalledTimes(3);
  expect(api.release.mock.calls[1]).toEqual(api.release.mock.calls[2]);
  expect(api.release.mock.calls[2][2].idempotencyKey).toBe(
    receipt.targets[1].publication.operationKey,
  );
  expect(api.prepareRNRelease).toHaveBeenCalledTimes(2);
  expect((await saved()).targets[0].publication.result.publicationStatus).toBe(
    'manifest_sync_pending',
  );
});

it.each(['actor', 'version', 'lane', 'target', 'baseline'])(
  'rejects inconsistent %s preflight before creating a receipt or publishing',
  async (change) => {
    const original = api.prepareRNRelease.getMockImplementation()!;
    api.prepareRNRelease.mockImplementation(async (id) => {
      const value = await original(id);
      if (id === 'android') {
        if (change === 'actor') value.rnIntent.actorKey = 'key:rotated';
        if (change === 'version') value.proposedBundle.version = 'ota-2';
        if (change === 'lane') value.platform = 'ios';
        if (change === 'target') value.proposedBundle.id = 'different';
        if (change === 'baseline') value.baselineBundleId = null;
      }
      return value;
    });
    await expect(prepare()).rejects.toThrow();
    await expect(saved()).rejects.toMatchObject({ code: 'ENOENT' });
    expect(api.release).not.toHaveBeenCalled();
  },
);

it('validates every target replay window before sending the first target', async () => {
  const receipt = await prepare();
  receipt.targets[1].publication.preparedLocallyAt = new Date(0).toISOString();
  receipt.targets[1].publication.intent.preparedAt = new Date(0).toISOString();
  await writeReceipt(options().receiptPath, receipt);
  await expect(publishRNCollection(options())).rejects.toThrow('retry window');
  expect(api.release).not.toHaveBeenCalled();
});

it.each(['appId', 'serverUrl', 'organizationId', 'actorKey'] as const)(
  'rejects changed %s and never reprepares an uncertain operation',
  async (key) => {
    await prepare();
    api.release.mockRejectedValueOnce(new Error('lost response'));
    await expect(publishRNCollection(options())).rejects.toThrow('INCOMPLETE');
    await expect(publishRNCollection({ ...options(), [key]: 'changed' })).rejects.toThrow(
      'SCOPE_LOST',
    );
    expect(api.release).toHaveBeenCalledOnce();
    expect(api.prepareRNRelease).toHaveBeenCalledTimes(2);
  },
);

it('refuses overlapping collection publishers while a mutation is in flight', async () => {
  await prepare();
  let finish!: () => void;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  api.release.mockImplementationOnce(async () => {
    start();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { operationId: 'original' };
  });
  const first = publishRNCollection(options());
  await started;
  await expect(publishRNCollection(options())).rejects.toThrow('locked');
  finish();
  await first;
  expect(api.release).toHaveBeenCalledTimes(2);
});
