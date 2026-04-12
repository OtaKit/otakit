type Platform = 'ios' | 'android';
type EventAction = 'downloaded' | 'applied' | 'download_error' | 'rollback';

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
  release_id: string;
  native_build: string;
  detail: string | null;
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
};

type RateLimitResult = {
  success: boolean;
};

type RateLimitBinding = {
  limit(options: { key: string }): Promise<RateLimitResult>;
};

type WorkerEnv = {
  EVENTS_QUEUE: QueueBinding<EnqueuedEvent>;
  EVENTS_RATE_LIMITER?: RateLimitBinding;
  TINYBIRD_API_HOST: string;
  TINYBIRD_EVENTS_DATASOURCE: string;
  TINYBIRD_EVENTS_TOKEN: string;
};

const EVENTS_PATHS = new Set(['/v1/events']);
const HEALTH_PATHS = new Set(['/healthz', '/v1/healthz']);
const VALID_ACTIONS = new Set<EventAction>(['downloaded', 'applied', 'download_error', 'rollback']);
const VALID_PLATFORMS = new Set<Platform>(['ios', 'android']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_TINYBIRD_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const APP_ID_HEADER = 'X-App-Id';

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

function retryDelayForBatch(batch: MessageBatch<EnqueuedEvent>): number {
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
    bundle_version: requireTrimmedAndCap(input.bundleVersion, 64, 'bundleVersion'),
    channel: trimAndCap(input.channel, 64),
    runtime_version: trimAndCap(input.runtimeVersion, 64),
    release_id: requireTrimmedAndCap(input.releaseId, 64, 'releaseId'),
    native_build: requireTrimmedAndCap(input.nativeBuild, 32, 'nativeBuild'),
    detail: trimAndCap(input.detail, 500),
  };
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

async function handleQueueBatch(
  batch: MessageBatch<EnqueuedEvent>,
  env: WorkerEnv,
): Promise<void> {
  const host = normalizeTinybirdHost(requireNonEmpty(env.TINYBIRD_API_HOST, 'TINYBIRD_API_HOST'));
  const datasource = requireNonEmpty(
    env.TINYBIRD_EVENTS_DATASOURCE,
    'TINYBIRD_EVENTS_DATASOURCE',
  );
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

    if (!EVENTS_PATHS.has(url.pathname)) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return handleEventsRequest(request, env);
  },

  async queue(batch: MessageBatch<EnqueuedEvent>, env: WorkerEnv): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
