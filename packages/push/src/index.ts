import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * OtaKit Push: registers the token from @capacitor/push-notifications with OtaKit,
 * together with the OTA channel and bundle when the OtaKit updater is installed,
 * so you can target pushes by release channel.
 */

export type PushEnvironment = 'production' | 'sandbox';

export type InitOptions = {
  /** Your OtaKit app ID (the same one as plugins.OtaKit.appId). */
  appId: string;
  /** Console origin. Defaults to the hosted service; set it when self-hosting. */
  serverUrl?: string;
  /**
   * APNs environment of this build. Debug builds from Xcode use `sandbox`; TestFlight
   * and App Store builds use `production` (the default). OtaKit also detects a
   * sandbox token automatically on the first send.
   */
  environment?: PushEnvironment;
};

export type SyncOptions = {
  /** Your own user ID, to target pushes at a person. `null` clears it. */
  userId?: string | null;
  /** Topics to subscribe to, replacing the stored list. */
  topics?: string[];
};

export type SyncResult =
  | { status: 'registered' | 'updated' | 'unchanged' }
  | { status: 'not_accepted'; reason: string }
  | { status: 'failed'; error: string };

type StoredState = {
  token: string;
  fingerprint: string;
  syncedAt: number;
  userId: string | null;
  topics: string[];
};

type OtaKitContext = {
  channel: string | null;
  runtimeVersion: string | null;
  bundleVersion: string | null;
};

type OtaKitBridge = {
  getChannel(): Promise<{ channel: string | null }>;
  getState(): Promise<{ current?: { version?: string; runtimeVersion?: string } }>;
};

const DEFAULT_SERVER_URL = 'https://console.otakit.app';
const STORAGE_KEY = 'otakit.push.v1';
const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000;

// Same native plugin the updater registers. If the updater is not installed,
// calls reject and the OTA context is simply left out.
const OtaKitNative = registerPlugin<OtaKitBridge>('OtaKit');

let config:
  | (Required<Pick<InitOptions, 'appId' | 'serverUrl'>> & {
      environment: PushEnvironment;
    })
  | null = null;

function requireConfig() {
  if (!config) throw new Error('Call OtaKitPush.init({ appId }) first.');
  return config;
}

function readState(): StoredState | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredState) : null;
  } catch {
    return null;
  }
}

function writeState(state: StoredState | null): void {
  try {
    if (state) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Storage is best effort; the worst case is an extra sync.
  }
}

async function readOtaContext(): Promise<OtaKitContext> {
  const empty: OtaKitContext = { channel: null, runtimeVersion: null, bundleVersion: null };
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('OtaKit')) return empty;
  try {
    const [channel, state] = await Promise.all([
      OtaKitNative.getChannel(),
      OtaKitNative.getState(),
    ]);
    return {
      channel: channel.channel ?? null,
      runtimeVersion: state.current?.runtimeVersion ?? null,
      bundleVersion: state.current?.version ?? null,
    };
  } catch {
    return empty;
  }
}

function currentPlatform(): 'ios' | 'android' | null {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

function locale(): string | null {
  try {
    return globalThis.navigator?.language?.slice(0, 16) ?? null;
  } catch {
    return null;
  }
}

async function request(
  path: string,
  method: 'POST' | 'DELETE',
  body: Record<string, unknown>,
): Promise<Response> {
  const { appId, serverUrl } = requireConfig();
  return fetch(`${serverUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-app-id': appId },
    body: JSON.stringify(body),
  });
}

function validateTopic(topic: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) {
    throw new Error(`Invalid topic "${topic}": use 1-64 letters, numbers, "_" or "-".`);
  }
}

export const OtaKitPush = {
  init(options: InitOptions): void {
    if (!options?.appId) throw new Error('OtaKitPush.init requires an appId.');
    config = {
      appId: options.appId,
      serverUrl: (options.serverUrl ?? DEFAULT_SERVER_URL).replace(/\/+$/, ''),
      environment: options.environment ?? 'production',
    };
  },

  /**
   * Call from the `registration` listener of @capacitor/push-notifications. Sends only
   * when something changed, or once a day to keep the device active.
   */
  async syncToken(token: string, options: SyncOptions = {}): Promise<SyncResult> {
    const { environment } = requireConfig();
    const platform = currentPlatform();
    if (!platform) return { status: 'not_accepted', reason: 'not_native' };
    if (!token) throw new Error('syncToken requires the device token.');
    for (const topic of options.topics ?? []) validateTopic(topic);

    const previous = readState();
    const userId = options.userId !== undefined ? options.userId : (previous?.userId ?? null);
    const topics = options.topics ?? previous?.topics ?? [];
    const context = await readOtaContext();
    const body = {
      token,
      platform,
      environment,
      externalUserId: userId,
      topics,
      channel: context.channel,
      runtimeVersion: context.runtimeVersion,
      bundleVersion: context.bundleVersion,
      locale: locale(),
    };
    const fingerprint = JSON.stringify(body);
    if (
      previous &&
      previous.fingerprint === fingerprint &&
      Date.now() - previous.syncedAt < RESYNC_AFTER_MS
    ) {
      return { status: 'unchanged' };
    }

    try {
      const response = await request('/api/v1/push/devices', 'POST', body);
      const payload = (await response.json().catch(() => ({}))) as {
        accepted?: boolean;
        reason?: string;
        created?: boolean;
        error?: string;
      };
      if (response.status === 202 || payload.accepted === false) {
        return { status: 'not_accepted', reason: payload.reason ?? 'not_accepted' };
      }
      if (!response.ok) {
        return { status: 'failed', error: payload.error ?? `HTTP ${response.status}` };
      }
      writeState({ token, fingerprint, syncedAt: Date.now(), userId, topics });
      return { status: payload.created ? 'registered' : 'updated' };
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : 'Network error' };
    }
  },

  /** Attach your own user ID to this device (or clear it with `null`). */
  async setUser(userId: string | null): Promise<SyncResult> {
    const previous = readState();
    if (!previous) return { status: 'not_accepted', reason: 'no_token_yet' };
    return this.syncToken(previous.token, { userId, topics: previous.topics });
  },

  async subscribe(topic: string): Promise<SyncResult> {
    validateTopic(topic);
    const previous = readState();
    if (!previous) return { status: 'not_accepted', reason: 'no_token_yet' };
    if (previous.topics.includes(topic)) return { status: 'unchanged' };
    return this.syncToken(previous.token, { topics: [...previous.topics, topic].slice(0, 20) });
  },

  async unsubscribe(topic: string): Promise<SyncResult> {
    const previous = readState();
    if (!previous) return { status: 'not_accepted', reason: 'no_token_yet' };
    if (!previous.topics.includes(topic)) return { status: 'unchanged' };
    return this.syncToken(previous.token, {
      topics: previous.topics.filter((existing) => existing !== topic),
    });
  },

  /** Remove this device from OtaKit, e.g. when the user signs out or opts out. */
  async unregister(): Promise<void> {
    const previous = readState();
    if (!previous) return;
    try {
      await request('/api/v1/push/devices', 'DELETE', { token: previous.token });
    } finally {
      writeState(null);
    }
  },
};

/** Test hook. */
export function resetOtaKitPushForTests(): void {
  config = null;
  writeState(null);
}
