import { describe, expect, it, vi } from 'vitest';

import { restartOnFailedStart } from './auth-restart';

type FakeAuth = {
  id: number;
  $context: Promise<string>;
  api: { whoAmI: () => number };
  handler: () => string;
};

/** Each created instance gets an id and a startup the test settles by hand. */
function fakeAuthFactory() {
  const startups: { resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
  const create = vi.fn((): FakeAuth => {
    const id = startups.length + 1;
    const $context = new Promise<string>((resolve, reject) => startups.push({ resolve, reject }));
    return { id, $context, api: { whoAmI: () => id }, handler: () => `handler ${id}` };
  });
  return { create, startups };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('restartOnFailedStart', () => {
  it('creates the instance on first use, not when wrapped', () => {
    const { create } = fakeAuthFactory();
    const auth = restartOnFailedStart(create, vi.fn());

    expect(create).not.toHaveBeenCalled();
    expect(auth.api.whoAmI()).toBe(1);
    expect(create).toHaveBeenCalledOnce();
  });

  it('keeps one instance while its startup succeeds', async () => {
    const { create, startups } = fakeAuthFactory();
    const auth = restartOnFailedStart(create, vi.fn());

    expect(auth.handler()).toBe('handler 1');
    startups[0].resolve('ready');
    await expect(auth.$context).resolves.toBe('ready');
    expect(auth.api.whoAmI()).toBe(1);
    expect(create).toHaveBeenCalledOnce();
  });

  it('replaces an instance whose startup failed', async () => {
    const { create, startups } = fakeAuthFactory();
    const onFailedStart = vi.fn();
    const auth = restartOnFailedStart(create, onFailedStart);

    const firstStartup = auth.$context;
    const failure = new Error('Connection terminated due to connection timeout');
    startups[0].reject(failure);
    // Requests already waiting on the failed startup still see its error.
    await expect(firstStartup).rejects.toBe(failure);
    await settle();

    expect(onFailedStart).toHaveBeenCalledWith(failure);
    expect(auth.api.whoAmI()).toBe(2);
    startups[1].resolve('ready');
    await expect(auth.$context).resolves.toBe('ready');
  });

  it('does not drop a newer instance when an older one fails late', async () => {
    const { create, startups } = fakeAuthFactory();
    const auth = restartOnFailedStart(create, vi.fn());

    void auth.$context.catch(() => {});
    startups[0].reject(new Error('first start failed'));
    await settle();
    expect(auth.api.whoAmI()).toBe(2);
    startups[1].resolve('ready');
    await settle();
    expect(auth.api.whoAmI()).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('answers `in` checks like the instance (better-auth/next-js uses one)', () => {
    const { create } = fakeAuthFactory();
    const auth = restartOnFailedStart(create, vi.fn());

    expect('handler' in auth).toBe(true);
    expect('missing' in auth).toBe(false);
  });

  it('does not leave a failed startup as an unhandled rejection', async () => {
    const { create, startups } = fakeAuthFactory();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const auth = restartOnFailedStart(create, vi.fn());
      expect(auth.api.whoAmI()).toBe(1);
      startups[0].reject(new Error('nobody is waiting for this'));
      await settle();
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
