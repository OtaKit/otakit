// Applies the push migrations. The tables live in the Postgres schema "push" of
// the same database as the console, so the URL is DATABASE_URL with schema=push
// unless PUSH_DATABASE_URL is set explicitly.
//
// Migrations must not run through a transaction-mode pooler (PgBouncer, Neon
// "-pooler" hosts): Prisma's migration engine runs `SET search_path = push` on its
// session, and a pooler hands that server connection to other clients afterwards,
// so the console's own queries would look for their tables in "push". The runtime
// client is not affected (it qualifies every table with the schema).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

function pushDatabaseUrl() {
  const raw = process.env.PUSH_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) {
    console.error('Set DATABASE_URL (or PUSH_DATABASE_URL) to apply the push migrations.');
    process.exit(1);
  }
  const url = new URL(raw);
  url.searchParams.set('schema', 'push');
  url.searchParams.delete('pgbouncer');
  // Neon: the direct endpoint is the pooled host without "-pooler".
  if (url.hostname.includes('-pooler.')) {
    url.hostname = url.hostname.replace('-pooler.', '.');
  } else if (/pooler|pgbouncer|:6432$/i.test(url.host) && !process.env.PUSH_MIGRATE_ALLOW_POOLER) {
    console.error(
      'DATABASE_URL looks like a connection pooler. Set PUSH_DATABASE_URL to a direct ' +
        'connection for migrations (or PUSH_MIGRATE_ALLOW_POOLER=1 for a session-mode pooler).',
    );
    process.exit(1);
  }
  return url.toString();
}

// Resolve this package's Prisma CLI so the script also works outside `pnpm run`.
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, PUSH_DATABASE_URL: pushDatabaseUrl() } },
);
if (result.error) console.error(`Could not run the Prisma CLI: ${result.error.message}`);
process.exit(result.status ?? 1);
