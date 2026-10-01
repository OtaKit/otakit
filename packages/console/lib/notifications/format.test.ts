import { describe, expect, it } from 'vitest';

import type { ReleaseSummary } from '@/lib/services/releases';

import type { NotificationContext, NotificationPayload } from './events';
import { describeEvent, discordMessage, emailMessage, slackMessage } from './format';

function release(overrides: Partial<ReleaseSummary> = {}): ReleaseSummary {
  return {
    id: 'release-1',
    channel: 'production',
    runtimeVersion: '2026.10',
    bundleId: 'bundle-1',
    bundleVersion: '1.4.2',
    previousBundleId: 'bundle-0',
    previousBundleVersion: '1.4.1',
    forceImmediate: false,
    autoRevert: true,
    autoRevertRatePercent: 20,
    autoRevertMinSample: 50,
    rolloutPercent: 100,
    promotedAt: '2026-10-01T12:00:00.000Z',
    promotedBy: 'dev@acme.com',
    revertedAt: null,
    revertedBy: null,
    ...overrides,
  };
}

const context: NotificationContext = {
  organization: { id: 'org-1', name: 'Acme' },
  app: { id: 'app-1', slug: 'com.acme.app' },
  actor: { type: 'user', label: 'dev@acme.com' },
  url: 'https://console.example/dashboard?app=app-1',
};

const health = {
  rollbacks: 12,
  attempts: 50,
  measuredRatePercent: 24,
  ratePercent: 20,
  minSample: 50,
  windowHours: 24,
};

/** A payload of `type` with `data` over the shared context fields. */
function payload(type: NotificationPayload['type'], data: Record<string, unknown>) {
  return {
    type,
    timestamp: '2026-10-01T12:00:00.000Z',
    data: { ...context, ...data },
  } as unknown as NotificationPayload;
}

describe('describeEvent', () => {
  it('describes a release', () => {
    expect(
      describeEvent(
        payload('release.published', {
          release: release(),
          previousRelease: release({ id: 'release-0', bundleVersion: '1.4.1' }),
        }),
      ),
    ).toEqual({
      title: 'Released com.acme.app 1.4.2 (production / runtime 2026.10)',
      lines: ['Previous release: 1.4.1.', 'By dev@acme.com.'],
      severity: 'success',
      url: context.url,
    });
  });

  it('describes a first release that starts a rollout on the base channel', () => {
    const event = describeEvent(
      payload('release.published', {
        release: release({ channel: null, runtimeVersion: null, rolloutPercent: 10 }),
        previousRelease: null,
      }),
    );
    expect(event.title).toBe('Released com.acme.app 1.4.2 (base)');
    expect(event.lines).toEqual([
      'Rolling out to 10% of devices.',
      'First release on this lane.',
      'By dev@acme.com.',
    ]);
  });

  it('describes rollout steps and completion', () => {
    expect(
      describeEvent(
        payload('release.rollout_updated', {
          release: release({ rolloutPercent: 50 }),
          previousPercent: 10,
        }),
      ).title,
    ).toBe('Rollout of com.acme.app 1.4.2 (production / runtime 2026.10): 10% → 50%');
    expect(
      describeEvent(payload('release.rollout_updated', { release: release(), previousPercent: 50 }))
        .title,
    ).toBe('Rollout complete: com.acme.app 1.4.2 (production / runtime 2026.10)');
  });

  it('describes a revert and a cancelled rollout', () => {
    expect(
      describeEvent(
        payload('release.reverted', {
          release: release(),
          currentRelease: release({ id: 'release-0', bundleVersion: '1.4.1' }),
        }),
      ).lines,
    ).toEqual(['Devices now receive 1.4.1.', 'By dev@acme.com.']);
    expect(
      describeEvent(
        payload('release.reverted', {
          release: release({ rolloutPercent: 10 }),
          currentRelease: null,
        }),
      ).title,
    ).toBe('Cancelled the rollout of com.acme.app 1.4.2 (production / runtime 2026.10)');
  });

  it('keeps the auto-revert alert copy', () => {
    const event = describeEvent(
      payload('release.auto_reverted', {
        release: release(),
        currentRelease: null,
        health,
        actor: { type: 'system', label: 'auto-revert' },
      }),
    );
    expect(event).toMatchObject({
      title: 'Auto-reverted com.acme.app 1.4.2 (production / runtime 2026.10)',
      severity: 'critical',
    });
    expect(event.lines).toEqual([
      'Release 1.4.2: 12 of 50 devices rolled back (24%) in the last 24 hours (trigger: >=20% of >=50).',
      'Reverted automatically. No previous release on this lane — new installs receive the built-in bundle.',
    ]);
    expect(
      describeEvent(payload('release.auto_revert_suppressed', { release: release(), health }))
        .title,
    ).toBe('Auto-revert suppressed for com.acme.app (production / runtime 2026.10)');
  });

  it('describes uploads and usage', () => {
    expect(
      describeEvent(
        payload('bundle.uploaded', {
          bundle: {
            id: 'bundle-1',
            version: '1.4.2',
            runtimeVersion: null,
            size: 2_202_009,
            strategy: 'zip',
            createdAt: '2026-10-01T12:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      title: 'Uploaded com.acme.app 1.4.2',
      lines: ['2.1 MB.', 'By dev@acme.com.'],
    });
    expect(
      describeEvent(
        payload('usage.warning', {
          app: null,
          actor: null,
          usage: {
            threshold: 90,
            downloadsCount: 4500,
            limit: 5000,
            periodStart: '2026-10-01T00:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      title: 'Usage reached 90% for Acme',
      lines: ['90% threshold reached for October 2026.', 'Downloads: 4,500 / 5,000'],
    });
  });
});

describe('message formats', () => {
  const hostile = payload('release.published', {
    organization: { id: 'org-1', name: 'Acme <script>' },
    app: { id: 'app-1', slug: 'a&b<c>' },
    release: release(),
    previousRelease: null,
  });

  it('escapes Slack control characters and links to the dashboard', () => {
    const message = slackMessage(hostile) as {
      text: string;
      blocks: Array<{ text?: { text: string }; elements?: Array<{ text: string }> }>;
    };
    expect(message.text).toContain('a&b<c>');
    expect(message.blocks[0].text?.text).toContain('*Released a&amp;b&lt;c&gt; 1.4.2');
    expect(message.blocks[1].elements?.[0].text).toBe(
      `<${context.url}|Open in OtaKit> · Acme &lt;script&gt;`,
    );
  });

  it('builds one Discord embed with mentions disabled', () => {
    expect(discordMessage(hostile)).toEqual({
      embeds: [
        {
          title: 'Released a&b<c> 1.4.2 (production / runtime 2026.10)',
          description: 'First release on this lane.\nBy dev@acme.com.',
          url: context.url,
          color: 0x22c55e,
          timestamp: '2026-10-01T12:00:00.000Z',
          footer: { text: 'Acme <script>' },
        },
      ],
      allowed_mentions: { parse: [] },
    });
  });

  it('escapes email HTML and says why the email was sent', () => {
    const message = emailMessage(hostile, 'Releases');
    expect(message.subject).toBe('Released a&b<c> 1.4.2 (production / runtime 2026.10)');
    expect(message.html).toContain('a&amp;b&lt;c&gt;');
    expect(message.html).not.toContain('<script>');
    expect(message.text).toContain(
      'You receive this because "Releases" in Acme <script> includes release published notifications.',
    );
    expect(message.text).toContain(
      'Notification settings: https://console.example/dashboard/settings',
    );
  });
});
