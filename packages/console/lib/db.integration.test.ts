import { AsyncLocalStorage } from 'node:async_hooks';

import { afterAll, describe, expect, it } from 'vitest';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

/** Where @vercel/functions looks up the current request, as the Vercel runtime sets it. */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');
type RequestContext = { waitUntil: (promise: Promise<unknown>) => void };

databaseDescribe('database client (PostgreSQL integration)', () => {
  const globals = globalThis as Record<symbol, unknown>;
  const previousContext = globals[REQUEST_CONTEXT];
  const requests = new AsyncLocalStorage<RequestContext>();
  globals[REQUEST_CONTEXT] = { get: () => requests.getStore() };

  afterAll(async () => {
    globals[REQUEST_CONTEXT] = previousContext;
    const { db } = await import('@/lib/db');
    await db.$disconnect();
  });

  /** Runs `work` the way Vercel runs a handler; returns what it passed to waitUntil. */
  async function inRequest(work: () => Promise<unknown>): Promise<Promise<unknown>[]> {
    const registered: Promise<unknown>[] = [];
    await requests.run({ waitUntil: (promise) => registered.push(promise) }, async () => {
      await work();
    });
    return registered;
  }

  // Prisma's engine calls the pool outside any request, so the hold has to be
  // registered from the query itself (lib/db.ts) to reach the request.
  it('keeps the instance awake after every kind of query', async () => {
    const { db } = await import('@/lib/db');

    expect(await inRequest(() => db.user.findMany({ take: 1 }))).toHaveLength(1);
    expect(await inRequest(() => db.$queryRaw`SELECT 1`)).toHaveLength(1);
    const inTransaction = await inRequest(() => db.$transaction(async (tx) => tx.user.count()));
    expect(inTransaction.length).toBeGreaterThan(0);
  });
});
