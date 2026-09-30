import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findBundle: vi.fn(),
  findRelease: vi.fn(),
  deleteBundleRow: vi.fn(),
  deleteBundleObject: vi.fn(),
  purgeCdnUrls: vi.fn(),
  buildPublicObjectUrl: vi.fn(),
  accessActor: vi.fn(),
  recordAuditLog: vi.fn(),
  endBundlePreviews: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    bundle: { findUnique: mocks.findBundle, delete: mocks.deleteBundleRow },
    release: { findFirst: mocks.findRelease },
  },
}));
vi.mock('@/lib/storage', () => ({
  deleteBundleObject: mocks.deleteBundleObject,
  buildPublicObjectUrl: mocks.buildPublicObjectUrl,
}));
vi.mock('@/lib/cdn-purge', () => ({ purgeCdnUrls: mocks.purgeCdnUrls }));
vi.mock('@/lib/audit-log', () => ({
  accessActor: mocks.accessActor,
  recordAuditLog: mocks.recordAuditLog,
}));
vi.mock('./previews', () => ({ endBundlePreviews: mocks.endBundlePreviews }));

import { deleteBundle } from './bundles';

const access = {
  organizationId: 'org-1',
  actorType: 'user' as const,
  actorId: 'user-1',
  role: 'member' as const,
};

describe('bundle services', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findBundle.mockResolvedValue({
      id: 'bundle-1',
      appId: 'app-1',
      version: '1.0.0',
      storageKey: 'bundles/app-1/bundle.zip',
    });
    mocks.accessActor.mockResolvedValue({ actorType: 'user', actorLabel: 'user@example.com' });
    mocks.buildPublicObjectUrl.mockReturnValue('https://cdn.example/bundle.zip');
  });

  it('rejects deletion whenever release history references the bundle', async () => {
    mocks.findRelease.mockResolvedValue({ id: 'release-1' });

    await expect(
      deleteBundle({ access, appId: 'app-1', bundleId: 'bundle-1' }),
    ).rejects.toMatchObject({
      code: 'BUNDLE_IN_RELEASE_HISTORY',
      status: 409,
    });
    expect(mocks.deleteBundleRow).not.toHaveBeenCalled();
    expect(mocks.deleteBundleObject).not.toHaveBeenCalled();
  });

  it('deletes an unused bundle, audits it, then cleans storage', async () => {
    mocks.findRelease.mockResolvedValue(null);

    const result = await deleteBundle({
      access,
      appId: 'app-1',
      bundleId: 'bundle-1',
      auditMetadata: { client: 'mcp' },
    });

    expect(result).toEqual({ deleted: true, id: 'bundle-1', storageDeleted: true });
    // Preview manifests point at the bundle's storage object, so they go first.
    expect(mocks.endBundlePreviews).toHaveBeenCalledWith('bundle-1');
    expect(mocks.endBundlePreviews.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteBundleRow.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteBundleRow).toHaveBeenCalledWith({ where: { id: 'bundle-1' } });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { appId: 'app-1', version: '1.0.0', client: 'mcp' } }),
    );
    expect(mocks.deleteBundleObject).toHaveBeenCalledWith('bundles/app-1/bundle.zip');
  });
});
