import { Ratelimit } from '@upstash/ratelimit';
import { getRedisOrNull } from './redis';

const limiters = new Map<string, Ratelimit>();

function getLimiter(name: string, maxRequests: number, windowSeconds: number): Ratelimit | null {
  const redis = getRedisOrNull();
  if (!redis) return null;

  const key = `${name}:${maxRequests}:${windowSeconds}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
      prefix: `otk:rl:${name}`,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

/**
 * `cost` charges a single call for more than one request. A batched protocol
 * lets one HTTP request carry many operations, which would otherwise spend a
 * single token no matter how much work it asks for.
 */
export async function checkRateLimit(
  name: string,
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
  cost = 1,
): Promise<{ allowed: boolean }> {
  const limiter = getLimiter(name, maxRequests, windowSeconds);
  if (!limiter) return { allowed: true };

  try {
    const result = await limiter.limit(identifier, { rate: Math.max(1, Math.trunc(cost)) });
    if (!result.success) {
      console.warn(
        JSON.stringify({
          rateLimit: name,
          identifier,
          remaining: result.remaining,
          reset: result.reset,
        }),
      );
    }
    return { allowed: result.success };
  } catch (error) {
    console.error('[RateLimit] Redis error, allowing request:', error);
    return { allowed: true };
  }
}
