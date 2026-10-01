import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findReleases: vi.fn(),
  findRelease: vi.fn(),
  findAuditLog: vi.fn(),
  getReleaseHealthWindowCounts: vi.fn(),
  revertRelease: vi.fn(),
  findReleaseSummary: vi.fn(),
  emitNotification: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock('./audit-log', () => ({ recordAuditLog: mocks.recordAuditLog }));
vi.mock('./db', () => ({
  db: {
    release: {
      findMany: mocks.findReleases,
      findFirst: mocks.findRelease,
    },
    auditLog: { findFirst: mocks.findAuditLog },
  },
}));
vi.mock('./notifications/emit', () => ({ emitNotification: mocks.emitNotification }));
vi.mock('./release-features', () => ({ isReleaseReliabilityEnabled: () => true }));
vi.mock('./services/releases', () => ({
  findReleaseSummary: mocks.findReleaseSummary,
  revertRelease: mocks.revertRelease,
  revertReleaseLegacy: vi.fn(),
}));
vi.mock('./tinybird/events', () => ({
  getReleaseHealthWindowCounts: mocks.getReleaseHealthWindowCounts,
}));

import { runAutoRevertSweep } from './auto-revert';
import { OtaKitServiceError } from './services/errors';

describe('auto-revert failure handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it('queues the suppressed alert once, before the audit entry that marks it sent', async () => {
    mocks.findRelease
      .mockReset()
      .mockResolvedValueOnce({ id: 'release-1' })
      .mockResolvedValueOnce({
        revertedBy: 'system:auto-revert',
        revertedAt: new Date('2026-01-01T12:00:00Z'),
      });
    mocks.findAuditLog.mockResolvedValue(null);
    mocks.findReleaseSummary.mockResolvedValue({ id: 'release-1', bundleVersion: '1.0.0' });

    await expect(runAutoRevertSweep(new Date('2026-01-02T00:00:00Z'))).resolves.toMatchObject({
      suppressed: 1,
      reverted: 0,
    });
    expect(mocks.revertRelease).not.toHaveBeenCalled();
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.anything(), {
      type: 'release.auto_revert_suppressed',
      key: 'release.auto_revert_suppressed:release-1',
      organizationId: 'org-1',
      appId: 'app-1',
      actor: { actorType: 'system', actorLabel: 'auto-revert' },
      data: {
        release: { id: 'release-1', bundleVersion: '1.0.0' },
        health: {
          rollbacks: 10,
          attempts: 20,
          measuredRatePercent: 50,
          ratePercent: 20,
          minSample: 10,
          windowHours: 24,
        },
      },
    });
    expect(mocks.emitNotification.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordAuditLog.mock.invocationCallOrder[0],
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
});
