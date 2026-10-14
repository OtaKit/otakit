import { getRedisOrNull } from '@/lib/redis';

/**
 * What the ingest Worker checks before it accepts app telemetry
 * (packages/ingest/src/app-gate.ts): the set of existing apps, and per app and
 * kind a key that pauses the kind until the end of the month. Keep the names
 * in sync with the Worker.
 *
 * Without Redis these are no-ops and the Worker accepts every app.
 */

export const TELEMETRY_APPS_SET = 'otakit:apps';
export type TelemetryKind = 'error';

export function telemetryPausedKey(kind: TelemetryKind, appId: string): string {
  return `otakit:telemetry:blocked:${kind}:${appId}`;
}

const SADD_CHUNK = 1000;

/** Best effort: the errors cron rebuilds the set every run, so a failure here heals. */
export async function addTelemetryApp(appId: string): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis) return;
  try {
    await redis.sadd(TELEMETRY_APPS_SET, appId);
  } catch (error) {
    console.warn('[Telemetry] could not add app to the allowlist', { appId, error });
  }
}

export async function removeTelemetryApp(appId: string): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis) return;
  try {
    await redis.srem(TELEMETRY_APPS_SET, appId);
  } catch (error) {
    console.warn('[Telemetry] could not remove app from the allowlist', { appId, error });
  }
}

/**
 * Replace the set with exactly these apps, atomically: it is built under a
 * temporary key and renamed. With no apps the set is deleted, which the Worker
 * reads as "accept every app".
 */
export async function replaceTelemetryApps(appIds: string[]): Promise<boolean> {
  const redis = getRedisOrNull();
  if (!redis) return false;
  const temporary = `${TELEMETRY_APPS_SET}:building:${crypto.randomUUID()}`;
  try {
    if (appIds.length === 0) {
      await redis.del(TELEMETRY_APPS_SET);
      return true;
    }
    const pipeline = redis.pipeline();
    for (let index = 0; index < appIds.length; index += SADD_CHUNK) {
      const [first, ...rest] = appIds.slice(index, index + SADD_CHUNK);
      pipeline.sadd(temporary, first, ...rest);
    }
    // The expiry removes a half-built set if the pipeline stops early; RENAME
    // keeps it, so it is removed again from the live set.
    pipeline.expire(temporary, 300);
    pipeline.rename(temporary, TELEMETRY_APPS_SET);
    pipeline.persist(TELEMETRY_APPS_SET);
    await pipeline.exec();
    return true;
  } catch (error) {
    console.error('[Telemetry] could not rebuild the app allowlist', { error });
    await redis.del(temporary).catch(() => undefined);
    return false;
  }
}

/** Pause a kind for these apps until `until` (the keys expire then). */
export async function pauseTelemetry(
  kind: TelemetryKind,
  appIds: string[],
  until: Date,
): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis || appIds.length === 0) return;
  const pipeline = redis.pipeline();
  const expiresAt = Math.floor(until.getTime() / 1000);
  for (const appId of appIds) {
    pipeline.set(telemetryPausedKey(kind, appId), until.toISOString(), { exat: expiresAt });
  }
  await pipeline.exec();
}

export async function resumeTelemetry(kind: TelemetryKind, appIds: string[]): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis || appIds.length === 0) return;
  await redis.del(...appIds.map((appId) => telemetryPausedKey(kind, appId)));
}
