import net from 'node:net';

import { afterAll, describe, expect, it, vi } from 'vitest';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Forwards new connections on `port` to the database until closed. */
async function forward(port: number, target: URL): Promise<() => void> {
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port || 5432), target.hostname);
    for (const socket of [client, upstream]) {
      socket.on('error', () => {
        client.destroy();
        upstream.destroy();
      });
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  // Open connections keep working and close when the pool lets them go idle.
  return () => server.close();
}

databaseDescribe('Better Auth startup (PostgreSQL integration)', () => {
  let closeProxy = () => {};

  afterAll(async () => {
    const { db } = await import('@/lib/db');
    await db.$disconnect();
    closeProxy();
    vi.unstubAllEnvs();
  });

  // 2026-11-04: one instance's startup query failed, Better Auth kept the failed
  // startup, and /login and /dashboard failed on that instance for an hour.
  it('works on the next call after its startup could not reach the database', async () => {
    const database = new URL(process.env.DATABASE_URL!);
    const port = await freePort();
    const unreachable = new URL(database);
    unreachable.hostname = '127.0.0.1';
    unreachable.port = String(port);
    vi.stubEnv('DATABASE_URL', unreachable.toString());
    // With remote MCP OAuth on, Better Auth's startup queries the database.
    vi.stubEnv('OTAKIT_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('OTAKIT_REMOTE_MCP_OAUTH_ENABLED', 'true');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { auth } = await import('@/lib/auth');
    await expect(auth.api.getSession({ headers: new Headers() })).rejects.toThrow();

    closeProxy = await forward(port, database);
    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
  });
});
