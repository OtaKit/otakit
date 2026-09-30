import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  putTextObject: vi.fn(),
  deleteStorageObject: vi.fn(),
  listStorageKeys: vi.fn(),
  getTextObject: vi.fn(),
  deleteBundleObject: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  buildFileObjectKey: (appId: string, sha256: string) => `files/${appId}/${sha256}`,
  buildPublicObjectUrl: (key: string) => `https://cdn.test/${key}`,
  ...storage,
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: vi.fn() }));
vi.stubEnv('MANIFEST_SIGNING_DISABLED', 'true');
vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://console.example');

import { db } from '@/lib/db';
import { restoreManifestFilesForApp } from '@/lib/manifest-files';
import { MAX_ACTIVE_PREVIEWS_PER_APP } from '@/lib/preview-links';

import { deleteBundle } from './bundles';
import {
  createPreview,
  endExpiredPreviews,
  getPublicPreview,
  listPreviews,
  revokePreview,
} from './previews';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

databaseDescribe('preview links (PostgreSQL integration)', () => {
  let organizationId: string;
  let appId: string;
  let bundleIds: string[];
  let access: { organizationId: string; actorType: 'user'; actorId: string };

  beforeEach(async () => {
    organizationId = randomUUID();
    appId = randomUUID();
    bundleIds = [randomUUID(), randomUUID()];
    access = { organizationId, actorType: 'user', actorId: randomUUID() };
    for (const mock of Object.values(storage)) mock.mockReset();
    storage.listStorageKeys.mockResolvedValue([]);

    await db.organization.create({
      data: {
        id: organizationId,
        name: `Preview integration ${organizationId}`,
        apps: {
          create: {
            id: appId,
            slug: `preview.${organizationId}`,
            bundles: {
              create: bundleIds.map((id, index) => ({
                id,
                version: `2.0.${index}`,
                sha256: String(index).padStart(64, '0'),
                storageKey: `integration/${organizationId}/${index}.zip`,
                size: 100 + index,
                runtimeVersion: 'rt-7',
              })),
            },
          },
        },
      },
    });
  });

  afterEach(async () => {
    await db.organization.delete({ where: { id: organizationId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function writtenManifest(call = 0) {
    const { storageKey, body } = storage.putTextObject.mock.calls[call][0] as {
      storageKey: string;
      body: string;
    };
    return { storageKey, manifest: JSON.parse(body) as Record<string, unknown> };
  }

  it('serves the bundle on a hidden preview channel and remembers the URL scheme', async () => {
    const preview = await createPreview({
      access,
      appId,
      bundleId: bundleIds[0],
      expiresIn: '24h',
      urlScheme: ' MyApp:// ',
    });

    const stored = await db.bundlePreview.findUniqueOrThrow({ where: { id: preview.id } });
    expect(stored.token).toMatch(/^[a-z2-7]{26}$/);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeCloseTo(
      24 * 60 * 60 * 1000,
      -4,
    );
    expect(preview).toMatchObject({
      bundleId: bundleIds[0],
      bundleVersion: '2.0.0',
      runtimeVersion: 'rt-7',
      url: `https://console.example/p/${stored.token}`,
      qrUrl: `https://console.example/p/${stored.token}/qr.png`,
      deepLink: `myapp://otakit-preview?token=${stored.token}`,
    });
    await expect(db.app.findUniqueOrThrow({ where: { id: appId } })).resolves.toMatchObject({
      previewUrlScheme: 'myapp',
    });

    const { storageKey, manifest } = writtenManifest();
    expect(storageKey).toBe(`manifests/${appId}/__preview_${stored.token}/rt-7/manifest.json`);
    expect(manifest).toMatchObject({
      version: '2.0.0',
      sha256: '0'.padStart(64, '0'),
      channel: `__preview_${stored.token}`,
      runtimeVersion: 'rt-7',
      releaseId: `preview_${preview.id}`,
      forceImmediate: false,
      url: `https://cdn.test/integration/${organizationId}/0.zip`,
    });
    expect(manifest).not.toHaveProperty('rollout');
    await expect(
      db.auditLog.findFirstOrThrow({ where: { organizationId, action: 'preview.created' } }),
    ).resolves.toMatchObject({
      targetId: bundleIds[0],
      metadata: expect.objectContaining({ previewId: preview.id }),
    });
  });

  it('rejects bad input, foreign bundles, and blocked workspaces without creating anything', async () => {
    await expect(
      createPreview({ access, appId, bundleId: bundleIds[0], urlScheme: 'https' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      createPreview({ access, appId, bundleId: bundleIds[0], expiresIn: '2d' as never }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      createPreview({
        access: { ...access, organizationId: randomUUID() },
        appId,
        bundleId: bundleIds[0],
      }),
    ).rejects.toMatchObject({ code: 'BUNDLE_NOT_FOUND' });

    await db.organization.update({ where: { id: organizationId }, data: { usageBlocked: true } });
    await expect(createPreview({ access, appId, bundleId: bundleIds[0] })).rejects.toMatchObject({
      code: 'USAGE_BLOCKED',
      status: 402,
    });

    await expect(db.bundlePreview.count({ where: { appId } })).resolves.toBe(0);
    expect(storage.putTextObject).not.toHaveBeenCalled();
  });

  it('ends the preview again when its manifest cannot be written', async () => {
    storage.putTextObject.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(createPreview({ access, appId, bundleId: bundleIds[0] })).rejects.toThrow(
      'storage unavailable',
    );
    await expect(db.bundlePreview.count({ where: { appId, endedAt: null } })).resolves.toBe(0);
    expect(storage.deleteStorageObject).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^manifests/${appId}/__preview_[a-z2-7]{26}/rt-7/`)),
    );
  });

  it('ends a preview whose workspace was blocked while its manifest was written', async () => {
    storage.putTextObject.mockImplementationOnce(async () => {
      await db.organization.update({ where: { id: organizationId }, data: { usageBlocked: true } });
    });

    await expect(createPreview({ access, appId, bundleId: bundleIds[0] })).rejects.toMatchObject({
      code: 'USAGE_BLOCKED',
    });
    await expect(db.bundlePreview.count({ where: { appId, endedAt: null } })).resolves.toBe(0);
    expect(storage.deleteStorageObject).toHaveBeenCalledTimes(1);
  });

  it('leaves an expired preview for the cron when even the cleanup fails', async () => {
    storage.putTextObject.mockRejectedValueOnce(new Error('storage unavailable'));
    storage.deleteStorageObject.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(createPreview({ access, appId, bundleId: bundleIds[0] })).rejects.toThrow();
    const [row] = await db.bundlePreview.findMany({ where: { appId } });
    expect(row).toMatchObject({ endedAt: null });
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(endExpiredPreviews()).resolves.toMatchObject({ ended: 1, failed: 0 });
  });

  it(`allows ${MAX_ACTIVE_PREVIEWS_PER_APP} active previews per app`, async () => {
    for (let index = 0; index < MAX_ACTIVE_PREVIEWS_PER_APP; index += 1) {
      await createPreview({ access, appId, bundleId: bundleIds[index % 2] });
    }
    await expect(createPreview({ access, appId, bundleId: bundleIds[0] })).rejects.toMatchObject({
      code: 'PREVIEW_LIMIT_REACHED',
      status: 409,
    });

    const [first] = (await listPreviews({ organizationId, appId })).previews;
    await revokePreview({ access, appId, previewId: first.id });
    await expect(createPreview({ access, appId, bundleId: bundleIds[0] })).resolves.toBeTruthy();
  });

  it('revokes once, deleting the manifest before marking the preview ended', async () => {
    const preview = await createPreview({ access, appId, bundleId: bundleIds[1] });
    const { token } = await db.bundlePreview.findUniqueOrThrow({ where: { id: preview.id } });

    storage.deleteStorageObject.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(revokePreview({ access, appId, previewId: preview.id })).rejects.toThrow();
    await expect(
      db.bundlePreview.findUniqueOrThrow({ where: { id: preview.id } }),
    ).resolves.toMatchObject({ endedAt: null });

    await expect(revokePreview({ access, appId, previewId: preview.id })).resolves.toEqual({
      status: 'revoked',
      previewId: preview.id,
    });
    expect(storage.deleteStorageObject).toHaveBeenLastCalledWith(
      `manifests/${appId}/__preview_${token}/rt-7/manifest.json`,
    );
    await expect(revokePreview({ access, appId, previewId: preview.id })).resolves.toEqual({
      status: 'already_ended',
      previewId: preview.id,
    });
    await expect(
      db.auditLog.count({ where: { organizationId, action: 'preview.revoked' } }),
    ).resolves.toBe(1);
    await expect(revokePreview({ access, appId, previewId: randomUUID() })).rejects.toMatchObject({
      code: 'PREVIEW_NOT_FOUND',
    });
    await expect(listPreviews({ organizationId, appId })).resolves.toMatchObject({
      previews: [],
    });
  });

  it('ends expired previews from the cron, idempotently', async () => {
    const expired = await createPreview({ access, appId, bundleId: bundleIds[0] });
    const live = await createPreview({ access, appId, bundleId: bundleIds[1] });
    await db.bundlePreview.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(endExpiredPreviews()).resolves.toMatchObject({ ended: 1, failed: 0 });
    await expect(endExpiredPreviews()).resolves.toMatchObject({ ended: 0, failed: 0 });
    const previews = (await listPreviews({ organizationId, appId })).previews;
    expect(previews.map((preview) => preview.id)).toEqual([live.id]);
    await expect(
      db.bundlePreview.findUniqueOrThrow({ where: { id: expired.id } }),
    ).resolves.toMatchObject({ endedAt: expect.any(Date) });
  });

  it('ends previews before their bundle is deleted', async () => {
    const preview = await createPreview({ access, appId, bundleId: bundleIds[1] });
    const { token } = await db.bundlePreview.findUniqueOrThrow({ where: { id: preview.id } });

    await deleteBundle({ access, appId, bundleId: bundleIds[1] });

    expect(storage.deleteStorageObject).toHaveBeenCalledWith(
      `manifests/${appId}/__preview_${token}/rt-7/manifest.json`,
    );
    await expect(db.bundlePreview.count({ where: { id: preview.id } })).resolves.toBe(0);
  });

  it('restores active preview manifests when a workspace is unblocked', async () => {
    const live = await createPreview({ access, appId, bundleId: bundleIds[0] });
    const revoked = await createPreview({ access, appId, bundleId: bundleIds[1] });
    await revokePreview({ access, appId, previewId: revoked.id });
    storage.putTextObject.mockClear();
    storage.deleteStorageObject.mockClear();

    await restoreManifestFilesForApp(appId);

    const { token } = await db.bundlePreview.findUniqueOrThrow({ where: { id: live.id } });
    expect(storage.putTextObject).toHaveBeenCalledTimes(1);
    expect(writtenManifest().storageKey).toBe(
      `manifests/${appId}/__preview_${token}/rt-7/manifest.json`,
    );
    expect(storage.deleteStorageObject).not.toHaveBeenCalled();
  });

  it('does not bring back a preview revoked while the workspace was being restored', async () => {
    const preview = await createPreview({ access, appId, bundleId: bundleIds[0] });
    const { token } = await db.bundlePreview.findUniqueOrThrow({ where: { id: preview.id } });
    storage.putTextObject.mockImplementationOnce(async () => {
      await revokePreview({ access, appId, previewId: preview.id });
    });

    await restoreManifestFilesForApp(appId);

    expect(storage.deleteStorageObject).toHaveBeenLastCalledWith(
      `manifests/${appId}/__preview_${token}/rt-7/manifest.json`,
    );
  });

  it('shows the public page only what the link grants', async () => {
    const preview = await createPreview({
      access,
      appId,
      bundleId: bundleIds[0],
      urlScheme: 'myapp',
    });
    const { token } = await db.bundlePreview.findUniqueOrThrow({ where: { id: preview.id } });

    await expect(getPublicPreview(token)).resolves.toEqual({
      status: 'active',
      appSlug: `preview.${organizationId}`,
      bundleVersion: '2.0.0',
      runtimeVersion: 'rt-7',
      expiresAt: preview.expiresAt,
      deepLink: `myapp://otakit-preview?token=${token}`,
      exitLink: 'myapp://otakit-preview?exit=1',
    });
    await revokePreview({ access, appId, previewId: preview.id });
    await expect(getPublicPreview(token)).resolves.toMatchObject({
      status: 'ended',
      deepLink: null,
      exitLink: 'myapp://otakit-preview?exit=1',
    });
    await expect(getPublicPreview('a'.repeat(26))).resolves.toBeNull();
    await expect(getPublicPreview('../../etc')).resolves.toBeNull();
  });
});
