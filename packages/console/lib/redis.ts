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

/**
 * Read-through cache for a JSON value. Without Redis, or when Redis fails, it
 * loads directly. A load that throws is not cached.
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const redis = getRedisOrNull();
  if (!redis) return load();
  try {
    const hit = await redis.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch (error) {
    console.warn('[Redis] cache read failed', { key, error });
  }
  const value = await load();
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    console.warn('[Redis] cache write failed', { key, error });
  }
  return value;
}
