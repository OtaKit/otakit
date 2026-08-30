import { describe, expect, it, vi } from 'vitest';

import {
  deliverPendingAutoRevertAlerts,
  parseAutoRevertAlertPayload,
  type AutoRevertAlertPayload,
} from './auto-revert-alerts';

const payload: AutoRevertAlertPayload = {
  appId: 'app-1',
  channel: null,
  runtimeVersion: null,
  bundleVersion: '2.0.0',
  rollbacks: 12,
  attempts: 20,
  measuredRatePercent: 60,
  ratePercent: 20,
  minSample: 10,
  windowHours: 24,
};

function database(published: boolean) {
  return {
    release: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'release-1',
          autoRevertAlertPayload: payload,
          app: { organizationId: 'org-1', slug: 'example' },
        },
      ]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    releaseMutation: {
      findMany: vi.fn().mockResolvedValue(
        published
          ? [
              {
                releaseId: 'release-1',
                result: { currentRelease: { bundleVersion: '1.0.0' } },
              },
            ]
          : [],
      ),
    },
    organizationMember: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { user: { email: 'owner@example.test' } },
          { user: { email: 'owner@example.test' } },
        ]),
    },
  };
}

describe('durable auto-revert alerts', () => {
  it('delivers and marks an alert after its release mutation is published', async () => {
    const mockDatabase = database(true);
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const now = new Date('2026-01-02T00:00:00Z');

    await expect(
      deliverPendingAutoRevertAlerts({ now }, { database: mockDatabase as never, sendEmail }),
    ).resolves.toEqual({ checked: 1, sent: 1, pending: 0 });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.test',
        bundleVersion: '2.0.0',
        revertedToVersion: '1.0.0',
      }),
    );
    expect(mockDatabase.release.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { autoRevertAlertedAt: now, autoRevertAlertClaimedAt: null },
      }),
    );
  });

  it('keeps the alert pending until manifest reconciliation publishes the mutation', async () => {
    const mockDatabase = database(false);
    const sendEmail = vi.fn();

    await expect(
      deliverPendingAutoRevertAlerts({}, { database: mockDatabase as never, sendEmail }),
    ).resolves.toEqual({ checked: 1, sent: 0, pending: 1 });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockDatabase.release.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed persisted payloads', () => {
    expect(parseAutoRevertAlertPayload({ ...payload, attempts: 'twenty' })).toBeNull();
  });
});
