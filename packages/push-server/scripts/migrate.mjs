// Applies the push migrations. The tables live in the Postgres schema "push" of
// the same database as the console, so the URL is DATABASE_URL with schema=push
// unless PUSH_DATABASE_URL is set explicitly.
import { spawnSync } from 'node:child_process';

function pushDatabaseUrl() {
  if (process.env.PUSH_DATABASE_URL) return process.env.PUSH_DATABASE_URL;
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL (or PUSH_DATABASE_URL) to apply the push migrations.');
    process.exit(1);
  }
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', 'push');
  return url.toString();
}

const result = spawnSync('prisma', ['migrate', 'deploy', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PUSH_DATABASE_URL: pushDatabaseUrl() },
});
process.exit(result.status ?? 1);
