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
    notes: null,
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
  actor: { type: 'user', id: 'user-1', label: 'dev@acme.com' },
  dashboardUrl: 'https://console.example/dashboard?org=org-1&app=app-1',
};

const health = {
  rollbacks: 12,
  attempts: 50,
  rollbackSharePercent: 24,
  thresholdPercent: 20,
  thresholdMinSample: 50,
  windowHours: 24,
};

/** A payload of `type` with `data` over the shared context fields. */
function payload(type: NotificationPayload['type'], data: Record<string, unknown>) {
  return {
    id: 'evt_1',
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
      notes: null,
      severity: 'success',
      url: context.dashboardUrl,
    });
  });

  it('describes a release that starts a rollout', () => {
    const event = describeEvent(
      payload('release.published', {
        release: release({ channel: null, runtimeVersion: null, rolloutPercent: 10 }),
        previousRelease: release({ id: 'release-0', bundleVersion: '1.4.1' }),
        actor: { type: 'api_key', id: 'key-1', label: 'CI' },
      }),
    );
    expect(event.title).toBe('Started rollout of com.acme.app 1.4.2 to 10% (base)');
    expect(event.lines).toEqual([
      '10% of devices on this lane receive it; the rest stay on 1.4.1.',
      'By API key "CI".',
    ]);
  });

  it('carries release notes, trimmed', () => {
    expect(
      describeEvent(
        payload('release.published', {
          release: release({ notes: '  Faster checkout.\nPhoto upload fixed.  ' }),
          previousRelease: null,
        }),
      ).notes,
    ).toBe('Faster checkout.\nPhoto upload fixed.');
    expect(
      describeEvent(
        payload('release.published', { release: release({ notes: '   ' }), previousRelease: null }),
      ).notes,
    ).toBeNull();
  });

  it('describes rollout steps and completion', () => {
    expect(
      describeEvent(
        payload('release.rollout_updated', {
          release: release({ rolloutPercent: 50 }),
          previousRolloutPercent: 10,
        }),
      ).title,
    ).toBe('Rollout of com.acme.app 1.4.2 (production / runtime 2026.10): 10% → 50%');
    expect(
      describeEvent(
        payload('release.rollout_updated', { release: release(), previousRolloutPercent: 50 }),
      ).title,
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

  it('describes auto-revert outcomes with event counts, not devices', () => {
    const event = describeEvent(
      payload('release.auto_reverted', {
        release: release(),
        currentRelease: null,
        health,
        actor: { type: 'system', id: null, label: 'auto-revert' },
      }),
    );
    expect(event).toMatchObject({
      title: 'Auto-reverted com.acme.app 1.4.2 (production / runtime 2026.10)',
      severity: 'critical',
    });
    expect(event.lines).toEqual([
      '12 of 50 update attempts rolled back (24%) in the last 24 hours. Threshold: ≥20% of ≥50.',
      'Reverted automatically. No previous release on this lane — new installs receive the built-in bundle.',
    ]);
    expect(
      describeEvent(payload('release.auto_revert_suppressed', { release: release(), health }))
        .title,
    ).toBe(
      'Action needed: com.acme.app 1.4.2 is unhealthy and was not auto-reverted (production / runtime 2026.10)',
    );
  });

  it('describes uploads, usage and tests', () => {
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
            downloadsLimit: 5000,
            periodStart: '2026-10-01T00:00:00.000Z',
          },
        }),
      ),
    ).toMatchObject({
      title: 'Usage reached 90% for Acme',
      lines: ["90% of the plan's downloads used in October 2026.", 'Downloads: 4,500 of 5,000.'],
    });
    expect(
      describeEvent(
        payload('test.ping', {
          app: null,
          message: 'This destination receives OtaKit notifications.',
        }),
      ).lines,
    ).toEqual(['This destination receives OtaKit notifications.', 'Sent by dev@acme.com.']);
  });
});

describe('message formats', () => {
  const hostile = payload('release.published', {
    organization: { id: 'org-1', name: 'Acme <script>' },
    app: { id: 'app-1', slug: 'a&b<c>' },
    release: release({ bundleVersion: '[x](https://evil.test)' }),
    previousRelease: null,
  });

  it('escapes Slack control characters, colors by severity and links to the dashboard', () => {
    const message = slackMessage(hostile) as {
      text: string;
      attachments: Array<{
        color: string;
        blocks: Array<{ text?: { text: string }; elements?: Array<{ text: string }> }>;
      }>;
    };
    expect(message.text).toBe(
      'Released a&amp;b&lt;c&gt; [x](https://evil.test) (production / runtime 2026.10)',
    );
    const [attachment] = message.attachments;
    expect(attachment.color).toBe('#22c55e');
    expect(attachment.blocks[0].text?.text).toContain('*Released a&amp;b&lt;c&gt; ');
    expect(attachment.blocks[1].elements?.[0].text).toBe(
      `<${context.dashboardUrl}|Open in OtaKit> · Acme &lt;script&gt;`,
    );
  });

  it('shows release notes as plain text in Slack', () => {
    const message = slackMessage(
      payload('release.published', {
        release: release({ notes: 'Faster *checkout* <!channel>' }),
        previousRelease: null,
      }),
    ) as {
      attachments: Array<{
        blocks: Array<{ type: string; text?: { type: string; text: string } }>;
      }>;
    };
    expect(message.attachments[0].blocks[1]).toEqual({
      type: 'section',
      text: {
        type: 'plain_text',
        text: 'Release notes:\nFaster *checkout* <!channel>',
        emoji: false,
      },
    });
  });

  it('builds one Discord embed with Markdown escaped and mentions disabled', () => {
    expect(discordMessage(hostile)).toEqual({
      embeds: [
        {
          title: 'Released a&b<c> [x](https://evil.test) (production / runtime 2026.10)',
          description: 'First release on this lane.\nBy dev@acme.com.',
          url: context.dashboardUrl,
          color: 0x22c55e,
          timestamp: '2026-10-01T12:00:00.000Z',
          footer: { text: 'Acme <script>' },
        },
      ],
      allowed_mentions: { parse: [] },
    });
    const withNotes = discordMessage(
      payload('release.published', {
        release: release({ notes: 'Fixed _photo_ upload' }),
        previousRelease: null,
      }),
    ) as { embeds: Array<{ description: string }> };
    expect(withNotes.embeds[0].description).toBe(
      'First release on this lane.\nBy dev@acme.com.\n\n**Release notes**\nFixed \\_photo\\_ upload',
    );
  });

  it('escapes email HTML, shows notes and says why the email was sent', () => {
    const message = emailMessage(hostile, 'Releases');
    expect(message.subject).toBe(
      'Released a&b<c> [x](https://evil.test) (production / runtime 2026.10)',
    );
    expect(message.html).toContain('a&amp;b&lt;c&gt;');
    expect(message.html).not.toContain('<script>');
    expect(message.text).toContain(
      'You get this email because the "Releases" destination in Acme <script> includes "Release published". Owners and admins can change this in Settings → Notifications.',
    );
    expect(message.text).toContain(
      'Notification settings: https://console.example/dashboard/settings?org=org-1#notifications',
    );

    const withNotes = emailMessage(
      payload('release.published', {
        release: release({ notes: 'Faster <b>checkout</b>' }),
        previousRelease: null,
      }),
      'Releases',
    );
    expect(withNotes.html).toContain(
      '<p style="white-space: pre-line;">Faster &lt;b&gt;checkout&lt;/b&gt;</p>',
    );
    expect(withNotes.text).toContain('Release notes:\nFaster <b>checkout</b>');
  });
});

describe('error alerts', () => {
  const issue = {
    id: 'issue-1',
    fingerprint: '0123456789abcdef',
    title: 'TypeError: Visit <https://evil.example|here> `now` *bold*',
    topFrame: 'computeTotal (assets/index.js)',
    status: 'open',
    events: 1234,
    firstSeenAt: '2026-10-14T09:05:00.000Z',
    lastSeenAt: '2026-10-14T12:00:00.000Z',
    firstReleaseId: 'release-1',
  };

  it('describes a new issue, with the device text as code', () => {
    expect(describeEvent(payload('errors.new_issue', { issue, actor: null }))).toEqual({
      title: 'New error in com.acme.app',
      code: [issue.title, 'at computeTotal (assets/index.js)'],
      lines: ['1,234 events since Oct 14, 09:05 UTC.'],
      notes: null,
      severity: 'warning',
      url: context.dashboardUrl,
    });
  });

  it('describes a regression', () => {
    const event = describeEvent(
      payload('errors.regression', {
        issue: { ...issue, topFrame: null },
        previouslyResolvedAt: '2026-10-10T08:00:00.000Z',
        release: release({ bundleVersion: '1.4.3' }),
        actor: null,
      }),
    );
    expect(event.title).toBe('Error came back in com.acme.app');
    expect(event.code).toEqual([issue.title]);
    expect(event.lines).toEqual([
      'Resolved Oct 10, 08:00 UTC, seen again in 1.4.3 (production / runtime 2026.10) Oct 14, 12:00 UTC. The issue is open again.',
    ]);
  });

  it('describes a spike against the previous release', () => {
    const errors = {
      events: 120,
      applies: 4000,
      perThousandApplies: 30,
      previousEvents: 40,
      previousApplies: 8000,
      previousPerThousandApplies: 5,
      issues: 1,
    };
    const spike = (overrides = {}) =>
      describeEvent(
        payload('errors.spike', {
          release: release(),
          previousRelease: release({ id: 'release-0', bundleVersion: '1.4.1' }),
          errors: { ...errors, ...overrides },
          actor: null,
        }),
      );
    expect(spike()).toMatchObject({
      title: 'Error spike: com.acme.app 1.4.2 (production / runtime 2026.10)',
      lines: [
        '30 error events per 1,000 applies on plugin 3.4+; 6.0× the rate of 1.4.1 (5.0).',
        '120 error events in 1 issue, 4,000 applies.',
      ],
      severity: 'critical',
    });
    expect(spike({ previousEvents: 0, previousPerThousandApplies: 0 }).lines[0]).toBe(
      '30 error events per 1,000 applies on plugin 3.4+; 1.4.1 had no errors.',
    );
    // A tiny previous rate rounds to 0.0 in the payload; the text uses the counts.
    expect(
      spike({ previousEvents: 1, previousApplies: 30_000, previousPerThousandApplies: 0 }).lines[0],
    ).toBe('30 error events per 1,000 applies on plugin 3.4+; 900.0× the rate of 1.4.1 (<0.1).');
  });

  it('describes a paused workspace', () => {
    expect(
      describeEvent(
        payload('errors.paused', {
          app: null,
          actor: null,
          errorUsage: { events: 10_000, limit: 10_000, pausedUntil: '2026-11-01T00:00:00.000Z' },
        }),
      ),
    ).toMatchObject({
      title: 'Error tracking paused for Acme',
      lines: [
        '10,000 of 10,000 error events this month. New errors are not recorded until November 1.',
        'Upgrade the plan to resume now.',
      ],
    });
  });

  it('never renders device text as markup or links', () => {
    const event = payload('errors.new_issue', { issue, actor: null });
    const slack = JSON.stringify(slackMessage(event));
    expect(slack).toContain("`TypeError: Visit &lt;https://evil.example|here&gt; 'now' *bold*`");
    expect(slack).not.toContain('<https://evil.example');
    expect((slackMessage(event) as { text: string }).text).toBe('New error in com.acme.app');

    const discord = discordMessage(event) as {
      embeds: Array<{ title: string; description: string }>;
    };
    expect(discord.embeds[0].title).toBe('New error in com.acme.app');
    expect(discord.embeds[0].description.split('\n')[0]).toBe(
      "`TypeError: Visit <https://evil.example|here> 'now' *bold*`",
    );

    const email = emailMessage(event, 'Owners and admins');
    expect(email.subject).toBe('New error in com.acme.app');
    expect(email.html).toContain(
      '<p><code>TypeError: Visit &lt;https://evil.example|here&gt; &#39;now&#39; *bold*</code></p>',
    );
    expect(email.text).toContain("TypeError: Visit <https://evil.example|here> 'now' *bold*");
  });
});

describe('analytics alerts', () => {
  it('describes paused analytics', () => {
    expect(
      describeEvent(
        payload('analytics.paused', {
          app: null,
          actor: null,
          eventUsage: { events: 100_000, limit: 100_000, pausedUntil: '2026-11-01T00:00:00.000Z' },
        }),
      ),
    ).toMatchObject({
      title: 'Analytics paused for Acme',
      lines: [
        '100,000 of 100,000 custom events this month. New events are not recorded until November 1.',
        'Upgrade the plan to resume now.',
      ],
      severity: 'warning',
    });
  });
});

describe('A/B test notifications', () => {
  const experiment = {
    id: 'exp-1',
    key: 'paywall_copy',
    name: 'Paywall copy',
    status: 'running',
    channel: null,
    goalEvent: 'purchase_completed',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'b', weight: 50 },
    ],
    startedAt: '2026-10-01T12:00:00.000Z',
    stoppedAt: null,
    shippedVariant: null,
  };
  const variants = [
    { key: 'control', exposed: 1000, converted: 100, rate: 0.1, probabilityBest: 0.02, errors: 2 },
    { key: 'b', exposed: 1000, converted: 130, rate: 0.13, probabilityBest: 0.98, errors: 30 },
  ];

  it('describes starts, stops and shipped variants', () => {
    expect(describeEvent(payload('experiment.started', { experiment }))).toMatchObject({
      title: 'A/B test started: Paywall copy (com.acme.app)',
      lines: [
        'Runs on the base config: control 50%, b 50%. Goal: purchase_completed.',
        'By dev@acme.com.',
      ],
      severity: 'info',
    });
    expect(
      describeEvent(
        payload('experiment.stopped', { experiment: { ...experiment, channel: 'beta' } }),
      ).lines[0],
    ).toBe('Every device gets the beta config without test values again.');
    expect(
      describeEvent(
        payload('experiment.stopped', {
          experiment: { ...experiment, status: 'shipped', shippedVariant: 'b' },
        }),
      ),
    ).toMatchObject({
      title: 'A/B test ended, b shipped: Paywall copy (com.acme.app)',
      lines: [
        'The values of b are now part of the base config for every device.',
        'By dev@acme.com.',
      ],
      severity: 'success',
    });
  });

  it('describes verdicts', () => {
    expect(
      describeEvent(
        payload('experiment.verdict_reached', {
          actor: null,
          experiment,
          variants,
          verdict: { kind: 'winner', variant: 'b', probability: 0.9812 },
        }),
      ),
    ).toMatchObject({
      title: 'A/B test result: b is better in Paywall copy (com.acme.app)',
      lines: [
        '98.1% probability that b is the best variant for purchase_completed.',
        'control: 10.0% of 1,000 devices converted',
        'b: 13.0% of 1,000 devices converted',
        'Ship b from the dashboard to give every device its values.',
      ],
      severity: 'success',
    });
    expect(
      describeEvent(
        payload('experiment.verdict_reached', {
          actor: null,
          experiment,
          variants,
          verdict: { kind: 'guardrail', variant: 'b', probability: 0.99 },
        }),
      ),
    ).toMatchObject({
      title: 'A/B test warning: b has more errors in Paywall copy (com.acme.app)',
      lines: [
        '3.0% of devices on b had an error after joining the test, against 0.2% on control (99% probability that b is worse).',
        'Consider stopping the test.',
      ],
      severity: 'warning',
    });
    expect(
      describeEvent(
        payload('experiment.verdict_reached', {
          actor: null,
          experiment,
          variants,
          verdict: { kind: 'no_difference' },
        }),
      ).title,
    ).toBe('A/B test result: no clear difference in Paywall copy (com.acme.app)');
  });
});
