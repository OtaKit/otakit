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

export async function checkRateLimit(
  name: string,
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  const limiter = getLimiter(name, maxRequests, windowSeconds);
  if (!limiter) return { allowed: true };

  try {
    const result = await limiter.limit(identifier);
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
