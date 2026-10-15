import { appGate, type GateEnv } from './app-gate';
import { MAX_BODY_BYTES, parseBatch, queueChunks, type TelemetryMessage } from './app-telemetry';

type Platform = 'ios' | 'android';
type EventAction = 'downloaded' | 'applied' | 'download_error' | 'rollback' | 'check_error';

type EnqueuedEvent = {
  event_id: string;
  sent_at: string;
  received_at: string;
  app_id: string;
  platform: Platform;
  action: EventAction;
  bundle_version: string;
  channel: string | null;
  runtime_version: string | null;
  release_id: string | null;
  native_build: string;
  detail: string | null;
  attempt_id: string | null;
  native_sdk_version: string | null;
  phase: string | null;
  lifecycle: string | null;
};

type RetryOptions = {
  delaySeconds?: number;
};

type QueueMessage<T> = {
  id: string;
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: RetryOptions): void;
};

type MessageBatch<T> = {
  queue: string;
  messages: Array<QueueMessage<T>>;
  ackAll(): void;
  retryAll(options?: RetryOptions): void;
};

type QueueBinding<T> = {
  send(message: T): Promise<void>;
  sendBatch(messages: Array<{ body: T }>): Promise<void>;
};

type RateLimitResult = {
  success: boolean;
};

type RateLimitBinding = {
  limit(options: { key: string }): Promise<RateLimitResult>;
};

type WorkerEnv = GateEnv & {
  EVENTS_QUEUE: QueueBinding<EnqueuedEvent>;
  EVENTS_RATE_LIMITER?: RateLimitBinding;
  APP_TELEMETRY_QUEUE?: QueueBinding<TelemetryMessage>;
  APP_TELEMETRY_RATE_LIMITER?: RateLimitBinding;
  TINYBIRD_API_HOST: string;
  TINYBIRD_EVENTS_DATASOURCE: string;
  TINYBIRD_EVENTS_TOKEN: string;
  TINYBIRD_APP_ERRORS_DATASOURCE?: string;
  TINYBIRD_APP_EVENTS_DATASOURCE?: string;
};

const EVENTS_PATHS = new Set(['/v1/events']);
const APP_TELEMETRY_PATHS = new Set(['/v1/app-telemetry']);
const APP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEALTH_PATHS = new Set(['/healthz', '/v1/healthz']);
const VALID_ACTIONS = new Set<EventAction>([
  'downloaded',
  'applied',
  'download_error',
  'rollback',
  'check_error',
]);
const VALID_PLATFORMS = new Set<Platform>(['ios', 'android']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_TINYBIRD_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const APP_ID_HEADER = 'X-App-Id';
/** Must match the consumer queue in wrangler.jsonc. */
const APP_TELEMETRY_QUEUE_NAME = 'otakit-app-telemetry';

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimAndCap(value: unknown, maxLength: number): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function requireTrimmedAndCap(value: unknown, maxLength: number, name: string): string {
  const trimmed = trimAndCap(value, maxLength);
  if (!trimmed) {
    throw new Error(`Missing ${name}`);
  }
  return trimmed;
}

function normalizeSentAt(value: unknown): string {
  const trimmed = trimToNull(value);
  if (!trimmed) {
    throw new Error('Missing sentAt');
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid sentAt');
  }

  return parsed.toISOString();
}

function requireNonEmpty(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required binding or variable: ${name}`);
  }
  return trimmed;
}

function normalizeTinybirdHost(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:') {
    throw new Error('TINYBIRD_API_HOST must use https');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function retryDelayForBatch(batch: { messages: Array<{ attempts: number }> }): number {
  const highestAttempt = batch.messages.reduce((max, message) => {
    return Math.max(max, Math.max(message.attempts, 1));
  }, 1);

  return Math.min(300, 5 * 2 ** (highestAttempt - 1));
}

function normalizeEvent(input: Record<string, unknown>, appId: string): EnqueuedEvent {
  const eventId = trimToNull(input.eventId);
  if (!eventId) {
    throw new Error('Missing eventId');
  }
  if (!UUID_PATTERN.test(eventId)) {
    throw new Error('Invalid eventId');
  }

  const platform = trimToNull(input.platform);
  if (!platform || !VALID_PLATFORMS.has(platform as Platform)) {
    throw new Error('Invalid platform');
  }

  const action = trimToNull(input.action);
  if (!action || !VALID_ACTIONS.has(action as EventAction)) {
    throw new Error(`Invalid action. Must be one of: ${Array.from(VALID_ACTIONS).join(', ')}`);
  }

  return {
    event_id: eventId,
    sent_at: normalizeSentAt(input.sentAt),
    received_at: new Date().toISOString(),
    app_id: appId,
    platform: platform as Platform,
    action: action as EventAction,
    bundle_version:
      action === 'check_error'
        ? (trimAndCap(input.bundleVersion, 64) ?? '')
        : requireTrimmedAndCap(input.bundleVersion, 64, 'bundleVersion'),
    channel: trimAndCap(input.channel, 64),
    runtime_version: trimAndCap(input.runtimeVersion, 64),
    release_id:
      action === 'check_error'
        ? trimAndCap(input.releaseId, 64)
        : requireTrimmedAndCap(input.releaseId, 64, 'releaseId'),
    native_build: requireTrimmedAndCap(input.nativeBuild, 32, 'nativeBuild'),
    detail: trimAndCap(input.detail, 500),
    attempt_id: normalizeAttemptId(input.attemptId),
    native_sdk_version: trimAndCap(input.nativeSdkVersion, 32),
    phase: normalizeOptionalEnum(input.phase, [
      'admission',
      'transfer',
      'integrity',
      'decrypt',
      'extract',
      'install',
      'stage',
      'delta',
      'readiness',
      'rollback',
      'check',
      'signature',
    ]),
    lifecycle: normalizeOptionalEnum(input.lifecycle, [
      'foreground',
      'background',
      'inactive',
      'unknown',
    ]),
  };
}

function normalizeAttemptId(value: unknown): string | null {
  const id = trimToNull(value);
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function normalizeOptionalEnum(value: unknown, allowed: readonly string[]): string | null {
  const normalized = trimToNull(value);
  return normalized && allowed.includes(normalized) ? normalized : null;
}

async function maybeRateLimit(env: WorkerEnv, appId: string): Promise<boolean> {
  if (!env.EVENTS_RATE_LIMITER) {
    return true;
  }

  const { success } = await env.EVENTS_RATE_LIMITER.limit({
    key: `events:${appId}`,
  });
  return success;
}

async function handleEventsRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const appId = request.headers.get(APP_ID_HEADER)?.trim();
  if (!appId) {
    return jsonResponse({ error: `Missing ${APP_ID_HEADER} header` }, 401);
  }

  if (!(await maybeRateLimit(env, appId))) {
    return new Response(null, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  let event: EnqueuedEvent;
  try {
    event = normalizeEvent(payload as Record<string, unknown>, appId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid event payload';
    return jsonResponse({ error: message }, 400);
  }

  try {
    await env.EVENTS_QUEUE.send(event);
  } catch (error) {
    console.error('[Ingest] Failed to enqueue event', {
      appId,
      eventId: event.event_id,
      error,
    });
    return jsonResponse({ error: 'Queue unavailable' }, 503);
  }

  return jsonResponse({ accepted: true }, 202);
}

/**
 * App telemetry: errors and custom events (plugin 3.4+) in batches from the app's own outbox.
 * Invalid items are dropped one by one; an unknown app gets 404, which the
 * device treats as permanent; a paused kind (monthly cap) is accepted and
 * discarded, so devices stop retrying it without errors.
 */
async function handleAppTelemetryRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const appId = request.headers.get(APP_ID_HEADER)?.trim();
  if (!appId) {
    return jsonResponse({ error: `Missing ${APP_ID_HEADER} header` }, 401);
  }
  if (!APP_ID_PATTERN.test(appId)) {
    return jsonResponse({ error: 'Unknown app' }, 404);
  }
  if (!env.APP_TELEMETRY_QUEUE) {
    return jsonResponse({ error: 'App telemetry is not enabled' }, 404);
  }
  if (env.APP_TELEMETRY_RATE_LIMITER) {
    const { success } = await env.APP_TELEMETRY_RATE_LIMITER.limit({
      key: `app-telemetry:${appId}`,
    });
    if (!success) return new Response(null, { status: 429 });
  }

  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Batch too large' }, 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Batch too large' }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const gate = await appGate(env, appId);
  if (!gate.known) {
    return jsonResponse({ error: 'Unknown app' }, 404);
  }

  let parsed;
  try {
    parsed = await parseBatch(payload, appId);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Invalid batch' }, 400);
  }
  const accepted = parsed.messages.filter((message) => !gate.blocked.has(message.kind));
  const paused = parsed.messages.length - accepted.length;
  if (accepted.length > 0) {
    try {
      // A retry after a partial failure sends earlier chunks again; reads count
      // unique event IDs, so duplicates never inflate the numbers.
      for (const chunk of queueChunks(accepted)) {
        await env.APP_TELEMETRY_QUEUE.sendBatch(chunk.map((body) => ({ body })));
      }
    } catch (error) {
      console.error('[Ingest] Failed to enqueue app telemetry', { appId, error });
      return jsonResponse({ error: 'Queue unavailable' }, 503);
    }
  }
  return jsonResponse(
    {
      accepted: accepted.length > 0 || parsed.messages.length === 0,
      items: accepted.length,
      dropped: parsed.dropped,
      ...(paused > 0 ? { paused } : {}),
    },
    202,
  );
}

/** Write telemetry rows to their datasource per kind; each kind acks or retries on its own. */
async function handleAppTelemetryBatch(
  batch: MessageBatch<TelemetryMessage>,
  env: WorkerEnv,
): Promise<void> {
  const host = normalizeTinybirdHost(requireNonEmpty(env.TINYBIRD_API_HOST, 'TINYBIRD_API_HOST'));
  const token = requireNonEmpty(env.TINYBIRD_EVENTS_TOKEN, 'TINYBIRD_EVENTS_TOKEN');
  const datasources: Record<TelemetryMessage['kind'], string> = {
    error: env.TINYBIRD_APP_ERRORS_DATASOURCE?.trim() || 'app_errors_raw',
    event: env.TINYBIRD_APP_EVENTS_DATASOURCE?.trim() || 'app_events_raw',
  };
  const byKind = new Map<TelemetryMessage['kind'], Array<QueueMessage<TelemetryMessage>>>();
  for (const message of batch.messages) {
    const list = byKind.get(message.body.kind) ?? [];
    list.push(message);
    byKind.set(message.body.kind, list);
  }
  for (const [kind, messages] of byKind) {
    const body = `${messages.map((message) => JSON.stringify(message.body.row)).join('\n')}\n`;
    const delaySeconds = retryDelayForBatch({ messages });
    try {
      const response = await fetch(
        `${host}/v0/events?name=${encodeURIComponent(datasources[kind])}&wait=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-ndjson; charset=utf-8',
          },
          body,
        },
      );
      if (response.ok) {
        for (const message of messages) message.ack();
        continue;
      }
      console.error('[Ingest] Tinybird rejected app telemetry, retrying', {
        kind,
        status: response.status,
        responseText: await response.text().catch(() => ''),
      });
    } catch (error) {
      console.error('[Ingest] Tinybird request for app telemetry failed, retrying', {
        kind,
        error,
      });
    }
    for (const message of messages) message.retry({ delaySeconds });
  }
}

async function handleQueueBatch(batch: MessageBatch<EnqueuedEvent>, env: WorkerEnv): Promise<void> {
  const host = normalizeTinybirdHost(requireNonEmpty(env.TINYBIRD_API_HOST, 'TINYBIRD_API_HOST'));
  const datasource = requireNonEmpty(env.TINYBIRD_EVENTS_DATASOURCE, 'TINYBIRD_EVENTS_DATASOURCE');
  const token = requireNonEmpty(env.TINYBIRD_EVENTS_TOKEN, 'TINYBIRD_EVENTS_TOKEN');
  const body = `${batch.messages.map((message) => JSON.stringify(message.body)).join('\n')}\n`;

  let response: Response;
  try {
    response = await fetch(`${host}/v0/events?name=${encodeURIComponent(datasource)}&wait=true`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      },
      body,
    });
  } catch (error) {
    const delaySeconds = retryDelayForBatch(batch);
    console.error('[Ingest] Tinybird request failed, retrying batch', {
      queue: batch.queue,
      batchSize: batch.messages.length,
      delaySeconds,
      error,
    });
    batch.retryAll({ delaySeconds });
    return;
  }

  if (response.ok) {
    batch.ackAll();
    return;
  }

  const responseText = await response.text().catch(() => '');
  if (RETRYABLE_TINYBIRD_STATUSES.has(response.status)) {
    const delaySeconds = retryDelayForBatch(batch);
    console.error('[Ingest] Tinybird returned retryable status, retrying batch', {
      queue: batch.queue,
      batchSize: batch.messages.length,
      status: response.status,
      delaySeconds,
      responseText,
    });
    batch.retryAll({ delaySeconds });
    return;
  }

  const delaySeconds = retryDelayForBatch(batch);
  console.error('[Ingest] Tinybird returned non-retryable status, sending batch toward DLQ', {
    queue: batch.queue,
    batchSize: batch.messages.length,
    status: response.status,
    delaySeconds,
    responseText,
  });
  batch.retryAll({ delaySeconds });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (request.method === 'GET' && HEALTH_PATHS.has(url.pathname)) {
      return new Response('ok', { status: 200 });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    if (APP_TELEMETRY_PATHS.has(url.pathname)) {
      return handleAppTelemetryRequest(request, env);
    }

    if (!EVENTS_PATHS.has(url.pathname)) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return handleEventsRequest(request, env);
  },

  async queue(
    batch: MessageBatch<EnqueuedEvent> | MessageBatch<TelemetryMessage>,
    env: WorkerEnv,
  ): Promise<void> {
    if (batch.queue === APP_TELEMETRY_QUEUE_NAME) {
      await handleAppTelemetryBatch(batch as MessageBatch<TelemetryMessage>, env);
      return;
    }
    await handleQueueBatch(batch as MessageBatch<EnqueuedEvent>, env);
  },
};
