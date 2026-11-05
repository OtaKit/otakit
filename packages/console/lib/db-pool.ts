import { waitUntil } from '@vercel/functions';
import { Pool, type PoolClient } from 'pg';

/** Socket errors and Postgres startup states that a second attempt can get past. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now: the server is still starting
]);
/** What pg reports when a handshake timed out or the socket closed during it. */
const TRANSIENT_MESSAGES = new Set([
  'Connection terminated due to connection timeout',
  'Connection terminated unexpectedly',
  'timeout expired',
]);

/**
 * Whether a failed attempt to open a connection is worth one more try. Configuration
 * errors (password, SSL, a missing URL) and a database at its connection limit are
 * not: a second attempt would fail the same way or add load. Neither is a full pool,
 * whose error says "timeout exceeded when trying to connect".
 */
export function isTransientConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    (typeof code === 'string' && TRANSIENT_CODES.has(code)) || TRANSIENT_MESSAGES.has(error.message)
  );
}

type ConnectCallback = (
  error: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: Error | boolean) => void,
) => void;

/**
 * A pg pool that tries once more when opening a connection fails on the network.
 *
 * Opening a connection sends no query, so a second attempt is always safe, and one
 * failed handshake costs a little latency instead of the request. pg-pool's own
 * query() goes through connect() too, so this covers every way Prisma checks out a
 * connection.
 */
export class RetryingPool extends Pool {
  connect(): Promise<PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    const connecting = this.connectWithRetry();
    if (!callback) return connecting;
    connecting.then(
      (client) => callback(undefined, client, (release) => client.release(release)),
      (error: Error) => callback(error, undefined, () => {}),
    );
  }

  private async connectWithRetry(): Promise<PoolClient> {
    const startedAt = performance.now();
    try {
      return await super.connect();
    } catch (error) {
      if (this.ending || !isTransientConnectError(error)) throw error;
      const elapsed = Math.round(performance.now() - startedAt);
      console.warn(`[db] opening a connection failed after ${elapsed}ms; trying once more`, error);
      return super.connect();
    }
  }
}

/**
 * Returns a function that keeps the Vercel instance running while `pool` holds
 * connections. Call it from the request after each query (db.ts does).
 *
 * Vercel freezes an instance once its requests have answered, unless one registered
 * work with waitUntil. A frozen instance keeps its sockets but stops its timers, so
 * it can wake up minutes later holding connections the database dropped long ago.
 * attachDatabasePool from @vercel/functions cannot prevent that here: it registers
 * from the pool's release event, and Prisma's query engine calls the pool from its
 * own threads, where no request is in scope, so it never finds one to register with.
 *
 * Like attachDatabasePool, the newest call takes over: it ends the previous hold and
 * registers a new one with its own request, so no request waits on another's
 * traffic. A hold ends when the pool has closed every connection, or once the pool
 * has been quiet for `quietMs` with nothing checked out, or after `maxMs`.
 */
export function createPoolHold(pool: Pool, quietMs: number, maxMs: number): () => void {
  let held: { resolve: () => void; startedAt: number; timer?: NodeJS.Timeout } | undefined;

  const end = () => {
    if (!held) return;
    clearTimeout(held.timer);
    held.resolve();
    held = undefined;
  };
  const restartQuietTimer = () => {
    if (!held) return;
    clearTimeout(held.timer);
    held.timer = setTimeout(() => {
      const checkedOut = pool.totalCount > pool.idleCount;
      if (checkedOut && held && Date.now() - held.startedAt < maxMs) restartQuietTimer();
      else end();
    }, quietMs);
    held.timer.unref();
  };

  // Pool events arrive outside any request, but they can still extend the current
  // hold, for example when a transaction commits after its last query.
  pool.on('acquire', restartQuietTimer);
  pool.on('release', restartQuietTimer);
  pool.on('remove', () => {
    if (pool.totalCount === 0) end();
  });

  return () => {
    end();
    if (pool.totalCount === 0) return;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    held = { resolve, startedAt: Date.now() };
    restartQuietTimer();
    waitUntil(promise);
  };
}
