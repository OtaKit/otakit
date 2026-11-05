import { EventEmitter } from 'node:events';

import { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { waitUntil } = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil }));

import { createPoolHold, isTransientConnectError, RetryingPool } from './db-pool';

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });
const TIMEOUT = new Error('Connection terminated due to connection timeout');
const RESET = withCode('read ECONNRESET', 'ECONNRESET');
const TOO_MANY = withCode('sorry, too many clients already', '53300');

/** Results of the next connection attempts: an error, or undefined to connect. */
let connectOutcomes: (Error | undefined)[] = [];
let connectAttempts = 0;

/** Just enough of pg.Client for pg-pool to manage it. */
class FakeClient extends EventEmitter {
  _queryable = false;
  _ending = false;

  connect(callback: (error?: Error) => void) {
    connectAttempts += 1;
    const failure = connectOutcomes.shift();
    setImmediate(() => {
      if (failure) return callback(failure);
      this._queryable = true;
      callback();
    });
  }

  query(_text: unknown, _values: unknown, callback: (error: null, result: unknown) => void) {
    setImmediate(() => callback(null, { rows: [{ ok: 1 }] }));
  }

  end(callback?: () => void) {
    this._ending = true;
    setImmediate(() => callback?.());
  }

  isConnected() {
    return this._queryable;
  }
}

const pools: Pool[] = [];
function fakePool(options: Record<string, unknown> = {}): RetryingPool {
  const pool = new RetryingPool({ Client: FakeClient, ...options } as never);
  pools.push(pool);
  return pool;
}

const heldPromises = () => waitUntil.mock.calls.map(([promise]) => promise as Promise<void>);
const isSettled = async (promise: Promise<void>) => {
  const pending = Symbol('pending');
  return (await Promise.race([promise, new Promise((r) => setImmediate(r, pending))])) !== pending;
};

afterEach(async () => {
  connectOutcomes = [];
  connectAttempts = 0;
  waitUntil.mockReset();
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

describe('isTransientConnectError', () => {
  it('accepts network failures and timeouts, not configuration or capacity errors', () => {
    expect(isTransientConnectError(TIMEOUT)).toBe(true);
    expect(isTransientConnectError(RESET)).toBe(true);
    expect(isTransientConnectError(withCode('the database system is starting up', '57P03'))).toBe(
      true,
    );
    expect(isTransientConnectError(TOO_MANY)).toBe(false);
    expect(isTransientConnectError(withCode('password authentication failed', '28P01'))).toBe(
      false,
    );
    expect(isTransientConnectError(new Error('timeout exceeded when trying to connect'))).toBe(
      false,
    );
    expect(isTransientConnectError('ECONNRESET')).toBe(false);
  });
});

describe('RetryingPool', () => {
  it('opens a connection on the second attempt when the first times out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectOutcomes = [TIMEOUT];
    const pool = fakePool();

    const client = await pool.connect();
    client.release();

    expect(connectAttempts).toBe(2);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('retries for pool.query too, which checks out through the callback form', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectOutcomes = [RESET];
    const pool = fakePool();

    await expect(pool.query('SELECT 1')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
    expect(connectAttempts).toBe(2);
    expect(pool.idleCount).toBe(1);
  });

  it('gives up after the second failed attempt', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    connectOutcomes = [TIMEOUT, RESET];
    const pool = fakePool();

    await expect(pool.connect()).rejects.toBe(RESET);
    await expect(pool.query('SELECT 1')).resolves.toBeDefined();
    expect(connectAttempts).toBe(3);
  });

  it('does not retry an error a second attempt cannot fix', async () => {
    connectOutcomes = [TOO_MANY];
    const pool = fakePool();

    await expect(pool.query('SELECT 1')).rejects.toBe(TOO_MANY);
    expect(connectAttempts).toBe(1);
  });

  it('does not retry when the pool is only full', async () => {
    const pool = fakePool({ max: 1, connectionTimeoutMillis: 20 });
    const busy = await pool.connect();
    const parentConnect = vi.spyOn(Pool.prototype, 'connect');

    await expect(pool.connect()).rejects.toThrow('timeout exceeded when trying to connect');
    expect(parentConnect).toHaveBeenCalledOnce();
    busy.release();
  });
});

describe('createPoolHold', () => {
  it('holds the instance until the pool has closed its connections', async () => {
    const pool = fakePool({ idleTimeoutMillis: 20 });
    const hold = createPoolHold(pool, 5_000, 60_000);

    await pool.query('SELECT 1');
    hold();
    const [held] = heldPromises();
    expect(await isSettled(held)).toBe(false);

    await held;
    expect(pool.totalCount).toBe(0);
  });

  it('hands the hold to the newest request so older ones do not wait on its traffic', async () => {
    const pool = fakePool({ idleTimeoutMillis: 20 });
    const hold = createPoolHold(pool, 5_000, 60_000);

    await pool.query('SELECT 1');
    hold();
    await pool.query('SELECT 1');
    hold();

    const [older, newer] = heldPromises();
    expect(newer).not.toBe(older);
    expect(await isSettled(older)).toBe(true);
    expect(await isSettled(newer)).toBe(false);
    await newer;
  });

  it('registers nothing when the pool holds no connections', () => {
    const pool = fakePool();
    createPoolHold(pool, 5_000, 60_000)();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('ends after a quiet period when idle connections are never closed', async () => {
    const pool = fakePool({ idleTimeoutMillis: 0 });
    const hold = createPoolHold(pool, 20, 60_000);

    await pool.query('SELECT 1');
    hold();
    await heldPromises()[0];
    expect(pool.totalCount).toBe(1);
  });

  it('stays while a connection is checked out, as in a transaction after its last query', async () => {
    // As in db.ts, the quiet period is longer than the idle timeout.
    const pool = fakePool({ idleTimeoutMillis: 20 });
    const hold = createPoolHold(pool, 50, 60_000);

    const client = await pool.connect();
    hold();
    const [held] = heldPromises();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await isSettled(held)).toBe(false);

    client.release();
    await held;
    expect(pool.totalCount).toBe(0);
  });

  it('lets go after the cap even if a connection is never returned', async () => {
    const pool = fakePool();
    const hold = createPoolHold(pool, 10, 40);

    const client = await pool.connect();
    hold();
    await heldPromises()[0];
    client.release();
  });
});
