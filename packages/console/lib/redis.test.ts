import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = store.get;
    set = store.set;
  },
}));

import { cachedJson } from './redis';

describe('cachedJson', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    store.get.mockReset();
    store.set.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns a cached value without loading', async () => {
    store.get.mockResolvedValue([1, 2]);
    const load = vi.fn();
    await expect(cachedJson('key', 60, load)).resolves.toEqual([1, 2]);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and stores a miss with the TTL', async () => {
    store.get.mockResolvedValue(null);
    await expect(cachedJson('key', 60, async () => ({ a: 1 }))).resolves.toEqual({ a: 1 });
    expect(store.set).toHaveBeenCalledWith('key', { a: 1 }, { ex: 60 });
  });

  it('falls back to loading when Redis fails, and never caches a failed load', async () => {
    store.get.mockRejectedValue(new Error('down'));
    store.set.mockRejectedValue(new Error('down'));
    await expect(cachedJson('key', 60, async () => 'fresh')).resolves.toBe('fresh');
    store.get.mockResolvedValue(null);
    await expect(
      cachedJson('key', 60, async () => {
        throw new Error('Tinybird failed');
      }),
    ).rejects.toThrow('Tinybird failed');
    expect(store.set).toHaveBeenCalledTimes(1);
  });
});
