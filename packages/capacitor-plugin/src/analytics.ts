import type {
  AnalyticsOptions,
  AppTelemetryItem,
  EventProperties,
  TrackedEvent,
} from './definitions';
import type { Telemetry } from './telemetry';

/**
 * Custom events (plugin 3.4+): `track()` sends named events with a few
 * properties through the shared telemetry buffer. OtaKit adds the release,
 * channel, platform and OS version on the device.
 */

const EVENT_NAME = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.:-]{1,64}$/;
const PROPERTY_KEY = /^[A-Za-z0-9_.:-]{1,40}$/;
const MAX_PROPERTIES = 20;
const MAX_VALUE = 200;
const DEFAULT_MAX_PER_SESSION = 1_000;
const SESSION_START = '$session_start';
/** The bundle the last `$session_start` of this app launch was sent from. */
const SESSION_FLAG = 'otakit:session_start';

/** Valid properties only: up to 20 keys, string (cut to 200), finite number or boolean values. */
function properties(raw: unknown): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_PROPERTIES) break;
    if (!PROPERTY_KEY.test(key)) continue;
    if (typeof value === 'string') result[key] = value.slice(0, MAX_VALUE);
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'boolean') result[key] = value;
  }
  return result;
}

export type SessionFlag = { get(): string | null; set(value: string): void };

/** sessionStorage survives a reload (an OTA update) but not a new app launch. */
function sessionStorageFlag(): SessionFlag {
  return {
    get() {
      try {
        return globalThis.sessionStorage?.getItem(SESSION_FLAG) ?? null;
      } catch {
        return null;
      }
    },
    set(value) {
      try {
        globalThis.sessionStorage?.setItem(SESSION_FLAG, value);
      } catch {
        // A duplicate $session_start in one app launch is harmless: sessions count once.
      }
    },
  };
}

export type Analytics = {
  initAnalytics(options?: AnalyticsOptions): void;
  track(name: string, properties?: EventProperties): boolean;
};

export function createAnalytics(
  telemetry: Telemetry,
  sessionFlag: SessionFlag = sessionStorageFlag(),
): Analytics {
  const env = telemetry.env;
  let options: AnalyticsOptions = {};
  let sampled: boolean | null = null;
  let sent = 0;

  function inSample(): boolean {
    // One decision per page load, so a session's events are all sent or none.
    sampled ??= env.random() < (options.sampleRate ?? 1);
    return sampled;
  }

  function send(name: string, raw: unknown, reserved = false): boolean {
    if (!env.isNative()) {
      telemetry.warnOnce(
        'web',
        'Error tracking and analytics run in the iOS and Android apps; nothing is sent on web.',
      );
      return false;
    }
    if (!reserved && (typeof name !== 'string' || !EVENT_NAME.test(name))) {
      telemetry.warnOnce(
        'event-name',
        `Dropped event ${JSON.stringify(name)}: names use 1-64 letters, numbers, ".", "_", ":" or "-", with a letter or number.`,
      );
      return false;
    }
    if (telemetry.disabled() || !inSample()) return false;
    if (sent >= (options.maxEventsPerSession ?? DEFAULT_MAX_PER_SESSION)) {
      telemetry.warnOnce(
        'event-limit',
        'Event limit for this app launch reached; later events are dropped.',
      );
      return false;
    }
    let event: TrackedEvent | null = {
      eventId: env.uuid(),
      occurredAt: env.now().toISOString(),
      name,
      properties: properties(raw),
    };
    if (!reserved && options.beforeSend) {
      try {
        event = options.beforeSend(event);
      } catch (error) {
        telemetry.warnOnce(
          'event-beforeSend',
          `beforeSend threw, so the event was dropped: ${String(error)}`,
        );
        return false;
      }
      if (!event) return false;
    }
    // beforeSend may return anything: keep the name and known fields, in shape.
    const item: AppTelemetryItem = {
      kind: 'event',
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      name: reserved || EVENT_NAME.test(event.name) ? event.name : name,
      properties: properties(event.properties),
    };
    telemetry.start();
    if (!telemetry.push(item)) return false;
    sent += 1;
    return true;
  }

  return {
    initAnalytics(next: AnalyticsOptions = {}) {
      const sampleRate = next.sampleRate ?? 1;
      if (typeof sampleRate !== 'number' || !(sampleRate >= 0 && sampleRate <= 1)) {
        throw new Error('sampleRate must be a number from 0 to 1');
      }
      options = { ...next };
      // Decide again with this sampleRate, even when an earlier track() already did.
      sampled = null;
      if (!env.isNative()) {
        send(SESSION_START, {}, true);
        return;
      }
      telemetry.start();
      if (next.sessionEvents ?? true) {
        // Once per app launch and bundle: after an update reloads the app, the
        // launch also counts for the new release.
        void telemetry.ready().then((bundle) => {
          const key = bundle ? `${bundle.releaseId ?? ''}|${bundle.bundleVersion}` : '';
          if (sessionFlag.get() === key) return;
          if (send(SESSION_START, {}, true)) sessionFlag.set(key);
        });
      }
    },
    track(name: string, eventProperties?: EventProperties) {
      try {
        return send(name, eventProperties);
      } catch {
        return false;
      }
    },
  };
}
