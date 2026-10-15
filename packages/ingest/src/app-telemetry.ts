import { groupError } from './fingerprint';

/**
 * App telemetry (plugin 3.4+): errors the app captures with
 * initErrorTracking() and events it sends with track(), in batches from their
 * own native outbox, so a flood of them can never delay or evict OTA update
 * events.
 *
 * POST /v1/app-telemetry, header X-App-Id:
 * { batchId, sentAt, context: { platform, bundleVersion, … , sessionId }, items: [...] }
 */

export type TelemetryKind = 'error' | 'event';

export type ErrorRow = {
  event_id: string;
  received_at: string;
  occurred_at: string;
  app_id: string;
  platform: 'ios' | 'android';
  release_id: string | null;
  bundle_version: string;
  channel: string | null;
  runtime_version: string | null;
  native_build: string;
  os_version: string | null;
  sdk_version: string | null;
  session_id: string;
  fingerprint: string;
  error_name: string;
  message: string;
  normalized_message: string;
  top_frame: string | null;
  stack: string | null;
  route: string | null;
  handled: 0 | 1;
  mechanism: 'onerror' | 'unhandledrejection' | 'manual';
  tags: string;
};

export type EventRow = {
  event_id: string;
  received_at: string;
  occurred_at: string;
  app_id: string;
  platform: 'ios' | 'android';
  release_id: string | null;
  bundle_version: string;
  channel: string | null;
  runtime_version: string | null;
  native_build: string;
  os_version: string | null;
  sdk_version: string | null;
  session_id: string;
  name: string;
  /** JSON object of string values (numbers and booleans as text). */
  properties: string;
};

export type TelemetryMessage = { kind: 'error'; row: ErrorRow } | { kind: 'event'; row: EventRow };

export const MAX_ITEMS = 50;
export const MAX_BODY_BYTES = 128 * 1024;
const MAX_STACK = 8 * 1024;
const MAX_MESSAGE = 1000;
const MAX_TAGS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MECHANISMS = new Set(['onerror', 'unhandledrejection', 'manual']);
const TAG_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;
/** Device clocks drift; an occurredAt outside this window is replaced by the receipt time. */
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 10 * 60 * 1000;

type Context = Omit<
  ErrorRow,
  | 'event_id'
  | 'received_at'
  | 'occurred_at'
  | 'app_id'
  | 'fingerprint'
  | 'error_name'
  | 'message'
  | 'normalized_message'
  | 'top_frame'
  | 'stack'
  | 'route'
  | 'handled'
  | 'mechanism'
  | 'tags'
>;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The device context of a batch; throws when it cannot identify the device's release. */
export function parseContext(raw: unknown): Context {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Missing context');
  const context = raw as Record<string, unknown>;
  const platform = context.platform;
  if (platform !== 'ios' && platform !== 'android') throw new Error('Invalid platform');
  const sessionId = text(context.sessionId, 64);
  if (!sessionId || !UUID.test(sessionId)) throw new Error('Invalid sessionId');
  return {
    platform,
    release_id: text(context.releaseId, 64),
    bundle_version: text(context.bundleVersion, 64) ?? 'builtin',
    channel: text(context.channel, 64),
    runtime_version: text(context.runtimeVersion, 64),
    native_build: text(context.nativeBuild, 32) ?? 'unknown',
    os_version: text(context.osVersion, 32),
    sdk_version: text(context.sdkVersion, 32),
    session_id: sessionId.toLowerCase(),
  };
}

function occurredAt(value: unknown, receivedAt: Date): string {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  const time = parsed?.getTime();
  if (
    time === undefined ||
    Number.isNaN(time) ||
    time < receivedAt.getTime() - MAX_PAST_MS ||
    time > receivedAt.getTime() + MAX_FUTURE_MS
  ) {
    return receivedAt.toISOString();
  }
  return new Date(time).toISOString();
}

function tags(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_TAGS) break;
    if (!TAG_KEY.test(key)) continue;
    const valueText =
      typeof raw === 'string'
        ? raw
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? String(raw)
          : null;
    if (valueText !== null) result[key] = valueText.slice(0, 100);
  }
  return JSON.stringify(result);
}

/** One error item, or null when it is not a valid error (it is dropped, the rest are kept). */
export async function parseErrorItem(
  raw: Record<string, unknown>,
  context: Context,
  appId: string,
  receivedAt: Date,
): Promise<ErrorRow | null> {
  const eventId = text(raw.eventId, 64);
  if (!eventId || !UUID.test(eventId)) return null;
  const name = text(raw.name, 200) ?? 'Error';
  const message = text(raw.message, MAX_MESSAGE) ?? '';
  const stack =
    typeof raw.stack === 'string' && raw.stack.trim() ? raw.stack.slice(0, MAX_STACK) : null;
  if (!message && !stack) return null;
  const mechanism = MECHANISMS.has(raw.mechanism as string)
    ? (raw.mechanism as ErrorRow['mechanism'])
    : 'manual';
  const grouping = await groupError({ name, message, stack });
  return {
    event_id: eventId.toLowerCase(),
    received_at: receivedAt.toISOString(),
    occurred_at: occurredAt(raw.occurredAt, receivedAt),
    app_id: appId,
    ...context,
    fingerprint: grouping.fingerprint,
    error_name: name,
    message,
    normalized_message: grouping.normalizedMessage,
    top_frame: grouping.topFrame,
    stack,
    route: text(raw.route, 200),
    handled: raw.handled === true ? 1 : 0,
    mechanism,
    tags: tags(raw.tags),
  };
}

const EVENT_NAME = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.:-]{1,64}$/;
/** Names OtaKit sends itself; apps cannot use the `$` prefix. */
export const RESERVED_EVENT_NAMES = new Set(['$session_start']);
const PROPERTY_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;
const MAX_PROPERTIES = 20;
const MAX_PROPERTY_VALUE = 200;

/** Valid properties as text; invalid keys and values (objects, NaN) are left out. */
function properties(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '{}';
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_PROPERTIES) break;
    if (!PROPERTY_KEY.test(key)) continue;
    if (typeof raw === 'string') result[key] = raw.slice(0, MAX_PROPERTY_VALUE);
    else if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = String(raw);
    else if (typeof raw === 'boolean') result[key] = String(raw);
  }
  return JSON.stringify(result);
}

/** One custom event, or null when it is not valid (it is dropped, the rest are kept). */
export function parseEventItem(
  raw: Record<string, unknown>,
  context: Context,
  appId: string,
  receivedAt: Date,
): EventRow | null {
  const eventId = text(raw.eventId, 64);
  if (!eventId || !UUID.test(eventId)) return null;
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (!EVENT_NAME.test(name) && !RESERVED_EVENT_NAMES.has(name)) return null;
  return {
    event_id: eventId.toLowerCase(),
    received_at: receivedAt.toISOString(),
    occurred_at: occurredAt(raw.occurredAt, receivedAt),
    app_id: appId,
    ...context,
    name,
    properties: properties(raw.properties),
  };
}

export type ParsedBatch = { messages: TelemetryMessage[]; dropped: number };

/** Validate a batch body. Throws for a malformed batch; drops invalid items one by one. */
export async function parseBatch(
  body: unknown,
  appId: string,
  receivedAt = new Date(),
): Promise<ParsedBatch> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid JSON body');
  const batch = body as Record<string, unknown>;
  if (!Array.isArray(batch.items)) throw new Error('items must be a list');
  if (batch.items.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} items per batch`);
  const context = parseContext(batch.context);
  const messages: TelemetryMessage[] = [];
  let dropped = 0;
  for (const item of batch.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (raw.kind === 'error') {
      const row = await parseErrorItem(raw, context, appId, receivedAt);
      if (row) messages.push({ kind: 'error', row });
      else dropped += 1;
    } else if (raw.kind === 'event') {
      const row = parseEventItem(raw, context, appId, receivedAt);
      if (row) messages.push({ kind: 'event', row });
      else dropped += 1;
    } else {
      // Kinds this Worker does not know yet (from a newer plugin) are skipped, not errors.
      dropped += 1;
    }
  }
  return { messages, dropped };
}

/** Cloudflare Queues accept at most 100 messages and 256 KB per sendBatch call. */
const QUEUE_BATCH_MESSAGES = 100;
const QUEUE_BATCH_BYTES = 192 * 1024;

/**
 * Split messages into sendBatch calls under the Queues limits. A batch is at
 * most 128 KB, but its rows repeat the device context and add the grouping
 * fields, so they can be larger than the batch itself.
 */
export function queueChunks<T>(messages: T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const message of messages) {
    const size = new TextEncoder().encode(JSON.stringify(message)).length;
    if (
      current.length > 0 &&
      (current.length >= QUEUE_BATCH_MESSAGES || bytes + size > QUEUE_BATCH_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(message);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
