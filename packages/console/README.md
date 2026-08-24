# @otakit/console

OtaKit Console — the dashboard, auth, and API server. Hosted at `console.otakit.app`.

## What lives here

- Login (OAuth + email OTP)
- Dashboard UI (apps, bundles, releases, events, settings)
- All API routes (v1, auth, CRON, webhooks)
- Prisma schema and migrations
- Billing, usage enforcement, manifest publishing

## Cron endpoints

Routes for external schedulers:

- `GET /api/cron/usage-aggregate` — daily billing usage rollup. Requires a
  `Bearer` token matching `CRON_SECRET` (unset means always 401).
- `POST /api/cron/auto-revert` — release health sweep (~every 10 min). If
  `CRON_SECRET` is set, pass it as a `Bearer` header or `?secret=` query
  param (for schedulers that can only call a bare URL); if unset, the
  endpoint is open — the sweep is idempotent and can only revert releases
  whose own thresholds trip. Reverts a
  current release whose `autoRevert` flag is set when, within a rolling 24 h
  window, `applied + rollback` device events reach the release's min sample
  and the rollback share reaches its rate threshold. Requires Tinybird;
  without it the sweep skips apps and never reverts.

## Dev

```bash
pnpm install
pnpm --filter @otakit/console dev
```

See `.env.example` for required environment variables.

