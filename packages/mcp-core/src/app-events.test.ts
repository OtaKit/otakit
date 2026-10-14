import { describe, expect, it } from 'vitest';

import {
  APP_EVENT_TEXT_WARNING,
  appEventBreakdownSummary,
  appEventListEnvelopeParts,
  appEventReleasesSummary,
  appEventTimeseriesSummary,
} from './app-events';

const usage = { events: 10, limit: 100_000, pausedUntil: null };

describe('custom event envelopes', () => {
  it('summarizes the event list', () => {
    const list = {
      events: [
        { name: 'checkout_completed', events: 1200 },
        { name: 'signup', events: 30 },
      ],
      sessions: 9000,
      range: { name: '7d' },
      usage,
      hasEvents: true,
      analyticsAvailable: true,
    };
    expect(appEventListEnvelopeParts(list)).toEqual({
      summary:
        '2 custom events with 1,230 events in the last 7 days. 9,000 app launches. Use query_app_event for a trend, a property split or a release comparison.',
      warnings: [APP_EVENT_TEXT_WARNING],
    });
    expect(appEventListEnvelopeParts({ ...list, sessions: null }).summary).toMatch(
      /app launches are unknown/,
    );
    expect(appEventListEnvelopeParts({ ...list, events: [], hasEvents: false }).summary).toMatch(
      /no custom events in the last 90 days/,
    );
    expect(
      appEventListEnvelopeParts({
        ...list,
        usage: { events: 100_000, limit: 100_000, pausedUntil: '2026-11-01T00:00:00.000Z' },
      }).warnings[1],
    ).toMatch(/^Analytics are paused until 2026-11-01/);
    expect(appEventListEnvelopeParts({ ...list, analyticsAvailable: false }).warnings[0]).toMatch(
      /does not mean there are no events/,
    );
  });

  it('summarizes each query view without device text', () => {
    expect(
      appEventTimeseriesSummary({
        name: 'checkout_completed',
        events: 120,
        sessions: 80,
        changePercent: -12.5,
        range: { name: '24h' },
      }),
    ).toBe(
      '"checkout_completed": 120 events in 80 app launches in the last 24 hours (-12.5% against the previous 24 hours).',
    );
    expect(
      appEventBreakdownSummary({
        name: 'checkout_completed',
        property: 'plan',
        values: [
          { value: 'pro', events: 60 },
          { value: 'free', events: 20 },
        ],
        other: { events: 20 },
        total: { events: 100 },
        range: { name: '7d' },
      }),
    ).toBe(
      '"checkout_completed" split by "plan" in the last 7 days: the top 2 values cover 80 of 100 events. An empty value means the property was not set.',
    );
    expect(
      appEventReleasesSummary({
        name: 'checkout_completed',
        basis: 'applies',
        releases: [
          { bundleVersion: '1.4.1', perThousand: 10, differencePercent: null },
          { bundleVersion: '1.4.2', perThousand: 15, differencePercent: 50 },
        ],
      }),
    ).toBe(
      '"checkout_completed" per 1,000 applies on plugin 3.4+, oldest release first, difference against the oldest release with a rate above 0: 1.4.1: 10; 1.4.2: 15 (+50%). No release has app launches recorded (initAnalytics()), so rates use applies, which is less precise.',
    );
  });
});
