import type {
  AppTelemetryItem,
  CaptureErrorOptions,
  CapturedError,
  ErrorTrackingOptions,
} from './definitions';
import type { Telemetry } from './telemetry';

/**
 * Error tracking (plugin 3.4+): uncaught errors and unhandled promise
 * rejections, plus captureError(), go through the shared telemetry buffer to
 * the native plugin; OtaKit groups them into issues.
 */

const SAME_ERROR_LIMIT = 5;
const DEFAULT_MAX_PER_SESSION = 100;
const MAX_MESSAGE = 1_000;
const MAX_STACK = 8 * 1024;
const MAX_NAME = 200;
const MAX_ROUTE = 200;
const MAX_TAGS = 10;
const TAG_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;

const REDACTED = '[redacted]';
// Applied to every line: the most common secrets in error text. Every pattern
// is bounded or starts at a fixed word, so long input stays linear time.
const SCRUB: Array<[RegExp, string]> = [
  // URL query strings: tokens and IDs travel there. A stack frame's ":line:column" stays.
  [
    /(\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s?#'"`<>()]*)\?[^\s#'"`<>()]*?(?=(?::\d+:\d+)?(?:[\s#'"`<>)]|$))/gi,
    `$1?${REDACTED}`,
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  [/[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}/gi, REDACTED],
  [
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)(\s*[=:]\s*["']?)[^\s&,;'"]+/gi,
    `$1$2${REDACTED}`,
  ],
];
// A run of key-like characters ('/' excluded, so URL paths are not one run).
const TOKEN_RUN = /[A-Za-z0-9+_=-]{32,}/g;

/** A long hex run, or a long run of letters and digits: a key or session ID. */
function isSecretLike(run: string): boolean {
  return (
    /^[A-Fa-f0-9]{32,}$/.test(run) || (run.length >= 40 && /\d/.test(run) && /[A-Za-z]/.test(run))
  );
}

const STACK_FRAME = /^\s*at\s|@\S*:\d+:\d+\s*$|^\S*@\S+$/;

/**
 * Replace secrets with [redacted]. `tokens: false` keeps long key-like runs,
 * for stack frames, whose long names are code locations, not secrets.
 */
export function scrub(text: string, tokens = true): string {
  let result = text;
  for (const [pattern, replacement] of SCRUB) result = result.replace(pattern, replacement);
  if (tokens) result = result.replace(TOKEN_RUN, (run) => (isSecretLike(run) ? REDACTED : run));
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

const MECHANISMS = new Set<unknown>(['onerror', 'unhandledrejection', 'manual']);

function tags(raw: CaptureErrorOptions['tags']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.keys(result).length >= MAX_TAGS) break;
    if (!TAG_KEY.test(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = scrub(String(value).slice(0, 100));
    }
  }
  return result;
}

export type ErrorTracking = {
  initErrorTracking(options?: ErrorTrackingOptions): void;
  captureError(error: unknown, options?: CaptureErrorOptions): string | null;
  testErrorTracking(): Promise<boolean>;
};

export function createErrorTracking(
  telemetry: Telemetry,
  hooks: { onSent?: () => void } = {},
): ErrorTracking {
  const env = telemetry.env;
  let options: ErrorTrackingOptions | null = null;
  let listening = false;
  let sent = 0;
  const seen = new Map<string, number>();

  function route(): string | null {
    const location = env.location();
    if (!location) return null;
    const path = `${location.pathname}${location.hash}`.replace(/\?[^#]*/g, '');
    return path ? scrub(path).slice(0, MAX_ROUTE) : null;
  }

  /** Build, filter and scrub one error; null when it is dropped. */
  function build(
    value: unknown,
    details: {
      handled: boolean;
      mechanism: CapturedError['mechanism'];
      fallbackName: string;
      fallbackStack?: string | null;
      tags?: CaptureErrorOptions['tags'];
      test?: boolean;
    },
  ): AppTelemetryItem | null {
    if (!options || telemetry.disabled()) return null;
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

    const eventId = env.uuid();
    const occurredAt = env.now().toISOString();
    let event: CapturedError | null = {
      eventId,
      occurredAt,
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
        telemetry.warnOnce(
          'beforeSend',
          `beforeSend threw, so the error was dropped: ${String(error)}`,
        );
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

    // beforeSend may return anything: keep only the fields ingest reads, in shape.
    return {
      kind: 'error',
      eventId,
      occurredAt,
      name: String(event.name || 'Error').slice(0, MAX_NAME),
      message: String(event.message ?? '').slice(0, MAX_MESSAGE),
      stack: event.stack ? String(event.stack).slice(0, MAX_STACK) : null,
      route: event.route ? String(event.route).slice(0, MAX_ROUTE) : null,
      handled: event.handled === true,
      mechanism: MECHANISMS.has(event.mechanism) ? event.mechanism : details.mechanism,
      tags: tags(event.tags),
    };
  }

  function capture(value: unknown, details: Parameters<typeof build>[1]): string | null {
    const item = build(value, details);
    if (!item || !telemetry.push(item)) return null;
    hooks.onSent?.();
    return item.eventId;
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
        telemetry.warnOnce(
          'web',
          'Error tracking and analytics run in the iOS and Android apps; nothing is sent on web.',
        );
        return;
      }
      const sampleRate = next.sampleRate ?? 1;
      if (typeof sampleRate !== 'number' || !(sampleRate >= 0 && sampleRate <= 1)) {
        throw new Error('sampleRate must be a number from 0 to 1');
      }
      options = { ...next };
      telemetry.start();
      if (listening || !env.target) return;
      listening = true;
      env.target.addEventListener('error', onError);
      env.target.addEventListener('unhandledrejection', onRejection);
    },

    captureError(error: unknown, captureOptions?: CaptureErrorOptions) {
      if (!options) {
        if (env.isNative()) {
          telemetry.warnOnce('init', 'Call initErrorTracking() before captureError().');
        }
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
        if (env.isNative()) {
          telemetry.warnOnce('init', 'Call initErrorTracking() before testErrorTracking().');
        }
        return false;
      }
      const error = new Error('This is a test error from testErrorTracking()');
      error.name = 'OtaKitTestError';
      const item = build(error, {
        handled: true,
        mechanism: 'manual',
        fallbackName: 'Error',
        tags: { otakit_test: true },
        test: true,
      });
      // Sent on its own, so the result says whether this error reached the native outbox.
      return item ? telemetry.sendNow(item) : false;
    },
  };
}
