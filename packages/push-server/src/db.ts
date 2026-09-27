import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

export { Prisma } from './generated/prisma/client';
export type * from './generated/prisma/enums';

/** Postgres schema that holds every push table. Raw SQL names it explicitly. */
export const PUSH_SCHEMA = 'push';

/**
 * Push shares the host's database but not its tables: the same DATABASE_URL, with
 * the "push" schema. PUSH_DATABASE_URL overrides it for a separate database.
 */
function connectionString(): string {
  const raw = process.env.PUSH_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  // Prisma-only parameters that the pg driver does not understand.
  url.searchParams.delete('schema');
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  return url.toString();
}

function createClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionString() }, { schema: PUSH_SCHEMA }),
  });
}

const globalForPush = globalThis as unknown as { otakitPushDb?: PrismaClient };

/** Created on first use so importing the package never needs a database. */
export function pushDb(): PrismaClient {
  globalForPush.otakitPushDb ??= createClient();
  return globalForPush.otakitPushDb;
}
