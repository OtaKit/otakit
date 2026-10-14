import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAppGateCache } from '../src/app-gate';
import { parseBatch, queueChunks } from '../src/app-telemetry';
import worker from '../src/index';

const APP_ID = '0b6f8a52-3c1d-4e7f-9a2b-1c3d5e7f9a0b';
const context = {
  platform: 'ios',
  bundleVersion: '1.4.0',
  releaseId: 'rel_1',
  channel: 'production',
  runtimeVersion: '1.0',
  nativeBuild: '42',
  osVersion: '18.2',
  sdkVersion: '3.4.0',
  sessionId: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
};
let nextId = 0;
function errorItem(overrides: Record<string, unknown> = {}) {
  nextId += 1;
  return {
    kind: 'error',
    eventId: `cd7b94bb-074a-4a4c-830c-${String(nextId).padStart(12, '0')}`,
    occurredAt: new Date().toISOString(),
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'total')",
    stack: 'computeTotal@capacitor://localhost/assets/index-4f3a9c2b.js:12:3401',
    route: '/checkout',
    handled: false,
    mechanism: 'onerror',
    ...overrides,
  };
}

type Env = Parameters<typeof worker.fetch>[1];

function fixture(overrides: Partial<Env> = {}) {
  const sendBatch = vi.fn().mockResolvedValue(undefined);
  const limit = vi.fn().mockResolvedValue({ success: true });
  const env = {
    EVENTS_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
    APP_TELEMETRY_QUEUE: { send: vi.fn(), sendBatch },
    APP_TELEMETRY_RATE_LIMITER: { limit },
    TINYBIRD_API_HOST: 'https://api.tinybird.co',
    TINYBIRD_EVENTS_DATASOURCE: 'device_events_raw',
    TINYBIRD_EVENTS_TOKEN: 'test-token',
    ...overrides,
  } as Env;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(
      new Request('https://ingest.example/v1/app-telemetry', {
        method: 'POST',
        headers: { 'X-App-Id': APP_ID, 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
    );
  const queued = () => sendBatch.mock.calls.flatMap(([messages]) => messages);
  return { env, post, sendBatch, limit, queued };
}

/** Upstash pipeline answers: [EXISTS otakit:apps, SISMEMBER, EXISTS blocked:error]. */
function mockUpstash(results: number[] | Error) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (results instanceof Error) throw results;
    expect(String(input)).toBe('https://redis.example/pipeline');
    return Response.json(results.map((result) => ({ result })));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const redisEnv = {
  UPSTASH_REDIS_REST_URL: 'https://redis.example/',
  UPSTASH_REDIS_REST_TOKEN: 'redis-token',
};

beforeEach(() => {
  resetAppGateCache();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /v1/app-telemetry', () => {
  it('queues valid errors with the device context and a fingerprint', async () => {
    const { post, queued, limit } = fixture();
    const response = await post({ batchId: 'b1', context, items: [errorItem()] });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, items: 1, dropped: 0 });
    expect(limit).toHaveBeenCalledWith({ key: `app-telemetry:${APP_ID}` });
    const [message] = queued();
    expect(message.body.kind).toBe('error');
    expect(message.body.row).toMatchObject({
      app_id: APP_ID,
      platform: 'ios',
      release_id: 'rel_1',
      bundle_version: '1.4.0',
      channel: 'production',
      native_build: '42',
      os_version: '18.2',
      sdk_version: '3.4.0',
      session_id: context.sessionId,
      error_name: 'TypeError',
      normalized_message: 'Cannot read properties of undefined (reading <str>)',
      top_frame: 'computeTotal (assets/index.js)',
      route: '/checkout',
      handled: 0,
      mechanism: 'onerror',
      tags: '{}',
    });
    expect(message.body.row.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  it('drops invalid items one by one and keeps the rest', async () => {
    const { post, queued } = fixture();
    const response = await post({
      context,
      items: [
        errorItem(),
        errorItem({ eventId: 'not-a-uuid' }),
        errorItem({ message: '', stack: '' }),
        { kind: 'event', name: 'from a newer plugin' },
        'not an object',
        errorItem({ mechanism: 'something', handled: 'yes' }),
      ],
    });
    expect(await response.json()).toEqual({ accepted: true, items: 2, dropped: 4 });
    expect(queued().map((message) => message.body.row.mechanism)).toEqual(['onerror', 'manual']);
    expect(queued()[1].body.row.handled).toBe(0);
  });

  it('rejects malformed batches', async () => {
    const { post, sendBatch } = fixture();
    expect((await post('{')).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({ context })).status).toBe(400);
    expect((await post({ items: [errorItem()] })).status).toBe(400);
    expect((await post({ context: { ...context, platform: 'web' }, items: [] })).status).toBe(400);
    expect((await post({ context: { ...context, sessionId: 'x' }, items: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => errorItem());
    const response = await post({ context, items: tooMany });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'At most 50 items per batch' });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('answers 413 for a body over 128 KB, by header or by content', async () => {
    const { post, sendBatch } = fixture();
    const big = JSON.stringify({ context, items: [errorItem({ stack: 'x'.repeat(140_000) })] });
    expect((await post(big)).status).toBe(413);
    expect((await post('{}', { 'Content-Length': String(200_000) })).status).toBe(413);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('identifies the app before anything else', async () => {
    const { post, env } = fixture();
    const missing = await worker.fetch(
      new Request('https://ingest.example/v1/app-telemetry', { method: 'POST', body: '{}' }),
      env,
    );
    expect(missing.status).toBe(401);
    expect((await post({ context, items: [] }, { 'X-App-Id': 'app-a' })).status).toBe(404);
  });

  it('answers 404 when the Worker has no telemetry queue (self-hosted without it)', async () => {
    const { post } = fixture({ APP_TELEMETRY_QUEUE: undefined });
    expect((await post({ context, items: [errorItem()] })).status).toBe(404);
  });

  it('answers 429 over the per-app rate limit without reading the body', async () => {
    const { post, limit, sendBatch } = fixture();
    limit.mockResolvedValue({ success: false });
    expect((await post('{')).status).toBe(429);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('answers 503 when the queue fails, so the device retries', async () => {
    const { post, sendBatch } = fixture();
    sendBatch.mockRejectedValue(new Error('queue down'));
    expect((await post({ context, items: [errorItem()] })).status).toBe(503);
  });

  it('splits large batches under the Queues size limit', async () => {
    const { post, sendBatch, queued } = fixture();
    const items = Array.from({ length: 30 }, () => errorItem({ stack: 'y'.repeat(3_000) }));
    expect((await post({ context, items })).status).toBe(202);
    expect(queued()).toHaveLength(30);
    for (const [messages] of sendBatch.mock.calls) {
      expect(JSON.stringify(messages).length).toBeLessThan(200 * 1024);
    }
  });
});

describe('app gate', () => {
  it('rejects apps missing from the allowlist', async () => {
    mockUpstash([1, 0, 0]);
    const { post, sendBatch } = fixture(redisEnv);
    const response = await post({ context, items: [errorItem()] });
    expect(response.status).toBe(404);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('accepts every app before the allowlist exists', async () => {
    mockUpstash([0, 0, 0]);
    const { post, queued } = fixture(redisEnv);
    expect((await post({ context, items: [errorItem()] })).status).toBe(202);
    expect(queued()).toHaveLength(1);
  });

  it('accepts and discards a paused kind, so devices stop retrying it', async () => {
    mockUpstash([1, 1, 1]);
    const { post, sendBatch } = fixture(redisEnv);
    const response = await post({ context, items: [errorItem(), errorItem()] });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: false, items: 0, dropped: 0, paused: 2 });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('fails open when Redis is unreachable', async () => {
    mockUpstash(new Error('network'));
    const { post, queued } = fixture(redisEnv);
    expect((await post({ context, items: [errorItem()] })).status).toBe(202);
    expect(queued()).toHaveLength(1);
  });

  it('caches the answer per app for a minute', async () => {
    const fetchMock = mockUpstash([1, 1, 0]);
    const { post } = fixture(redisEnv);
    await post({ context, items: [errorItem()] });
    await post({ context, items: [errorItem()] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual([
      ['EXISTS', 'otakit:apps'],
      ['SISMEMBER', 'otakit:apps', APP_ID],
      ['EXISTS', `otakit:telemetry:blocked:error:${APP_ID}`],
    ]);
  });
});

describe('parseBatch', () => {
  const received = new Date('2026-10-14T12:00:00.000Z');

  it('keeps device times within a week, and uses the receipt time otherwise', async () => {
    const batch = (occurredAt: unknown) =>
      parseBatch({ context, items: [errorItem({ occurredAt })] }, APP_ID, received);
    const rowTime = async (occurredAt: unknown) =>
      (await batch(occurredAt)).messages[0].row.occurred_at;
    expect(await rowTime('2026-10-14T11:59:00Z')).toBe('2026-10-14T11:59:00.000Z');
    expect(await rowTime('2026-10-01T00:00:00Z')).toBe(received.toISOString());
    expect(await rowTime('2026-10-14T13:00:00Z')).toBe(received.toISOString());
    expect(await rowTime('yesterday')).toBe(received.toISOString());
    expect(await rowTime(undefined)).toBe(received.toISOString());
  });

  it('keeps at most ten valid tags as strings', async () => {
    const tags: Record<string, unknown> = { 'bad key': 'x', nested: { a: 1 }, flag: true, n: 3 };
    for (let index = 0; index < 12; index += 1) tags[`k${index}`] = 'v'.repeat(150);
    const { messages } = await parseBatch(
      { context, items: [errorItem({ tags })] },
      APP_ID,
      received,
    );
    const parsed = JSON.parse(messages[0].row.tags) as Record<string, string>;
    expect(Object.keys(parsed)).toHaveLength(10);
    expect(parsed.flag).toBe('true');
    expect(parsed.n).toBe('3');
    expect(parsed['bad key']).toBeUndefined();
    expect(parsed.nested).toBeUndefined();
    expect(parsed.k0).toHaveLength(100);
  });

  it('caps long fields and defaults missing context', async () => {
    const { messages } = await parseBatch(
      {
        context: { platform: 'android', sessionId: context.sessionId.toUpperCase() },
        items: [errorItem({ message: 'm'.repeat(5_000), stack: 's'.repeat(20_000), name: '' })],
      },
      APP_ID,
      received,
    );
    const row = messages[0].row;
    expect(row.message).toHaveLength(1_000);
    expect(row.stack).toHaveLength(8 * 1024);
    expect(row.error_name).toBe('Error');
    expect(row.bundle_version).toBe('builtin');
    expect(row.native_build).toBe('unknown');
    expect(row.release_id).toBeNull();
    expect(row.session_id).toBe(context.sessionId);
  });
});

describe('queueChunks', () => {
  it('starts a new chunk at 100 messages or about 192 KB', () => {
    expect(queueChunks(Array.from({ length: 250 }, () => 'x')).map((c) => c.length)).toEqual([
      100, 100, 50,
    ]);
    const large = Array.from({ length: 5 }, () => 'z'.repeat(80 * 1024));
    expect(queueChunks(large).map((c) => c.length)).toEqual([2, 2, 1]);
    expect(queueChunks([])).toEqual([]);
  });
});

describe('app telemetry consumer', () => {
  function message(row: Record<string, unknown>, attempts = 1) {
    return { id: 'm', body: { kind: 'error', row }, attempts, ack: vi.fn(), retry: vi.fn() };
  }

  it('writes rows as NDJSON to app_errors_raw and acks them', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const { env } = fixture();
    const messages = [message({ event_id: 'a' }), message({ event_id: 'b' })];
    await worker.queue(
      { queue: 'otakit-app-telemetry', messages, ackAll: vi.fn(), retryAll: vi.fn() } as never,
      env,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tinybird.co/v0/events?name=app_errors_raw&wait=true');
    expect(init.body).toBe('{"event_id":"a"}\n{"event_id":"b"}\n');
    for (const item of messages) expect(item.ack).toHaveBeenCalled();
  });

  it('retries with backoff when Tinybird fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    const { env } = fixture();
    const messages = [message({ event_id: 'a' }, 3)];
    await worker.queue(
      { queue: 'otakit-app-telemetry', messages, ackAll: vi.fn(), retryAll: vi.fn() } as never,
      env,
    );
    expect(messages[0].retry).toHaveBeenCalledWith({ delaySeconds: 20 });
    expect(messages[0].ack).not.toHaveBeenCalled();
  });
});
