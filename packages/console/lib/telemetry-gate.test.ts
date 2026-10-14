import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = [];
  const pipeline = () => {
    const self: Record<string, unknown> = {};
    for (const command of ['sadd', 'expire', 'rename', 'persist', 'set']) {
      self[command] = (...args: unknown[]) => {
        calls.push([command, ...args]);
        return self;
      };
    }
    self.exec = vi.fn(async () => {
      calls.push(['exec']);
      return [];
    });
    return self;
  };
  return {
    calls,
    sadd: vi.fn(),
    srem: vi.fn(),
    exists: vi.fn(async () => 1),
    del: vi.fn(async (...keys: string[]) => {
      calls.push(['del', ...keys]);
      return keys.length;
    }),
    pipeline: vi.fn(pipeline),
  };
});
vi.mock('@upstash/redis', () => ({
  Redis: class {
    sadd = redis.sadd;
    srem = redis.srem;
    exists = redis.exists;
    del = redis.del;
    pipeline = redis.pipeline;
  },
}));

import {
  addTelemetryApp,
  pauseTelemetry,
  replaceTelemetryApps,
  resumeTelemetry,
  telemetryPausedKey,
} from './telemetry-gate';

describe('telemetry gate', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    redis.calls.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the key names the ingest Worker reads', () => {
    // packages/ingest/src/app-gate.ts
    expect(telemetryPausedKey('error', 'app-1')).toBe('otakit:telemetry:blocked:error:app-1');
  });

  it('rebuilds the allowlist under a temporary key and renames it into place', async () => {
    const apps = Array.from({ length: 2500 }, (_, index) => `app-${index}`);
    await expect(replaceTelemetryApps(apps)).resolves.toBe(true);
    const sadds = redis.calls.filter(([command]) => command === 'sadd');
    expect(sadds.map((call) => call.length - 2)).toEqual([1000, 1000, 500]);
    const temporary = sadds[0][1] as string;
    expect(temporary).toMatch(/^otakit:apps:building:/);
    expect(redis.calls.slice(-4)).toEqual([
      ['expire', temporary, 300],
      ['rename', temporary, 'otakit:apps'],
      ['persist', 'otakit:apps'],
      ['exec'],
    ]);
  });

  it('deletes the allowlist when there are no apps, so ingest accepts every app', async () => {
    await replaceTelemetryApps([]);
    expect(redis.calls).toEqual([['del', 'otakit:apps']]);
  });

  it('pauses until the end of the month and resumes', async () => {
    const until = new Date('2026-11-01T00:00:00.000Z');
    await pauseTelemetry('error', ['a', 'b'], until);
    expect(redis.calls).toEqual([
      [
        'set',
        'otakit:telemetry:blocked:error:a',
        until.toISOString(),
        { exat: until.getTime() / 1000 },
      ],
      [
        'set',
        'otakit:telemetry:blocked:error:b',
        until.toISOString(),
        { exat: until.getTime() / 1000 },
      ],
      ['exec'],
    ]);
    redis.calls.length = 0;
    await resumeTelemetry('error', ['a', 'b']);
    expect(redis.calls).toEqual([
      ['del', 'otakit:telemetry:blocked:error:a', 'otakit:telemetry:blocked:error:b'],
    ]);
  });

  it('adds a new app only to an existing allowlist', async () => {
    redis.sadd.mockClear();
    redis.exists.mockResolvedValueOnce(0);
    await addTelemetryApp('app-1');
    expect(redis.sadd).not.toHaveBeenCalled();
    await addTelemetryApp('app-2');
    expect(redis.sadd).toHaveBeenCalledWith('otakit:apps', 'app-2');
  });

  it('never fails app creation when Redis is down', async () => {
    redis.sadd.mockRejectedValueOnce(new Error('down'));
    await expect(addTelemetryApp('app-1')).resolves.toBeUndefined();
  });

  it('does nothing without Redis', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    await expect(replaceTelemetryApps(['a'])).resolves.toBe(false);
    await pauseTelemetry('error', ['a'], new Date());
    expect(redis.calls).toEqual([]);
  });
});
