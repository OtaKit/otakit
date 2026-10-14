import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAnalytics } from './analytics';
import type { AppTelemetryItem } from './definitions';
import { createErrorTracking } from './error-tracking';
import { createTelemetry } from './telemetry';

function setup(options: { native?: boolean; random?: number; sessionStarted?: boolean } = {}) {
  let ids = 0;
  let sessionStarted = options.sessionStarted ?? false;
  const native = {
    enqueueAppTelemetry: vi.fn(async ({ items }: { items: AppTelemetryItem[] }) => ({
      accepted: items.length,
      dropped: 0,
    })),
    getState: vi.fn(async () => ({ current: { id: 'builtin', version: '1.0' } })),
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
  const flag = { get: () => sessionStarted, set: () => void (sessionStarted = true) };
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
  it('sends $session_start once per app launch', async () => {
    const { analytics, telemetry, sent, sessionStarted } = setup();
    analytics.initAnalytics();
    analytics.initAnalytics();
    await telemetry.flush();
    expect(sent().map((item) => (item as { name: string }).name)).toEqual(['$session_start']);
    expect(sessionStarted()).toBe(true);

    // After a reload in the same launch (an OTA update), it is not sent again.
    const reloaded = setup({ sessionStarted: true });
    reloaded.analytics.initAnalytics();
    await reloaded.telemetry.flush();
    expect(reloaded.sent()).toEqual([]);

    const off = setup();
    off.analytics.initAnalytics({ sessionEvents: false });
    await off.telemetry.flush();
    expect(off.sent()).toEqual([]);
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
