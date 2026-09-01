import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOrganization: vi.fn(),
  resolveReleaseActor: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { organization: { findUnique: mocks.findOrganization } },
}));
vi.mock('@/lib/release-audit', () => ({ resolveReleaseActor: mocks.resolveReleaseActor }));

import { getConnectionContext } from './context';

describe('connection context capabilities', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('reports analytics from the same Tinybird read-token configuration used by queries', async () => {
    vi.stubEnv('TINYBIRD_READ_TOKEN', 'read-token');
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'false');
    mocks.findOrganization.mockResolvedValue({ id: 'org-1', name: 'Example' });
    mocks.resolveReleaseActor.mockResolvedValue('user@example.test');

    const context = await getConnectionContext({
      organizationId: 'org-1',
      actorType: 'user',
      actorId: 'user-1',
      role: 'member',
    });

    expect(context.capabilities).toEqual({
      analytics: true,
      organizationKey: false,
      releaseReliability: false,
    });
  });
});
