import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { createPoolHold, RetryingPool } from './db-pool';

/** Idle connections close after this long. */
const IDLE_TIMEOUT_MS = 5_000;

/**
 * DATABASE_URL in the form the pg driver expects. Undefined when it is not set, so
 * importing this module never needs a database (queries fail instead).
 */
function connectionString(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  // Prisma-only parameters that the pg driver does not understand.
  url.searchParams.delete('schema');
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  url.searchParams.delete('pool_timeout');
  // pg already treats require/prefer/verify-ca as verify-full and warns about it on
  // every connection; say verify-full explicitly (same behaviour, no warning).
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-ca') {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

function createClient(): PrismaClient {
  const pool = new RetryingPool({
    connectionString: connectionString(),
    max: 10,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // pg waits forever by default; fail instead of hanging. This also bounds the
    // wait for a free client when all 10 are busy. RetryingPool makes one more
    // attempt when opening a connection fails on the network.
    connectionTimeoutMillis: 10_000,
  });
  // An idle connection the server drops is reported here; without a listener Node
  // would crash on it. PrismaPg's own onPoolError listener goes away on $disconnect.
  pool.on('error', (error) => console.error('[db] idle pool client error', error));
  // Keep the instance awake until idle connections have closed, so it is never
  // frozen holding sockets (see the 2026-10-01 "Timed out fetching a new
  // connection" outage). Registered after each query, from the request.
  // The cap is above the longest transaction (releases allow 60s).
  const holdInstance = createPoolHold(pool, IDLE_TIMEOUT_MS + 1_000, 120_000);

  const client = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn'] : ['error'],
  });

  // The extension only adds behaviour, so the client keeps its PrismaClient type.
  // One difference: extended clients have no $on (log events are configured above).
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } finally {
          holdInstance();
        }
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
