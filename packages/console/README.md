# @otakit/console

OtaKit Console — the dashboard, auth, and API server. Hosted at `console.otakit.app`.

## What lives here

- Login (OAuth + email OTP)
- Dashboard UI (apps, bundles, releases, events, settings)
- All API routes (v1, auth, CRON, webhooks)
- Prisma schema and migrations
- Billing, usage enforcement, manifest publishing

## Dev

```bash
pnpm install
pnpm --filter @otakit/console dev
```

See `.env.example` for required environment variables.
