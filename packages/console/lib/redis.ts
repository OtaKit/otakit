import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

export function getRedisOrNull(): Redis | null {
  if (!isRedisConfigured()) {
    return null;
  }
  return getRedis();
}

/** A cache that answers slower than this is skipped: the load is the fallback. */
const CACHE_TIMEOUT_MS = 500;

function withinCacheTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('cache timeout')), CACHE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Read-through cache for a JSON value. Without Redis, or when Redis fails or
 * is slow (the client retries for seconds by default), it loads directly. A
 * load that throws is not cached.
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const redis = getRedisOrNull();
  if (!redis) return load();
  try {
    const hit = await withinCacheTimeout(redis.get<T>(key));
    if (hit !== null && hit !== undefined) return hit;
  } catch (error) {
    console.warn('[Redis] cache read failed', { key, error });
  }
  const value = await load();
  try {
    await withinCacheTimeout(redis.set(key, value, { ex: ttlSeconds }));
  } catch (error) {
    console.warn('[Redis] cache write failed', { key, error });
  }
  return value;
}
