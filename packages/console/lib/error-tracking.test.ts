import { describe, expect, it } from 'vitest';

import {
  errorIssueTitle,
  errorRangeWindow,
  isErrorSpike,
  isFingerprint,
  isRegression,
  perThousandApplies,
  shouldAlertNewIssue,
  utcMonth,
} from './error-tracking';

const at = (iso: string) => new Date(iso);

describe('errorRangeWindow', () => {
  it('rounds the start to the minute and ends at the end of the current bucket', () => {
    const now = at('2026-10-14T12:34:56.789Z');
    expect(errorRangeWindow('24h', now)).toEqual({
      from: at('2026-10-13T12:34:00.000Z'),
      to: at('2026-10-14T13:00:00.000Z'),
      hourly: true,
    });
    expect(errorRangeWindow('7d', now)).toEqual({
      from: at('2026-10-07T12:34:00.000Z'),
      to: at('2026-10-15T00:00:00.000Z'),
      hourly: false,
    });
    expect(errorRangeWindow('30d', now).from).toEqual(at('2026-09-14T12:34:00.000Z'));
  });
});

describe('errorIssueTitle', () => {
  it('joins the name and normalized message', () => {
    expect(errorIssueTitle('TypeError', 'x is undefined (reading <str>)')).toBe(
      'TypeError: x is undefined (reading <str>)',
    );
    expect(errorIssueTitle('Error', '  ')).toBe('Error');
  });
});

describe('isFingerprint', () => {
  it('accepts 16 lowercase hex characters only', () => {
    expect(isFingerprint('0123456789abcdef')).toBe(true);
    expect(isFingerprint('0123456789ABCDEF')).toBe(false);
    expect(isFingerprint('0123456789abcde')).toBe(false);
    expect(isFingerprint('../../etc/passwd')).toBe(false);
  });
});

describe('shouldAlertNewIssue', () => {
  const now = at('2026-10-14T12:00:00.000Z');
  const issue = {
    firstSeenAt: at('2026-10-14T10:00:00.000Z'),
    eventCount: 5,
    newIssueAlertedAt: null,
    status: 'open',
  };

  it('alerts once an issue first seen in the last day reaches 5 events', () => {
    expect(shouldAlertNewIssue(issue, now)).toBe(true);
    expect(shouldAlertNewIssue({ ...issue, eventCount: 4 }, now)).toBe(false);
    expect(shouldAlertNewIssue({ ...issue, newIssueAlertedAt: now }, now)).toBe(false);
    expect(shouldAlertNewIssue({ ...issue, status: 'ignored' }, now)).toBe(false);
    expect(
      shouldAlertNewIssue({ ...issue, firstSeenAt: at('2026-10-13T11:59:59.999Z') }, now),
    ).toBe(false);
  });
});

describe('isRegression', () => {
  const resolvedAt = at('2026-10-14T10:00:00.000Z');
  const issue = { status: 'resolved', resolvedAt };

  it('reopens on errors received and happened after the resolve', () => {
    const after = at('2026-10-14T10:05:00.000Z');
    expect(isRegression(issue, { lastSeenAt: after, lastOccurredAt: after })).toBe(true);
  });

  it('ignores a late retry of an error from before the fix', () => {
    expect(
      isRegression(issue, {
        lastSeenAt: at('2026-10-14T10:05:00.000Z'),
        lastOccurredAt: at('2026-10-14T09:59:00.000Z'),
      }),
    ).toBe(false);
  });

  it('only applies to resolved issues', () => {
    const after = at('2026-10-14T11:00:00.000Z');
    for (const status of ['open', 'ignored']) {
      expect(
        isRegression({ status, resolvedAt }, { lastSeenAt: after, lastOccurredAt: after }),
      ).toBe(false);
    }
    expect(
      isRegression(
        { status: 'resolved', resolvedAt: null },
        { lastSeenAt: after, lastOccurredAt: after },
      ),
    ).toBe(false);
  });
});

describe('error spikes', () => {
  it('needs 3× the previous rate, 50 applies on both, 20 errors and a baseline', () => {
    const previous = { events: 10, applies: 1000 }; // 10 per 1,000
    expect(isErrorSpike({ events: 30, applies: 1000 }, previous)).toBe(true);
    expect(isErrorSpike({ events: 29, applies: 1000 }, previous)).toBe(false);
    expect(isErrorSpike({ events: 19, applies: 50 }, previous)).toBe(false);
    expect(isErrorSpike({ events: 40, applies: 49 }, previous)).toBe(false);
    expect(isErrorSpike({ events: 40, applies: 100 }, { events: 0, applies: 49 })).toBe(false);
    // No errors on the previous release is no baseline: it may not have tracked them yet.
    expect(isErrorSpike({ events: 20, applies: 100 }, { events: 0, applies: 5000 })).toBe(false);
    expect(isErrorSpike({ events: 20, applies: 100 }, { events: 1, applies: 5000 })).toBe(true);
  });

  it('rounds the rate to one decimal', () => {
    expect(perThousandApplies({ events: 18, applies: 10_000 })).toBe(1.8);
    expect(perThousandApplies({ events: 1, applies: 3 })).toBe(333.3);
    expect(perThousandApplies({ events: 5, applies: 0 })).toBe(0);
  });
});

describe('utcMonth', () => {
  it('returns the UTC calendar month', () => {
    expect(utcMonth(at('2026-12-31T23:59:59.999Z'))).toEqual({
      start: at('2026-12-01T00:00:00.000Z'),
      endExclusive: at('2027-01-01T00:00:00.000Z'),
    });
  });
});
