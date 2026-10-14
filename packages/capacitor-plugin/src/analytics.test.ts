import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAnalytics } from './analytics';
import type { AppTelemetryItem } from './definitions';
import { createErrorTracking } from './error-tracking';
import { createTelemetry } from './telemetry';

function setup(
  options: {
    native?: boolean;
    random?: number;
    sessionStarted?: string | null;
    current?: { id: string; version: string; releaseId?: string };
  } = {},
) {
  let ids = 0;
  let sessionStarted = options.sessionStarted ?? null;
  const native = {
    enqueueAppTelemetry: vi.fn(async ({ items }: { items: AppTelemetryItem[] }) => ({
      accepted: items.length,
      dropped: 0,
    })),
    getState: vi.fn(async () => ({
      current: options.current ?? { id: 'builtin', version: '1.0' },
    })),
  };
  const telemetry = createTelemetry(native as never, {
    isNative: () => options.native ?? true,
    target: new EventTarget(),
    document: null,
    location: () => ({ pathname: '/', hash: '' }),
    random: () => options.random ?? 0,
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  });
  const flag = {
    get: () => sessionStarted,
    set: (value: string) => void (sessionStarted = value),
  };
  const analytics = createAnalytics(telemetry, flag);
  const sent = () =>
    native.enqueueAppTelemetry.mock.calls.flatMap(
      ([argument]) => (argument as { items: AppTelemetryItem[] }).items,
    );
  return { analytics, telemetry, native, sent, sessionStarted: () => sessionStarted };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('track', () => {
  it('sends events with valid properties, without any init', async () => {
    const { analytics, telemetry, sent } = setup();
    expect(
      analytics.track('checkout_completed', {
        plan: 'pro',
        value: 49,
        trial: false,
        long: 'x'.repeat(300),
        nested: { a: 1 } as never,
        nan: Number.NaN,
        'bad key': 'y',
      }),
    ).toBe(true);
    await telemetry.flush();
    expect(sent()).toEqual([
      {
        kind: 'event',
        eventId: '00000000-0000-4000-8000-000000000001',
        occurredAt: '2026-10-14T12:00:00.000Z',
        name: 'checkout_completed',
        properties: { plan: 'pro', value: 49, trial: false, long: 'x'.repeat(200) },
      },
    ]);
  });

  it('drops invalid names with one warning, and reserved ones', () => {
    const { analytics } = setup();
    expect(analytics.track('has space')).toBe(false);
    expect(analytics.track('$session_start')).toBe(false);
    expect(analytics.track('x'.repeat(65))).toBe(false);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps at most 20 properties', async () => {
    const { analytics, telemetry, sent } = setup();
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index]));
    analytics.track('many', many);
    await telemetry.flush();
    expect(Object.keys((sent()[0] as { properties: object }).properties)).toHaveLength(20);
  });

  it('does nothing on web', () => {
    const { analytics, native } = setup({ native: false });
    expect(analytics.track('x')).toBe(false);
    analytics.initAnalytics();
    expect(native.enqueueAppTelemetry).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('initAnalytics', () => {
  it('sends $session_start once per app launch and bundle', async () => {
    const { analytics, telemetry, sent, sessionStarted } = setup();
    analytics.initAnalytics();
    analytics.initAnalytics();
    await vi.advanceTimersByTimeAsync(0);
    await telemetry.flush();
    expect(sent().map((item) => (item as { name: string }).name)).toEqual(['$session_start']);
    expect(sessionStarted()).toBe('|builtin');

    // A reload of the same bundle in the same launch does not send it again...
    const reloaded = setup({ sessionStarted: '|builtin' });
    reloaded.analytics.initAnalytics();
    await vi.advanceTimersByTimeAsync(0);
    await reloaded.telemetry.flush();
    expect(reloaded.sent()).toEqual([]);

    // ...but a reload into an update does: the launch also counts for the new release.
    const updated = setup({
      sessionStarted: '|builtin',
      current: { id: 'b1', version: '1.4.2', releaseId: 'release-2' },
    });
    updated.analytics.initAnalytics();
    await vi.advanceTimersByTimeAsync(0);
    await updated.telemetry.flush();
    expect(updated.sent().map((item) => (item as { name: string }).name)).toEqual([
      '$session_start',
    ]);
    expect(updated.sessionStarted()).toBe('release-2|1.4.2');

    const off = setup();
    off.analytics.initAnalytics({ sessionEvents: false });
    await vi.advanceTimersByTimeAsync(0);
    await off.telemetry.flush();
    expect(off.sent()).toEqual([]);
  });

  it('applies sampleRate even after an earlier track()', () => {
    const { analytics } = setup({ random: 0.5 });
    expect(analytics.track('early')).toBe(true);
    analytics.initAnalytics({ sampleRate: 0.4, sessionEvents: false });
    expect(analytics.track('late')).toBe(false);
  });

  it('samples whole app launches and applies beforeSend to tracked events only', async () => {
    const out = setup({ random: 0.5 });
    out.analytics.initAnalytics({ sampleRate: 0.4 });
    expect(out.analytics.track('a')).toBe(false);

    const { analytics, telemetry, sent } = setup({ random: 0.3 });
    analytics.initAnalytics({
      sampleRate: 0.4,
      beforeSend: (event) =>
        event.name === 'drop'
          ? null
          : ({
              ...event,
              name: 'bad name',
              properties: { ...event.properties, extra: 1 },
            } as never),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(analytics.track('drop')).toBe(false);
    expect(analytics.track('kept', { a: 'b' })).toBe(true);
    await telemetry.flush();
    expect(
      sent().map((item) => [
        (item as { name: string }).name,
        (item as { properties: object }).properties,
      ]),
    ).toEqual([
      ['$session_start', {}],
      ['kept', { a: 'b', extra: 1 }],
    ]);
    expect(() => analytics.initAnalytics({ sampleRate: -1 })).toThrow(/sampleRate/);
  });

  it('caps events per app launch', () => {
    const { analytics } = setup();
    analytics.initAnalytics({ maxEventsPerSession: 3, sessionEvents: false });
    expect([1, 2, 3, 4].map(() => analytics.track('tap'))).toEqual([true, true, true, false]);
  });
});

describe('shared buffer', () => {
  it('sends errors and events in the same batches', async () => {
    const { analytics, telemetry, native } = setup();
    const errors = createErrorTracking(telemetry);
    errors.initErrorTracking();
    errors.captureError(new Error('boom'));
    analytics.track('after_error');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(native.enqueueAppTelemetry).toHaveBeenCalledTimes(1);
    expect(
      native.enqueueAppTelemetry.mock.calls[0][0].items.map((item: AppTelemetryItem) => item.kind),
    ).toEqual(['error', 'event']);
    expect(native.getState).toHaveBeenCalledTimes(1);
  });
});
