import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppTelemetryItem } from './definitions';
import { createErrorTracking, scrub, scrubStack } from './error-tracking';
import { createTelemetry } from './telemetry';

type Native = {
  enqueueAppTelemetry: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
};

function setup(options: { native?: boolean; random?: number } = {}) {
  const target = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const location = { pathname: '/checkout', hash: '#/cart?token=abc' };
  let ids = 0;
  const native: Native = {
    enqueueAppTelemetry: vi.fn(async ({ items }: { items: AppTelemetryItem[] }) => ({
      accepted: items.length,
      dropped: 0,
    })),
    getState: vi.fn(async () => ({
      current: { id: 'bundle-1', version: '1.4.2', releaseId: 'release-9', channel: 'production' },
    })),
  };
  const telemetry = createTelemetry(native as never, {
    isNative: () => options.native ?? true,
    target,
    document,
    location: () => location,
    random: () => options.random ?? 0,
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  });
  const tracking = { ...createErrorTracking(telemetry), flush: telemetry.flush };
  const sent = () =>
    native.enqueueAppTelemetry.mock.calls.flatMap(
      ([argument]) => (argument as { items: AppTelemetryItem[] }).items,
    );
  const throwError = (error: unknown, extra: Record<string, unknown> = {}) =>
    target.dispatchEvent(
      Object.assign(new Event('error'), {
        error,
        message: error instanceof Error ? error.message : String(error),
        ...extra,
      }),
    );
  const reject = (reason: unknown) =>
    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
  return { tracking, telemetry, native, sent, target, document, throwError, reject };
}

function typeError(message = "Cannot read properties of undefined (reading 'total')") {
  const error = new TypeError(message);
  error.stack = `TypeError: ${message}\n    at computeTotal (capacitor://localhost/assets/index-4f3a9c2b.js:12:3401)`;
  return error;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('initErrorTracking', () => {
  it('captures uncaught errors and sends them after 5 seconds', async () => {
    const { tracking, sent, throwError, native } = setup();
    tracking.initErrorTracking();
    throwError(typeError());
    expect(native.enqueueAppTelemetry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent()).toEqual([
      {
        kind: 'error',
        eventId: '00000000-0000-4000-8000-000000000001',
        occurredAt: '2026-10-14T12:00:00.000Z',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'total')",
        stack:
          "TypeError: Cannot read properties of undefined (reading 'total')\n    at computeTotal (capacitor://localhost/assets/index-4f3a9c2b.js:12:3401)",
        route: '/checkout#/cart',
        handled: false,
        mechanism: 'onerror',
        tags: {},
      },
    ]);
  });

  it('captures unhandled rejections, including values that are not errors', async () => {
    const { tracking, sent, reject } = setup();
    tracking.initErrorTracking();
    reject(new RangeError('Invalid array length'));
    reject('plain string');
    reject({ code: 42 });
    reject(undefined);
    await tracking.flush();
    expect(sent().map((item) => [item.mechanism, item.name, item.message])).toEqual([
      ['unhandledrejection', 'RangeError', 'Invalid array length'],
      ['unhandledrejection', 'UnhandledRejection', 'plain string'],
      ['unhandledrejection', 'UnhandledRejection', '{"code":42}'],
      ['unhandledrejection', 'UnhandledRejection', 'undefined'],
    ]);
  });

  it('builds a frame from the event when the error has no stack, and skips browser noise', async () => {
    const { tracking, sent, target, throwError } = setup();
    tracking.initErrorTracking();
    throwError(null, {
      message: 'Uncaught ReferenceError: x is not defined',
      filename: 'capacitor://localhost/main.js',
      lineno: 3,
      colno: 7,
    });
    throwError(null, { message: 'Script error.' });
    throwError(new Error('ResizeObserver loop completed with undelivered notifications.'));
    target.dispatchEvent(new Event('error')); // a failed <img> load
    await tracking.flush();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      name: 'Error',
      message: 'Uncaught ReferenceError: x is not defined',
      stack: '    at capacitor://localhost/main.js:3:7',
    });
  });

  it('does nothing on web and rejects an invalid sample rate', () => {
    const web = setup({ native: false });
    web.tracking.initErrorTracking();
    web.throwError(typeError());
    expect(web.tracking.captureError(new Error('x'))).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[OtaKit] Error tracking and analytics run in the iOS and Android apps; nothing is sent on web.',
    );
    expect(() => setup().tracking.initErrorTracking({ sampleRate: 2 })).toThrow(/sampleRate/);
  });

  it('listens once when called again, with the new options', async () => {
    const { tracking, sent, throwError } = setup();
    tracking.initErrorTracking();
    tracking.initErrorTracking({ ignoreErrors: ['ignored'] });
    throwError(new Error('ignored error'));
    throwError(new Error('kept'));
    await tracking.flush();
    expect(sent().map((item) => item.message)).toEqual(['kept']);
  });
});

describe('bundle context', () => {
  it('sends the bundle this JavaScript runs from, read once at init', async () => {
    const { tracking, native } = setup();
    tracking.initErrorTracking();
    await vi.advanceTimersByTimeAsync(0);
    // The native current bundle may change (an update or rollback) before the reload.
    tracking.captureError(new Error('a'));
    await tracking.flush();
    expect(native.getState).toHaveBeenCalledTimes(1);
    expect(native.enqueueAppTelemetry.mock.calls[0][0].bundle).toEqual({
      bundleVersion: '1.4.2',
      releaseId: 'release-9',
      channel: 'production',
    });
  });

  it('reports the built-in bundle, and leaves it to native when unknown', async () => {
    const builtin = setup();
    builtin.native.getState.mockResolvedValue({ current: { id: 'builtin', version: '2.0' } });
    builtin.tracking.initErrorTracking();
    await vi.advanceTimersByTimeAsync(0);
    builtin.tracking.captureError(new Error('a'));
    await builtin.tracking.flush();
    expect(builtin.native.enqueueAppTelemetry.mock.calls[0][0].bundle).toEqual({
      bundleVersion: 'builtin',
      releaseId: null,
      channel: null,
    });

    const unknown = setup();
    unknown.native.getState.mockRejectedValue(new Error('no state'));
    unknown.tracking.initErrorTracking();
    await vi.advanceTimersByTimeAsync(0);
    unknown.tracking.captureError(new Error('a'));
    await unknown.tracking.flush();
    expect(unknown.native.enqueueAppTelemetry.mock.calls[0][0]).not.toHaveProperty('bundle');
  });
});

describe('scrubbing', () => {
  it('keeps URL paths and finishes long input quickly', () => {
    const message =
      'Failed to fetch dynamically imported module: https://localhost/assets/pages/settings/NotificationSettings-4f3a9c2b.js';
    expect(scrub(message)).toBe(message);
    const started = performance.now();
    scrub('a'.repeat(30_000));
    scrub(`${'b'.repeat(30_000)}@`);
    scrub(`${'c'.repeat(15_000)}1${'d'.repeat(15_000)}`);
    scrubStack(`Error\n    at ${'e'.repeat(8_000)}`);
    expect(performance.now() - started).toBeLessThan(100);
    expect(scrub(`key ${'Ab1'.repeat(15)} end`)).toBe('key [redacted] end');
  });

  it('removes emails, tokens, secrets and query strings', () => {
    expect(
      scrub(
        'User jane.doe@example.com failed: GET https://api.example.com/v1/me?session=abc123&x=1 ' +
          'with Bearer abc.def-ghi password=hunter2 and key 0123456789abcdef0123456789abcdef ' +
          'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      ),
    ).toBe(
      'User [redacted] failed: GET https://api.example.com/v1/me?[redacted] ' +
        'with Bearer [redacted] password=[redacted] and key [redacted] jwt [redacted]',
    );
  });

  it('keeps stack frames readable while scrubbing their query strings', () => {
    const stack = [
      'Error: token=abc123 for user@example.com',
      '    at loadVeryLongComponentNameForTheCheckoutPageModule2 (capacitor://localhost/assets/feature/checkout/LoadVeryLongComponentNameForTheCheckoutPage2.js?v=12:1:2)',
      'fetchOrders@https://localhost/assets/api-client.js?sig=deadbeefdeadbeefdeadbeefdeadbeef00:4:9',
    ].join('\n');
    expect(scrubStack(stack).split('\n')).toEqual([
      'Error: token=[redacted] for [redacted]',
      '    at loadVeryLongComponentNameForTheCheckoutPageModule2 (capacitor://localhost/assets/feature/checkout/LoadVeryLongComponentNameForTheCheckoutPage2.js?[redacted]:1:2)',
      'fetchOrders@https://localhost/assets/api-client.js?[redacted]:4:9',
    ]);
  });

  it('applies to captured errors before beforeSend sees them', async () => {
    const { tracking, sent } = setup();
    const seen: string[] = [];
    tracking.initErrorTracking({
      beforeSend: (error) => {
        seen.push(error.message);
        return { ...error, message: `${error.message} (checked)` };
      },
    });
    tracking.captureError(new Error('Payment failed for bob@example.com'));
    await tracking.flush();
    expect(seen).toEqual(['Payment failed for [redacted]']);
    expect(sent()[0].message).toBe('Payment failed for [redacted] (checked)');
  });
});

describe('filters and limits', () => {
  it('drops ignored, unsampled and beforeSend-dropped errors', async () => {
    const sampled = setup({ random: 0.5 });
    sampled.tracking.initErrorTracking({ sampleRate: 0.4 });
    expect(sampled.tracking.captureError(new Error('x'))).toBeNull();

    const { tracking, sent } = setup();
    tracking.initErrorTracking({
      ignoreErrors: ['NetworkError', /^AbortError:/],
      beforeSend: (error) => (error.message.includes('drop') ? null : error),
    });
    expect(tracking.captureError(new Error('NetworkError when attempting to fetch'))).toBeNull();
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(tracking.captureError(abort)).toBeNull();
    expect(tracking.captureError(new Error('please drop me'))).toBeNull();
    expect(tracking.captureError(new Error('kept'))).toMatch(/^00000000-/);
    await tracking.flush();
    expect(sent().map((item) => item.message)).toEqual(['kept']);
  });

  it('drops an error when beforeSend throws, and warns once', () => {
    const { tracking } = setup();
    tracking.initErrorTracking({
      beforeSend: () => {
        throw new Error('bug in beforeSend');
      },
    });
    expect(tracking.captureError(new Error('a'))).toBeNull();
    expect(tracking.captureError(new Error('b'))).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('sends the same error 5 times and at most maxEventsPerSession errors', async () => {
    const { tracking, sent, throwError } = setup();
    tracking.initErrorTracking({ maxEventsPerSession: 8 });
    for (let index = 0; index < 7; index += 1) throwError(typeError());
    for (let index = 0; index < 7; index += 1) throwError(new Error(`other ${index}`));
    await tracking.flush();
    expect(sent()).toHaveLength(8);
    expect(sent().filter((item) => item.name === 'TypeError')).toHaveLength(5);
  });

  it('keeps valid tags only', async () => {
    const { tracking, sent } = setup();
    tracking.initErrorTracking();
    const tags: Record<string, string | number | boolean> = {
      screen: 'cart',
      retry: 2,
      'bad key': 'x',
      email: 'jane@example.com',
    };
    for (let index = 0; index < 12; index += 1) tags[`k${index}`] = index;
    tracking.captureError(new Error('x'), { tags });
    await tracking.flush();
    const sentTags = sent()[0].tags;
    expect(Object.keys(sentTags)).toHaveLength(10);
    expect(sentTags).toMatchObject({ screen: 'cart', retry: '2', email: '[redacted]' });
    expect(sentTags['bad key']).toBeUndefined();
  });
});

describe('delivery to the native plugin', () => {
  it('flushes at 20 errors, when hidden and on pagehide', async () => {
    const { tracking, native, document, target } = setup();
    tracking.initErrorTracking();
    for (let index = 0; index < 20; index += 1) tracking.captureError(new Error(`e${index}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.enqueueAppTelemetry).toHaveBeenCalledTimes(1);
    expect(native.enqueueAppTelemetry.mock.calls[0][0].items).toHaveLength(20);

    tracking.captureError(new Error('hidden'));
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.enqueueAppTelemetry).toHaveBeenCalledTimes(2);

    tracking.captureError(new Error('pagehide'));
    target.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.enqueueAppTelemetry).toHaveBeenCalledTimes(3);
  });

  it('keeps errors the native plugin could not take, for the next flush', async () => {
    const { tracking, native, sent } = setup();
    native.enqueueAppTelemetry.mockRejectedValueOnce(new Error('busy'));
    tracking.initErrorTracking();
    tracking.captureError(new Error('first'));
    await tracking.flush();
    tracking.captureError(new Error('second'));
    await tracking.flush();
    expect(sent().map((item) => item.message)).toEqual(['first', 'first', 'second']);
    expect(
      native.enqueueAppTelemetry.mock.calls[1][0].items.map((i: AppTelemetryItem) => i.message),
    ).toEqual(['first', 'second']);
  });

  it('sends only the known fields after beforeSend', async () => {
    const { tracking, sent } = setup();
    tracking.initErrorTracking({
      beforeSend: (error) =>
        ({ ...error, user: { email: 'x' }, mechanism: 'bogus', handled: 'yes' }) as never,
    });
    tracking.captureError(new Error('a'));
    await tracking.flush();
    expect(Object.keys(sent()[0]).sort()).toEqual([
      'eventId',
      'handled',
      'kind',
      'mechanism',
      'message',
      'name',
      'occurredAt',
      'route',
      'stack',
      'tags',
    ]);
    expect(sent()[0]).toMatchObject({ mechanism: 'manual', handled: false });
  });

  it('stops quietly on a native build without error tracking', async () => {
    const { tracking, native } = setup();
    native.enqueueAppTelemetry.mockRejectedValue(
      Object.assign(new Error('not implemented'), { code: 'UNIMPLEMENTED' }),
    );
    tracking.initErrorTracking();
    tracking.captureError(new Error('a'));
    await tracking.flush();
    expect(tracking.captureError(new Error('b'))).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[OtaKit] Error tracking and analytics need @otakit/capacitor-updater 3.4 or later in the native build; nothing is sent.',
    );
  });

  it('sends a test error past sampling and beforeSend', async () => {
    const { tracking, sent } = setup({ random: 0.99 });
    expect(await tracking.testErrorTracking()).toBe(false);
    tracking.initErrorTracking({ sampleRate: 0, beforeSend: () => null });
    expect(await tracking.testErrorTracking()).toBe(true);
    expect(sent()).toEqual([
      expect.objectContaining({
        name: 'OtaKitTestError',
        message: 'This is a test error from testErrorTracking()',
        handled: true,
        mechanism: 'manual',
        tags: { otakit_test: 'true' },
      }),
    ]);
  });
});
