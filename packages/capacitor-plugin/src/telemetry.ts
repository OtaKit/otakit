import type { AppTelemetryBundle, AppTelemetryItem, OtaKitBridgePlugin } from './definitions';

/**
 * The JavaScript half of app telemetry (plugin 3.4+), shared by error tracking
 * and custom events: one buffer, flushed to the native plugin every 5 seconds,
 * at 20 items, and when the page is hidden. The native side stores the items
 * with the device and release context in their own outbox and delivers them.
 */

const FLUSH_MS = 5_000;
const FLUSH_AT = 20;
const MAX_PER_CALL = 50;
/** Held while the native side cannot take them; the oldest go first. */
const MAX_BUFFER = 200;

export type TelemetryEnvironment = {
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

export function defaultEnvironment(isNative: () => boolean): TelemetryEnvironment {
  const scope = globalThis as unknown as {
    addEventListener?: EventTarget['addEventListener'];
    document?: TelemetryEnvironment['document'];
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

export function isUnimplemented(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return code === 'UNIMPLEMENTED' || /not implemented/i.test(message);
}

export type Telemetry = {
  env: TelemetryEnvironment;
  /** Listen for page hide and read the bundle once; later calls do nothing. */
  start(): void;
  /** The bundle this JavaScript runs from, once read (null when it cannot be read). */
  ready(): Promise<AppTelemetryBundle | null>;
  /** The bundle read so far, or null. */
  bundle(): AppTelemetryBundle | null;
  /** Queue an item for the next flush. False when telemetry is off (an older native plugin). */
  push(item: AppTelemetryItem): boolean;
  /** Hand one item to the native plugin right away; true when it was stored. */
  sendNow(item: AppTelemetryItem): Promise<boolean>;
  /** Hand buffered items to the native plugin now. */
  flush(): Promise<void>;
  /** The native plugin has no app telemetry (older than 3.4). */
  disabled(): boolean;
  warnOnce(key: string, message: string): void;
};

const NATIVE_TOO_OLD =
  'Error tracking and analytics need @otakit/capacitor-updater 3.4 or later in the native build; nothing is sent.';

export function createTelemetry(
  native: Pick<OtaKitBridgePlugin, 'enqueueAppTelemetry' | 'getState'>,
  environment: Partial<TelemetryEnvironment> & Pick<TelemetryEnvironment, 'isNative'>,
): Telemetry {
  const env: TelemetryEnvironment = { ...defaultEnvironment(environment.isNative), ...environment };
  let started = false;
  let off = false;
  let buffer: AppTelemetryItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing: Promise<void> | null = null;
  /** The bundle this JavaScript runs from; null until getState() answers. */
  let bundle: AppTelemetryBundle | null = null;
  let bundleRead: Promise<AppTelemetryBundle | null> = Promise.resolve(null);
  const warned = new Set<string>();

  function warnOnce(key: string, message: string) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[OtaKit] ${message}`);
  }

  function handleFailure(error: unknown, items: AppTelemetryItem[]) {
    if (isUnimplemented(error)) {
      off = true;
      buffer = [];
      warnOnce('native', NATIVE_TOO_OLD);
      return;
    }
    // Kept for the next flush (the oldest go first past the limit).
    buffer = [...items, ...buffer].slice(-MAX_BUFFER);
    warnOnce('enqueue', 'Could not hand telemetry to the native plugin; will retry.');
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (flushing) await flushing;
    if (buffer.length === 0 || off) return;
    flushing = (async () => {
      while (buffer.length > 0 && !off) {
        const items = buffer.slice(0, MAX_PER_CALL);
        buffer = buffer.slice(items.length);
        try {
          await native.enqueueAppTelemetry(bundle ? { items, bundle } : { items });
        } catch (error) {
          handleFailure(error, items);
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

  return {
    env,
    start() {
      if (started) return;
      started = true;
      bundleRead = native
        .getState()
        .then(({ current }) => {
          bundle = {
            bundleVersion: current.id === 'builtin' ? 'builtin' : current.version,
            releaseId: current.releaseId ?? null,
            channel: current.channel ?? null,
          };
          return bundle;
        })
        .catch(() => {
          // Native then uses its current bundle.
          return null;
        });
      env.target?.addEventListener('pagehide', () => void flush());
      env.document?.addEventListener('visibilitychange', () => {
        if (env.document?.visibilityState === 'hidden') void flush();
      });
    },
    ready: () => bundleRead,
    bundle: () => bundle,
    push(item) {
      if (off) return false;
      buffer.push(item);
      if (buffer.length > MAX_BUFFER) buffer = buffer.slice(buffer.length - MAX_BUFFER);
      schedule();
      return true;
    },
    async sendNow(item) {
      if (off) return false;
      try {
        const result = await native.enqueueAppTelemetry(
          bundle ? { items: [item], bundle } : { items: [item] },
        );
        return result.accepted === 1;
      } catch (error) {
        if (isUnimplemented(error)) handleFailure(error, []);
        return false;
      }
    },
    flush,
    disabled: () => off,
    warnOnce,
  };
}
