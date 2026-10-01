import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { getBundleFileList } from '@/lib/bundle-files';
import { db } from '@/lib/db';

import { getBundleDiff } from './bundle-diff';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

databaseDescribe('bundle diff (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  let ids: string[];
  let readFiles: ReturnType<typeof vi.fn<typeof getBundleFileList>>;

  // Bundle i holds index.html plus `file-<j>.js` for every j <= i.
  const filesOf = (index: number) => [
    { path: 'index.html', size: 10, hash: 'a'.repeat(64) },
    ...Array.from({ length: index + 1 }, (_, j) => ({
      path: `file-${j}.js`,
      size: 100,
      hash: String(j).repeat(64).slice(0, 64),
    })),
  ];

  beforeEach(async () => {
    organizationId = randomUUID();
    appId = randomUUID();
    ids = Array.from({ length: 5 }, () => randomUUID());
    await db.organization.create({
      data: {
        id: organizationId,
        name: 'Diff',
        apps: {
          create: {
            id: appId,
            slug: `diff.${organizationId}`,
            bundles: {
              create: ids.map((id, index) => ({
                id,
                version: `1.0.${index}`,
                sha256: String(index).padStart(64, '0'),
                storageKey: `diff/${organizationId}/${index}`,
                size: 1000 + index,
                runtimeVersion: index === 4 ? 'other-runtime' : 'ios-1',
                strategy: 'deltas',
                createdAt: new Date(Date.UTC(2026, 8, 1 + index)),
              })),
            },
          },
        },
      },
    });
    readFiles = vi.fn<typeof getBundleFileList>(async (bundle) => ({
      ok: true,
      list: { hashType: 'sha256', files: filesOf(ids.indexOf(bundle.id)) },
    }));
  });

  afterEach(async () => {
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const diff = (bundleId: string, extra: { against?: string; channel?: string | null } = {}) =>
    getBundleDiff({ organizationId, appId, bundleId, ...extra }, { readFiles });

  it('compares with the previous upload of the same runtime by default', async () => {
    const result = await diff(ids[2]);
    expect(result).toMatchObject({
      target: { id: ids[2], version: '1.0.2', strategy: 'deltas', encrypted: false },
      base: { id: ids[1], version: '1.0.1' },
      baseSource: 'previous_upload',
      status: 'ok',
      comparable: true,
      summary: {
        added: 1,
        removed: 0,
        changed: 0,
        unchanged: 3,
        totalBefore: 210,
        totalAfter: 310,
        downloadBytes: 100,
      },
      changes: [{ path: 'file-2.js', status: 'added', sizeBefore: null, sizeAfter: 100 }],
      unlistedChanges: 0,
      warnings: [],
    });
  });

  it('treats the first upload of a runtime as all new', async () => {
    await expect(diff(ids[4])).resolves.toMatchObject({
      base: null,
      status: 'ok',
      summary: { added: 6, totalBefore: null, downloadBytes: null },
    });
    await expect(diff(ids[0])).resolves.toMatchObject({ base: null });
  });

  it('compares with any bundle of the app', async () => {
    await expect(diff(ids[1], { against: ids[3] })).resolves.toMatchObject({
      base: { id: ids[3] },
      baseSource: 'against',
      summary: { removed: 2, added: 0 },
    });
    await expect(diff(ids[1], { against: randomUUID() })).rejects.toMatchObject({ status: 404 });
  });

  it('compares with what a channel runs, outside a rollout and never with itself', async () => {
    const release = (index: number, data: Record<string, unknown> = {}) =>
      db.release.create({
        data: {
          appId,
          bundleId: ids[index],
          channel: 'production',
          promotedAt: new Date(Date.UTC(2026, 8, 10 + index)),
          ...data,
        },
      });
    await expect(diff(ids[3], { channel: 'production' })).resolves.toMatchObject({
      base: null,
      baseSource: 'channel',
    });
    await release(0);
    await release(1, { previousBundleId: ids[0] });
    await release(2, { previousBundleId: ids[1], rolloutPercent: 10 });

    // The lane's stable release (1.0.1), not the rolling one.
    await expect(diff(ids[3], { channel: 'production' })).resolves.toMatchObject({
      base: { id: ids[1] },
    });
    // The stable bundle itself is compared with the release it replaced.
    await expect(diff(ids[1], { channel: 'production' })).resolves.toMatchObject({
      base: { id: ids[0] },
    });
    await expect(diff(ids[3], { channel: null })).resolves.toMatchObject({ base: null });
  });

  it('reports which side cannot be read and still warns about the target', async () => {
    readFiles.mockImplementation(async (bundle) =>
      bundle.id === ids[1]
        ? { ok: false, reason: 'encrypted' }
        : {
            ok: true,
            list: {
              hashType: 'sha256',
              files: [...filesOf(ids.indexOf(bundle.id)), { path: '.env', size: 1, hash: 'e' }],
            },
          },
    );
    await expect(diff(ids[2])).resolves.toMatchObject({
      status: 'base_unavailable',
      unavailableReason: 'encrypted',
      summary: null,
      warnings: [{ code: 'env_file', paths: ['.env'] }],
    });
    await expect(diff(ids[1])).resolves.toMatchObject({
      status: 'target_unavailable',
      unavailableReason: 'encrypted',
      warnings: [],
    });
  });

  it('only finds bundles of the caller’s organization', async () => {
    await expect(
      getBundleDiff({ organizationId: randomUUID(), appId, bundleId: ids[1] }, { readFiles }),
    ).rejects.toMatchObject({ code: 'BUNDLE_NOT_FOUND', status: 404 });
    expect(readFiles).not.toHaveBeenCalled();
  });
});
