import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';

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
  const pool = new Pool({
    connectionString: connectionString(),
    max: 10,
    // Idle connections close after 5s. attachDatabasePool keeps the Vercel instance
    // alive until they have, so a suspended instance never wakes up holding dead
    // sockets (see the 2026-10-01 "Timed out fetching a new connection" outage).
    idleTimeoutMillis: 5_000,
    // pg waits forever by default; fail the request instead of hanging the pool.
    connectionTimeoutMillis: 10_000,
  });
  attachDatabasePool(pool);

  return new PrismaClient({
    adapter: new PrismaPg(pool, {
      onPoolError: (error) => console.error('[db] idle pool client error', error),
    }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn'] : ['error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
