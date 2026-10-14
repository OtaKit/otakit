import type {
  AppTelemetryItem,
  CaptureErrorOptions,
  CapturedError,
  ErrorTrackingOptions,
  OtaKitBridgePlugin,
} from './definitions';

/**
 * Error tracking (plugin 3.4+): uncaught errors and unhandled promise
 * rejections, plus captureError(), go to the native plugin in small batches.
 * The native side stores them with the device and release context in their
 * own outbox and delivers them; OtaKit groups them into issues.
 */

const FLUSH_MS = 5_000;
const FLUSH_AT = 20;
const MAX_PER_CALL = 50;
/** Held while the native side cannot take them; the oldest go first. */
const MAX_BUFFER = 200;
const SAME_ERROR_LIMIT = 5;
const DEFAULT_MAX_PER_SESSION = 100;
const MAX_MESSAGE = 1_000;
const MAX_STACK = 8 * 1024;
const MAX_NAME = 200;
const MAX_ROUTE = 200;
const MAX_TAGS = 10;
const TAG_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;

const REDACTED = '[redacted]';
// Applied to every line: the most common secrets in error text.
const SCRUB: Array<[RegExp, string]> = [
  // URL query strings: tokens and IDs travel there. A stack frame's ":line:column" stays.
  [
    /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"`<>()]*)\?[^\s#'"`<>()]*?(?=(?::\d+:\d+)?(?:[\s#'"`<>)]|$))/gi,
    `$1?${REDACTED}`,
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED],
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)(\s*[=:]\s*["']?)[^\s&,;'"]+/gi,
    `$1$2${REDACTED}`,
  ],
];
// Long random-looking runs (keys, session IDs). Not applied to stack frames,
// whose long paths are code locations, not secrets.
const SCRUB_TOKENS: Array<[RegExp, string]> = [
  [/\b[A-Fa-f0-9]{32,}\b/g, REDACTED],
  [/(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{40,}={0,2}/g, REDACTED],
];
const STACK_FRAME = /^\s*at\s|@\S*:\d+:\d+\s*$|^\S*@\S+$/;

export function scrub(text: string, tokens = true): string {
  let result = text;
  for (const [pattern, replacement] of SCRUB) result = result.replace(pattern, replacement);
  if (tokens) {
    for (const [pattern, replacement] of SCRUB_TOKENS) {
      result = result.replace(pattern, replacement);
    }
  }
  return result;
}

export function scrubStack(stack: string): string {
  return stack
    .split('\n')
    .map((line) => scrub(line, !STACK_FRAME.test(line)))
    .join('\n');
}

/** Browser noise with nothing to fix in the app. */
function isNoise(message: string): boolean {
  return /^Script error\.?$/.test(message) || /^ResizeObserver loop/.test(message);
}

type Environment = {
  isNative: () => boolean;
  target: Pick<EventTarget, 'addEventListener'> | null;
  document: (Pick<EventTarget, 'addEventListener'> & { visibilityState?: string }) | null;
  location: () => { pathname: string; hash: string } | null;
  random: () => number;
  uuid: () => string;
  now: () => Date;
};

function uuid(): string {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function defaultEnvironment(isNative: () => boolean): Environment {
  const scope = globalThis as unknown as {
    addEventListener?: EventTarget['addEventListener'];
    document?: Environment['document'];
    location?: { pathname: string; hash: string };
  };
  return {
    isNative,
    target: typeof scope.addEventListener === 'function' ? (scope as EventTarget) : null,
    document: scope.document ?? null,
    location: () => scope.location ?? null,
    random: Math.random,
    uuid,
    now: () => new Date(),
  };
}

function text(value: unknown, max: number): string {
  if (typeof value === 'string') return value.slice(0, max);
  if (value === undefined) return 'undefined';
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json.slice(0, max);
  } catch {
    // Circular or exotic: fall through.
  }
  return String(value).slice(0, max);
}

/** Name, message and stack of anything that was thrown or rejected. */
function describe(
  value: unknown,
  fallbackName: string,
): { name: string; message: string; stack: string | null } {
  if (value && typeof value === 'object') {
    const error = value as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof error.message === 'string') {
      return {
        name: typeof error.name === 'string' && error.name ? error.name : 'Error',
        message: error.message,
        stack: typeof error.stack === 'string' && error.stack ? error.stack : null,
      };
    }
  }
  return { name: fallbackName, message: text(value, MAX_MESSAGE), stack: null };
}

function tags(raw: CaptureErrorOptions['tags']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.keys(result).length >= MAX_TAGS) break;
    if (!TAG_KEY.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = scrub(String(value)).slice(0, 100);
    }
  }
  return result;
}

function isUnimplemented(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return code === 'UNIMPLEMENTED' || /not implemented/i.test(message);
}

export type ErrorTracking = {
  initErrorTracking(options?: ErrorTrackingOptions): void;
  captureError(error: unknown, options?: CaptureErrorOptions): string | null;
  testErrorTracking(): Promise<boolean>;
  /** Hand buffered errors to the native plugin now. */
  flush(): Promise<void>;
};

export function createErrorTracking(
  native: Pick<OtaKitBridgePlugin, 'enqueueAppTelemetry'>,
  environment: Partial<Environment> & Pick<Environment, 'isNative'>,
): ErrorTracking {
  const env: Environment = { ...defaultEnvironment(environment.isNative), ...environment };
  let options: ErrorTrackingOptions | null = null;
  let listening = false;
  let disabled = false;
  let sent = 0;
  const seen = new Map<string, number>();
  let buffer: AppTelemetryItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;
  const warned = new Set<string>();

  function warnOnce(key: string, message: string) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[OtaKit] ${message}`);
  }

  function route(): string | null {
    const location = env.location();
    if (!location) return null;
    const path = `${location.pathname}${location.hash}`.replace(/\?[^#]*/g, '');
    return path ? scrub(path).slice(0, MAX_ROUTE) : null;
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (flushing) await flushing;
    if (buffer.length === 0 || disabled) return;
    flushing = (async () => {
      while (buffer.length > 0 && !disabled) {
        const items = buffer.slice(0, MAX_PER_CALL);
        buffer = buffer.slice(items.length);
        try {
          await native.enqueueAppTelemetry({ items });
        } catch (error) {
          if (isUnimplemented(error)) {
            disabled = true;
            buffer = [];
            warnOnce(
              'native',
              'Error tracking needs @otakit/capacitor-updater 3.4 or later in the native build; errors are not sent.',
            );
          } else {
            warnOnce('enqueue', 'Could not hand errors to the native plugin.');
          }
          return;
        }
      }
    })();
    try {
      await flushing;
    } finally {
      flushing = null;
    }
  }

  function schedule() {
    if (buffer.length >= FLUSH_AT) {
      void flush();
      return;
    }
    timer ??= setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_MS);
  }

  /** Build, filter, scrub and buffer one error; returns its event ID when kept. */
  function capture(
    value: unknown,
    details: {
      handled: boolean;
      mechanism: CapturedError['mechanism'];
      fallbackName: string;
      fallbackStack?: string | null;
      tags?: CaptureErrorOptions['tags'];
      test?: boolean;
    },
  ): string | null {
    if (!options || disabled) return null;
    const described = describe(value, details.fallbackName);
    const name = described.name.slice(0, MAX_NAME);
    const message = described.message.slice(0, MAX_MESSAGE);
    const stack = described.stack ?? details.fallbackStack ?? null;
    if (!message && !stack) return null;

    if (!details.test) {
      if (isNoise(message)) return null;
      const label = `${name}: ${message}`;
      for (const pattern of options.ignoreErrors ?? []) {
        if (typeof pattern === 'string' ? label.includes(pattern) : pattern.test(label)) {
          return null;
        }
      }
      if (env.random() >= (options.sampleRate ?? 1)) return null;
    }

    let event: CapturedError | null = {
      eventId: env.uuid(),
      occurredAt: env.now().toISOString(),
      name: scrub(name),
      message: scrub(message),
      stack: stack ? scrubStack(stack.slice(0, MAX_STACK)) : null,
      route: route(),
      handled: details.handled,
      mechanism: details.mechanism,
      tags: tags(details.tags),
    };
    if (!details.test && options.beforeSend) {
      try {
        event = options.beforeSend(event);
      } catch (error) {
        warnOnce('beforeSend', `beforeSend threw, so the error was dropped: ${String(error)}`);
        return null;
      }
      if (!event) return null;
    }

    if (!details.test) {
      const firstFrame = event.stack?.split('\n').find((line) => STACK_FRAME.test(line)) ?? '';
      const key = `${event.name}|${event.message}|${firstFrame}`;
      const count = seen.get(key) ?? 0;
      const max = options.maxEventsPerSession ?? DEFAULT_MAX_PER_SESSION;
      if (count >= SAME_ERROR_LIMIT || sent >= max) return null;
      seen.set(key, count + 1);
      sent += 1;
    }

    // beforeSend may return anything: keep the shape ingest expects.
    buffer.push({
      ...event,
      kind: 'error',
      name: String(event.name || 'Error').slice(0, MAX_NAME),
      message: String(event.message ?? '').slice(0, MAX_MESSAGE),
      stack: event.stack ? String(event.stack).slice(0, MAX_STACK) : null,
      route: event.route ? String(event.route).slice(0, MAX_ROUTE) : null,
      tags: tags(event.tags),
    });
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(buffer.length - MAX_BUFFER);
    schedule();
    return event.eventId;
  }

  function onError(event: Event) {
    try {
      // Resource load failures (<img>, <script>) are not JavaScript errors.
      if (!('message' in event) && !('error' in event)) return;
      const errorEvent = event as ErrorEvent;
      const location =
        errorEvent.filename && errorEvent.lineno
          ? `    at ${errorEvent.filename}:${errorEvent.lineno}:${errorEvent.colno ?? 0}`
          : null;
      capture(errorEvent.error ?? { name: 'Error', message: errorEvent.message ?? '' }, {
        handled: false,
        mechanism: 'onerror',
        fallbackName: 'Error',
        fallbackStack: location,
      });
    } catch {
      // Error tracking must never throw inside the app's error path.
    }
  }

  function onRejection(event: Event) {
    try {
      capture((event as PromiseRejectionEvent).reason, {
        handled: false,
        mechanism: 'unhandledrejection',
        fallbackName: 'UnhandledRejection',
      });
    } catch {
      // Error tracking must never throw inside the app's error path.
    }
  }

  return {
    initErrorTracking(next: ErrorTrackingOptions = {}) {
      if (!env.isNative()) {
        warnOnce('web', 'Error tracking runs in the iOS and Android apps; nothing is sent on web.');
        return;
      }
      const sampleRate = next.sampleRate ?? 1;
      if (typeof sampleRate !== 'number' || !(sampleRate >= 0 && sampleRate <= 1)) {
        throw new Error('sampleRate must be a number from 0 to 1');
      }
      options = { ...next };
      if (listening || !env.target) return;
      listening = true;
      env.target.addEventListener('error', onError);
      env.target.addEventListener('unhandledrejection', onRejection);
      env.target.addEventListener('pagehide', () => void flush());
      env.document?.addEventListener('visibilitychange', () => {
        if (env.document?.visibilityState === 'hidden') void flush();
      });
    },

    captureError(error: unknown, captureOptions?: CaptureErrorOptions) {
      if (!options) {
        if (env.isNative()) warnOnce('init', 'Call initErrorTracking() before captureError().');
        return null;
      }
      try {
        return capture(error, {
          handled: true,
          mechanism: 'manual',
          fallbackName: 'Error',
          tags: captureOptions?.tags,
        });
      } catch {
        return null;
      }
    },

    async testErrorTracking() {
      if (!options) {
        if (env.isNative())
          warnOnce('init', 'Call initErrorTracking() before testErrorTracking().');
        return false;
      }
      const error = new Error('This is a test error from testErrorTracking()');
      error.name = 'OtaKitTestError';
      const id = capture(error, {
        handled: true,
        mechanism: 'manual',
        fallbackName: 'Error',
        tags: { otakit_test: true },
        test: true,
      });
      const item = buffer.find((entry) => entry.eventId === id);
      if (!item) return false;
      // Sent on its own, so the result says whether this error reached the native outbox.
      buffer = buffer.filter((entry) => entry !== item);
      try {
        const result = await native.enqueueAppTelemetry({ items: [item] });
        return result.accepted === 1;
      } catch (error) {
        if (isUnimplemented(error)) {
          disabled = true;
          buffer = [];
          warnOnce(
            'native',
            'Error tracking needs @otakit/capacitor-updater 3.4 or later in the native build; errors are not sent.',
          );
        }
        return false;
      }
    },

    flush,
  };
}
