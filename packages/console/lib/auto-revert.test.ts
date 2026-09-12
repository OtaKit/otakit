import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findReleases: vi.fn(),
  findRelease: vi.fn(),
  getReleaseHealthWindowCounts: vi.fn(),
  revertRelease: vi.fn(),
  prepareRevert: vi.fn(),
  isReleaseReliabilityEnabled: vi.fn(),
}));

vi.mock('./audit-log', () => ({ recordAuditLog: vi.fn() }));
vi.mock('./db', () => ({
  db: {
    release: {
      findMany: mocks.findReleases,
      findFirst: mocks.findRelease,
    },
    organizationMember: { findMany: vi.fn() },
    auditLog: { findFirst: vi.fn() },
  },
}));
vi.mock('./email', () => ({ sendAutoRevertEmail: vi.fn() }));
vi.mock('./release-features', () => ({
  isReleaseReliabilityEnabled: mocks.isReleaseReliabilityEnabled,
}));
vi.mock('./releases', () => ({ revertCurrentRelease: vi.fn() }));
vi.mock('./services/releases', () => ({
  revertRelease: mocks.revertRelease,
  prepareRevert: mocks.prepareRevert,
}));
vi.mock('./tinybird/events', () => ({
  getReleaseHealthWindowCounts: mocks.getReleaseHealthWindowCounts,
}));

import { runAutoRevertSweep } from './auto-revert';
import { OtaKitServiceError } from './services/errors';

describe('auto-revert failure handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isReleaseReliabilityEnabled.mockReturnValue(true);
    mocks.findReleases.mockResolvedValue([
      {
        id: 'release-1',
        appId: 'app-1',
        channel: null,
        autoRevertRatePercent: 20,
        autoRevertMinSample: 10,
        bundle: { version: '1.0.0', runtimeVersion: null },
        app: { slug: 'example', organizationId: 'org-1' },
      },
    ]);
    mocks.findRelease.mockResolvedValueOnce({ id: 'release-1' }).mockResolvedValueOnce(null);
    mocks.getReleaseHealthWindowCounts.mockResolvedValue(
      new Map([['release-1', { applied: 10, rollbacks: 10 }]]),
    );
  });

  it('ignores a stale candidate when another release wins the lane', async () => {
    mocks.revertRelease.mockRejectedValue(
      new OtaKitServiceError('STALE_RELEASE_STATE', 'The release lane changed', 409),
    );

    await expect(runAutoRevertSweep(new Date('2026-01-02T00:00:00Z'))).resolves.toMatchObject({
      releasesEvaluated: 1,
      reverted: 0,
    });
  });

  it('surfaces unexpected storage failures instead of misreporting a race', async () => {
    mocks.revertRelease.mockRejectedValue(new Error('database unavailable'));

    await expect(runAutoRevertSweep(new Date('2026-01-02T00:00:00Z'))).rejects.toThrow(
      'database unavailable',
    );
  });

  it('persists alert details when manifest synchronization remains pending', async () => {
    mocks.revertRelease.mockResolvedValue({
      operationId: 'operation-1',
      publicationStatus: 'manifest_sync_pending',
    });

    await expect(runAutoRevertSweep(new Date('2026-01-02T00:00:00Z'))).resolves.toMatchObject({
      releasesEvaluated: 1,
      reverted: 0,
    });
    expect(mocks.revertRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: 'release-1',
        autoRevertAlertPayload: expect.objectContaining({
          bundleVersion: '1.0.0',
          rollbacks: 10,
          attempts: 20,
        }),
      }),
    );
  });

  it('keeps RN auto-revert lanes separate and uses prepared durable reversion even with the legacy flag off', async () => {
    mocks.isReleaseReliabilityEnabled.mockReturnValue(false);
    mocks.findReleases.mockResolvedValue(
      ['ios', 'android'].map((platform) => ({
        id: `release-${platform}`,
        appId: 'app-1',
        channel: null,
        autoRevertRatePercent: 20,
        autoRevertMinSample: 10,
        bundle: { version: '1.0.0', runtimeVersion: 'same-runtime', platform },
        app: { slug: 'rn-app', organizationId: 'org-1', framework: 'react_native' },
      })),
    );
    mocks.findRelease.mockReset();
    mocks.findRelease.mockImplementation(async ({ where }) =>
      where.revertedAt === null ? { id: `release-${where.platform}` } : null,
    );
    mocks.getReleaseHealthWindowCounts.mockResolvedValue(
      new Map([
        ['release-ios', { applied: 10, rollbacks: 10 }],
        ['release-android', { applied: 10, rollbacks: 10 }],
      ]),
    );
    const rnIntent = {
      version: 1,
      actorKey: 'system:auto-revert',
      preparedAt: '2026-09-11T00:00:00.000Z',
    };
    mocks.prepareRevert.mockResolvedValue({ rnIntent });
    mocks.revertRelease.mockResolvedValue({
      operationId: 'operation',
      publicationStatus: 'manifest_sync_pending',
    });
    await expect(runAutoRevertSweep()).resolves.toMatchObject({ releasesEvaluated: 2 });
    expect(mocks.prepareRevert).toHaveBeenCalledTimes(2);
    for (const platform of ['ios', 'android']) {
      expect(mocks.findRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ platform, runtimeVersion: 'same-runtime' }),
        }),
      );
      expect(mocks.revertRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          releaseId: `release-${platform}`,
          expectedCurrentReleaseId: `release-${platform}`,
          rnIntent,
        }),
      );
    }
  });
});
