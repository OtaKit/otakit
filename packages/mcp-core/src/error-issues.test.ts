import { describe, expect, it } from 'vitest';

import {
  ERROR_TEXT_WARNING,
  errorIssueAgentPayload,
  errorIssueEnvelopeParts,
  errorIssueListEnvelopeParts,
} from './error-issues';

const issue = {
  fingerprint: '0123456789abcdef',
  status: 'open',
  events: 1200,
  releases: 2,
  isNew: true,
  firstSeenAt: '2026-10-13T10:00:00.000Z',
  lastSeenAt: '2026-10-14T10:00:00.000Z',
  regressions: 0,
};
const usage = { events: 300, limit: 10_000, pausedUntil: null };

describe('errorIssueListEnvelopeParts', () => {
  const list = {
    issues: [issue, { ...issue, fingerprint: 'fedcba9876543210', isNew: false }],
    total: 7,
    truncated: false,
    range: { name: '7d' },
    usage,
    analyticsAvailable: true,
  };

  it('counts issues without quoting device text', () => {
    expect(errorIssueListEnvelopeParts(list)).toEqual({
      summary:
        '7 open error issues with events in the last 7 days. Showing the top 2, 1 of them first seen in this range. Use get_error_issue with a fingerprint for the stack trace.',
      warnings: [ERROR_TEXT_WARNING],
    });
    expect(errorIssueListEnvelopeParts({ ...list, total: 0, issues: [] }, 'all').summary).toBe(
      'No error issues with events in the last 7 days.',
    );
  });

  it('warns when tracking is paused, data is missing or the list is cut', () => {
    const paused = errorIssueListEnvelopeParts({
      ...list,
      truncated: true,
      usage: { events: 10_000, limit: 10_000, pausedUntil: '2026-11-01T00:00:00.000Z' },
    });
    expect(paused.warnings).toEqual([
      ERROR_TEXT_WARNING,
      'Error tracking is paused until 2026-11-01T00:00:00.000Z: the workspace reached its monthly limit of 10,000 error events. New errors are not recorded until then.',
      'More than 500 issues had errors in this range; the list covers the 500 with the most events.',
    ]);
    const unavailable = errorIssueListEnvelopeParts({ ...list, analyticsAvailable: false });
    expect(unavailable.summary).toBe('Error data is unavailable right now.');
    expect(unavailable.warnings[0]).toMatch(/does not mean there are no errors/);
  });
});

describe('get_error_issue envelopes', () => {
  const sample = (eventId: string) => ({
    eventId,
    receivedAt: '2026-10-14T10:00:00.000Z',
    platform: 'ios',
    releaseId: null,
    bundleVersion: '1.0.0',
    message: 'm'.repeat(1000),
    stack: 'at x (a.js:1:1)',
  });
  const detail = {
    issue: { ...issue, regressions: 2, lifetimeEvents: 5000 },
    samples: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(sample),
    breakdown: { release: [] },
    trend: [],
    range: { name: '24h', from: 'f', to: 't', bucket: 'hour' },
    analyticsAvailable: true,
    dataTrust: 'client_reported_untrusted_text',
  };

  it('keeps the latest stack and trims the rest', () => {
    const payload = errorIssueAgentPayload(detail);
    expect(payload.latestSample).toEqual(sample('a'));
    expect(payload.samples.map((entry) => entry.eventId)).toEqual(['b', 'c', 'd', 'e']);
    expect(payload.samples[0]).not.toHaveProperty('stack');
    expect(payload.samples[0].message).toHaveLength(300);
  });

  it('summarizes counts and regressions', () => {
    expect(errorIssueEnvelopeParts(detail)).toEqual({
      summary:
        'Issue 0123456789abcdef is open: 1,200 events in the last 24 hours across 2 releases (5,000 in 180 days). First seen 2026-10-13T10:00:00.000Z, last seen 2026-10-14T10:00:00.000Z. It came back 2 times after being resolved.',
      warnings: [ERROR_TEXT_WARNING],
    });
    expect(errorIssueEnvelopeParts({ ...detail, samples: [] }).warnings[1]).toMatch(
      /Try range 30d/,
    );
  });
});
