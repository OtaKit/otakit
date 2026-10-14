/**
 * Which apps may send app telemetry, and which of its kinds are paused
 * because the workspace reached its monthly cap. Both live in Upstash Redis,
 * written by the console: the set `otakit:apps` (every existing app) and keys
 * `otakit:telemetry:blocked:<kind>:<appId>` (expiring at the end of the month).
 *
 * Fails open: without Redis, before the set exists (a deploy that has not
 * backfilled it yet), or when Redis is unreachable, every app is accepted, so
 * an infrastructure problem never drops a customer's data.
 */

export type GateEnv = {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

export type AppGate = { known: boolean; blocked: Set<string> };

export const APPS_SET = 'otakit:apps';
export const KINDS = ['error', 'event'] as const;
const CACHE_MS = 60_000;
/** Random app IDs must not grow the cache without bound. */
const CACHE_ENTRIES = 5_000;
const OPEN: AppGate = { known: true, blocked: new Set() };

const cache = new Map<string, { gate: AppGate; expiresAt: number }>();

export function blockedKey(kind: string, appId: string): string {
  return `otakit:telemetry:blocked:${kind}:${appId}`;
}

/** For tests: start from an empty cache. */
export function resetAppGateCache(): void {
  cache.clear();
}

export async function appGate(env: GateEnv, appId: string, now = Date.now()): Promise<AppGate> {
  const url = env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/+$/, '');
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return OPEN;

  const cached = cache.get(appId);
  if (cached && cached.expiresAt > now) return cached.gate;

  try {
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['EXISTS', APPS_SET],
        ['SISMEMBER', APPS_SET, appId],
        ...KINDS.map((kind) => ['EXISTS', blockedKey(kind, appId)]),
      ]),
    });
    if (!response.ok) throw new Error(`Upstash answered ${response.status}`);
    const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const value = (index: number) => Number(results[index]?.result ?? 0);
    const gate: AppGate = {
      known: value(0) === 0 || value(1) === 1,
      blocked: new Set(KINDS.filter((_, index) => value(2 + index) === 1)),
    };
    if (cache.size >= CACHE_ENTRIES) cache.clear();
    cache.set(appId, { gate, expiresAt: now + CACHE_MS });
    return gate;
  } catch (error) {
    console.error('[Ingest] App check failed; accepting the batch', { appId, error });
    return OPEN;
  }
}
