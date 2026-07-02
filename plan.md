# Split web app into landing site + dashboard

## What we're doing

Split `packages/web` into two separate Next.js apps:

- **`packages/site`** — public landing page, docs, contact, legal. Hosted at `otakit.app`.
- **`packages/console`** — login, dashboard, all API routes, auth, DB, billing. Hosted at `console.otakit.app`.

Both deployed as separate Vercel projects from the same monorepo.

---

## Why

- Landing site becomes fast and simple — no DB, no auth, no server dependencies. Could move to Cloudflare Pages later.
- Dashboard app owns all server-side complexity — DB, auth, billing, storage, APIs.
- Independent deploys — landing page copy changes don't rebuild the dashboard.
- Cleaner dependency tree — landing site has ~5 dependencies, dashboard has ~30.

---

## Domain layout

| URL | App | Purpose |
|---|---|---|
| `otakit.app` | site | Landing page, docs, contact, terms, privacy |
| `otakit.app/docs/*` | site | Documentation |
| `otakit.app/contact` | site | Contact form |
| `console.otakit.app` | console | Redirects to /login or /dashboard |
| `console.otakit.app/login` | console | Auth (OAuth, OTP) |
| `console.otakit.app/dashboard` | console | Dashboard UI |
| `console.otakit.app/api/*` | console | All API routes |

"Get started" and "Sign in" buttons on the landing site link to `console.otakit.app/login`.

---

## What goes where

### `packages/site` (landing)

**Pages:**
- `app/page.tsx` — landing page
- `app/docs/` — all 11 doc pages + layout + sidebar
- `app/contact/` — contact page + form (public, no auth needed)
- `app/terms/page.tsx`
- `app/policy/page.tsx`
- `app/docs/llms.txt/route.ts`

**API routes:**
- `app/api/contact/route.ts` — contact form email (only needs Resend, no DB)

**Components:**
- `app/components/CopyCode.tsx`
- `app/docs/DocsSidebar.tsx`
- `components/ui/` — copy the used subset (button, separator, input, label, sheet, etc.)

**Libs:**
- `lib/utils.ts` — cn() helper
- `lib/support.ts` — support email constant
- `lib/email.ts` — for contact form (Resend only, optional)

**Public assets:**
- `logo.svg`, `logo.png`
- `app-icons/` (hero cloud)
- `dashboard-preview.png`
- `android.svg`, `apple.svg`
- `llms.txt`
- `favicon.ico`

**Config:**
- Own `package.json` (minimal deps: next, react, lucide-react, tailwindcss, sonner, resend)
- Own `next.config.ts`
- Own `tsconfig.json`
- Own `postcss.config.mjs`
- Own `.env.example` (just `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` — all optional)

**No:** DB, Prisma, auth, middleware, billing, storage, tinybird, redis, polar

### `packages/console` (dashboard)

**Pages:**
- `app/login/` — login page + client component
- `app/dashboard/` — all dashboard pages + layout + data provider
- `app/components/` — DashboardHeader, ProductDashboard, SettingsDashboard, OrganizationKeyAdmin, PricingDialog, SignOutButton, dashboard-types
- Redirect root `/` to `/dashboard` (or `/login` if not authenticated)

**API routes (all of them):**
- `app/api/auth/[...all]/` — Better Auth
- `app/api/v1/*` — all app/bundle/release/event/organization/billing APIs
- `app/api/cron/*` — usage aggregation
- `app/api/webhook/*` — Polar webhooks
- `app/api/health/` — health check
- No `/api/contact` (stays on landing site)

**Components:**
- `app/components/*` — all dashboard components
- `components/ui/` — copy the full set (dashboard uses more UI components)

**Libs (all of them):**
- `lib/auth.ts` + `lib/auth-client.ts`
- `lib/db.ts`
- `lib/api-auth.ts`
- `lib/session.ts`
- `lib/organization-access.ts` + `lib/organization-keys.ts`
- `lib/storage.ts`
- `lib/manifest-signing.ts` + `lib/manifest-files.ts`
- `lib/releases.ts` + `lib/release-audit.ts`
- `lib/cdn-purge.ts`
- `lib/hash.ts`
- `lib/email.ts` (for OTP, invites, usage warnings)
- `lib/billing/*`
- `lib/tinybird/*`
- `lib/polar.ts`
- `lib/redis.ts` + `lib/rate-limit.ts`
- `lib/validation.ts`
- `lib/utils.ts`
- `lib/support.ts`

**Other:**
- `prisma/` — schema + migrations
- `middleware.ts` — guards `/dashboard` → redirects to `/login`
- Own `package.json` (full deps)
- Own `.env.example` (full env vars: DB, auth, R2, CDN, Tinybird, Resend, Polar, etc.)
- `vercel.json` — CRON schedule

**Public assets:**
- `logo.svg`, `logo.png`, `favicon.ico`

---

## Login and auth

Login lives on `console.otakit.app/login`. Better Auth session cookie is set on `console.otakit.app`. No cross-subdomain cookie needed — the landing site doesn't need to know if you're logged in.

The contact page on the landing site currently pre-fills the email if logged in. After the split, it won't — the contact form becomes fully public. This is fine.

The landing site's "Get started" / "Sign in" / "Dashboard" links point to:
- `https://console.otakit.app/login`
- `https://console.otakit.app/dashboard`

---

## Contact form

The contact form stays on `otakit.app/contact`. It has its own `POST /api/contact` route that only needs Resend. No DB, no auth.

Remove the auth-based email pre-fill from the contact page (it checked if you were logged in to show your email). The form becomes fully public — name, email, subject, message.

---

## Shared UI components

**Don't create a shared package.** Copy `components/ui/` into both apps.

Why: these are generated by shadcn/ui and rarely change. A shared package adds monorepo complexity (build ordering, version management, import aliasing) for components that are copy-paste by design. If a component changes, update it in both places. This is simpler than maintaining a third package.

Copy the full `components/ui/` into `packages/console`. Copy only the used subset into `packages/site` (button, separator, input, label, textarea, sheet, badge — roughly 10-15 components).

---

## Shared types

`dashboard-types.ts` stays in `packages/console` only. The landing site doesn't import any dashboard types.

---

## Environment variables

### `packages/site` (.env.example)

```
# Optional — contact form email
RESEND_API_KEY=
EMAIL_FROM="OtaKit <noreply@otakit.app>"
SUPPORT_EMAIL="support@otakit.app"
```

That's it. The landing site needs almost nothing.

### `packages/console` (.env.example)

Same as the current `packages/web/.env.example` — all DB, auth, R2, CDN, Tinybird, Resend, Polar, Redis vars.

Plus:
```
NEXT_PUBLIC_SITE_URL="https://otakit.app"
```

For linking back to the landing site from the dashboard (docs links, etc.).

---

## Links that need updating

### Landing site → console

All "Get started", "Sign in", "Dashboard" buttons/links change from relative paths to:
- `https://console.otakit.app/login` (or env var `NEXT_PUBLIC_CONSOLE_URL`)
- `https://console.otakit.app/dashboard`

### Console → landing site

Dashboard header "Docs" link, any help links change from relative to:
- `https://otakit.app/docs` (or env var `NEXT_PUBLIC_SITE_URL`)

### Docs self-host page

Update to mention the new two-app structure.

---

## What happens to `packages/web`

Delete it after the split is complete. It gets replaced by `packages/site` + `packages/console`.

---

## Vercel setup

Two Vercel projects in the same repo:

1. **otakit-site** — root: `packages/site`, domain: `otakit.app`
2. **otakit-console** — root: `packages/console`, domain: `console.otakit.app`

Vercel auto-detects the root directory and builds the correct app. Each project has its own env vars.

---

## Migration order

1. Create `packages/site` — copy landing pages, docs, contact, legal, minimal libs, subset of UI components
2. Create `packages/console` — copy dashboard, login, all APIs, all libs, full UI components, prisma
3. Update cross-app links (landing → console, console → landing)
4. Update the contact page to remove auth dependency
5. Update middleware in console (redirect `/` to `/dashboard` or `/login`)
6. Update `packages/console/app/layout.tsx` root layout
7. Test both apps locally: `pnpm --filter @otakit/site dev` and `pnpm --filter @otakit/console dev`
8. Update root `package.json` scripts
9. Update `pnpm-workspace.yaml`
10. Delete `packages/web`
11. Update READMEs
12. Deploy both to Vercel
13. Update DNS for `console.otakit.app`
14. Regenerate llms.txt from the site app

---

## What NOT to do

- Don't create a shared UI package — copy instead
- Don't share auth between subdomains — console owns auth, landing doesn't need it
- Don't keep `packages/web` around — clean delete after split
- Don't duplicate API routes — all APIs live in console only
- Don't duplicate Prisma — console owns the schema
