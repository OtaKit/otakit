# Implementation Plan: Auto-revert — per-release fleet health guard

Status: implemented 2026-07-02 (pending: Tinybird pipe deploy, NextMQ cron job, staging E2E).
Owner: —
Related: [06-force-immediate-update.md](./06-force-immediate-update.md)
(`autoRevert` mirrors `forceImmediate` at every touch point)

> **Positioning.** Neither Capgo nor Capawesome ships a documented fleet-level
> "N% of devices rolled back → automatically revert the release" feature.
> Capgo: device-level rollback + manual one-click revert. Capawesome: staged
> rollout percentages + CLI rollback. This is a differentiator, not parity.

> **Scope discipline.** Per-release checkbox + two per-release threshold
> fields (shown only when enabled; defaults 20% / 50), fixed 24 h window, one
> Tinybird pipe, one cron endpoint, one email. No app-level settings, no
> plugin/manifest/signature changes. The device protocol is completely
> untouched — devices already self-revert; this only stops *more* devices from
> downloading a broken bundle.

> **Source confidence.** Verified against current source: rollback/applied
> emission (`UpdaterCoordinator.swift:485-521`, `:289-319`; Android mirror
> `UpdaterCoordinator.java:569-590`), one-rollback-per-device guard
> (`UpdaterCoordinator.swift:206-209` — rolled-back release classifies
> `noUpdate` afterward), ingest schema (`device_events_raw`, client UUID
> `event_id`, `uniqExact` dedup in the daily MV), revert flow
> (`revert/route.ts:37-128`), `forceImmediate` plumbing (releases POST
> `route.ts:141-145`, CLI `upload.ts:74`, console `ProductDashboard.tsx:845`),
> cron auth (`api/cron/usage-aggregate/route.ts`), email recipients
> (`lib/billing/usage.ts:183-215`), audit log (`system` actor exists;
> action union needs one member).

## 1. Goal & rule

A releaser ticks **auto-revert** on a release (checkbox next to
force-immediate; CLI `--auto-revert`; default off). Ticking it reveals two
per-release settings — **rate %** (default 20) and **min sample** (default
50). While that release is current on its `(channel, runtimeVersion)` lane, a
cron-driven check applies, over a **fixed 24 h rolling window**:

```
attempts = applied_24h + rollbacks_24h        (unique event_ids)
revert when  attempts >= minSample  AND  rollbacks_24h / attempts >= ratePercent
```

Only the window is a code constant (`WINDOW_HOURS = 24` in
`lib/auto-revert.ts`) — not user-editable; can become a column later without
breaking anything.

**Why this formula (verified):**

- `applied` fires only on trial→success (`UpdaterCoordinator.swift:289-319`);
  a rolled-back device never emits `applied` for that release. So the
  denominator must be `applied + rollbacks` — a 100%-broken bundle has ~zero
  `applied`.
- Each device emits **at most one** rollback per failed release: the failed
  bundle is stored as `lastFailedBundle` and its manifest classifies as
  `noUpdate` afterward (`UpdaterCoordinator.swift:206-209`). 50 attempts ≈ 50
  devices; no retry-loop inflation.
- Healthy noise (killed within the 10 s `notifyAppReady` timeout, slow
  devices) is well under ~2%; broken bundles fail on 60–100% of devices. 20%
  clears noise with margin and still catches partial breakage.
- False positives revert a healthy release; false negatives only waste
  bandwidth (devices self-revert regardless). Everything errs conservative.

## 2. Design

### 2.1 Schema

```prisma
model Release {
  // ...existing...
  autoRevert           Boolean @default(false)
  autoRevertRatePercent Int    @default(20)
  autoRevertMinSample   Int    @default(50)
}
```

Three columns, one migration. The threshold columns always hold values (the
defaults) but are only *consulted* when `autoRevert` is true. Auto-reverts are
marked through the existing `revertedBy` string with sentinel
`'system:auto-revert'` (drives the cascade guard and the UI badge — no further
schema).

### 2.2 Flag plumbing (copy the `forceImmediate` pattern exactly)

- **Releases POST** (`releases/route.ts`): accept optional `autoRevert`
  (reject non-boolean, mirror lines 141-145) plus optional
  `autoRevertRatePercent` (int 1–95) and `autoRevertMinSample`
  (int 10–100000) — reject out-of-range/non-int; reject the threshold fields
  when `autoRevert` isn't true (catches typos silently arming nothing). Store
  via `createRelease` (`lib/releases.ts` input + create data); include all
  three in GET/POST payloads.
- **CLI**: `--auto-revert` flag on `upload` (mirror `upload.ts:74` incl. the
  "requires `--release`" check at `:139`) plus optional
  `--auto-revert-rate <percent>` and `--auto-revert-min-sample <count>`
  (imply/require `--auto-revert`); passthrough in `upload-workflow.ts`
  (mirror `:141,189,263,437`).
- **Console**: checkbox in the release-confirm dialog next to force-immediate
  (`ProductDashboard.tsx` release confirm state + POST body, mirror
  `:820-845`); when checked, reveal the two numeric inputs prefilled with
  20 / 50 and a helper line stating the fixed 24 h window and the rule in
  plain words.
- **Not** baked into the manifest, **not** signed — server-side only.
- Revert route: no new param (the release that becomes current keeps its own
  flag and thresholds).

### 2.2b Armed-state indicators (console)

- **Live channel pill** (`ProductDashboard.tsx:1325-1327`): when the lane's
  live release has `autoRevert`, the solid `size-1.5` emerald dot gains the
  standard Tailwind ping treatment — wrap in a `relative` span and add an
  absolutely-positioned duplicate dot with `animate-ping` — signaling "live
  and actively guarded". Pill tooltip/title gains
  `· auto-revert ≥{rate}% of ≥{minSample}`.
- **Release history dropdown rows**: armed releases get a small inline
  indicator (e.g. a `ShieldCheck` lucide icon in emerald, matching the
  `BadgeCheck` usage at `:1193`) with the same tooltip.
- **Reverted rows**: badge `auto-reverted` where `revertedAt` renders when
  `revertedBy === 'system:auto-revert'`.
- All three need `autoRevert` + thresholds on the release row type in
  `dashboard-types.ts`.

### 2.3 Tinybird: `endpoints/release_health_window.pipe`

The existing `release_event_counts` pipe reads the **daily** MV — wrong shape
for a rolling window. New endpoint pipe over the raw table (params/token style
of `app_events_recent.pipe`; filtered on the sorting key, well within the
90-day TTL):

```sql
SELECT release_id, action, uniqExact(event_id) AS events_count
FROM device_events_raw
WHERE app_id = {{ String(app_id, '__missing_app_id__') }}
  AND received_at >= parseDateTime64BestEffort({{ String(from_ts, ...) }}, 3)
  AND action IN ('applied', 'rollback')
  AND release_id != ''
  AND has(splitByChar(',', {{ String(release_ids, '') }}), release_id)
GROUP BY release_id, action
```

`uniqExact(event_id)` keeps the daily-MV retry-dedup semantics.

Lib helper `getReleaseHealthWindowCounts(appId, releaseIds, from)` in
`lib/tinybird/events.ts` → `Map<releaseId, {applied, rollbacks}> | null`.
Returns `null` on error/unconfigured (unlike the dashboard helpers' empty-map
swallow) so the cron reports the skip — either way **a Tinybird outage can
never cause a revert** (no data ⇒ no trigger).

### 2.4 Extract `revertCurrentRelease()` into `lib/releases.ts`

Move `revert/route.ts:37-128` into a shared function returning
`{ ok: true, ... } | { ok: false, reason: 'not_found' | 'already_reverted' |
'not_current' }`; the route becomes a thin wrapper mapping outcomes to today's
exact 404/409/200 responses — zero behavior change.

While extracting, fix the latent race (matters once the cron is a second
writer): replace read-then-`update` with
`updateMany({ where: { id, revertedAt: null } })` and treat `count === 0` as
`already_reverted`. Next-current resolution and `syncManifestFileForLane` are
idempotent, so overlapping writers converge harmlessly.

### 2.5 Cron endpoint: `app/api/cron/auto-revert/route.ts`

Shape cloned from `usage-aggregate` (`runtime = 'nodejs'`, GET), auth relaxed
for URL-only schedulers: `CRON_SECRET` is **optional** — unset means the
endpoint is open (the sweep is idempotent and can only revert releases whose
own thresholds trip); when set, it is accepted as a `Bearer` header **or** a
`?secret=` query param (`timingSafeEqual` either way).

**Scheduling: external.** Not added to `vercel.json` — production is triggered
by a **NextMQ cron job** pointed at the bare URL (~every 10 min; NextMQ cannot
send headers, hence the query-param/open options). Self-hosters use any
scheduler.

Per tick (logic in `lib/auto-revert.ts`, exported for testing):

1. Candidates: `db.release.findMany({ where: { autoRevert: true,
   revertedAt: null, app: { organization: { usageBlocked: false } } } })`,
   keeping only those that are **current on their lane** (same
   `promotedAt desc, id desc` per-lane check the revert route uses).
2. One `getReleaseHealthWindowCounts` call per app (all its candidate ids),
   `from = now − 24 h`. `null` ⇒ count skip, continue.
3. Apply the §1 rule using **each release's own** `autoRevertRatePercent` /
   `autoRevertMinSample`.
4. **Cascade guard** (one automatic step back per lane per window): if the
   lane's most recent reverted release has
   `revertedBy = 'system:auto-revert'` and `revertedAt` within 24 h, don't
   revert again — send the "suppressed — lane still unhealthy" email instead.
   Beyond one step, a human decides. (Cheap: one query condition; shared-cause
   failures like a broken backend must not walk the lane back release by
   release.)
5. `revertCurrentRelease({ revertedBy: 'system:auto-revert', actor:
   { actorType: 'system', actorLabel: 'auto-revert' }, auditAction:
   'release.auto_reverted', auditMetadata: { rate, attempts, rollbacks,
   ratePercent, minSample, channel, runtimeVersion, bundleVersion } })`.
   `forceImmediate` not set —
   affected devices already self-rolled-back.
6. Email org owners/admins (fire-and-forget, per-recipient catch).
7. Respond `{ evaluated, reverted, suppressed, skipped }`.

Edge case (documented, not special-cased): reverting a lane's only release
deletes the lane manifest — updated devices keep running what they have, new
installs get the builtin bundle. Desired "stop the bleeding" behavior.

### 2.6 Email: `lib/email.ts` → `sendAutoRevertEmail`

Recipient resolution copied from `sendUsageWarningEmail` (owners + admins).
One function with a `suppressed` flag. Content: app, channel (`base` for
null), runtime version, bundle version, "X of Y devices rolled back (Z%) in
the last 24 h", action taken, dashboard link.

### 2.7 Audit

`AuditAction` union += `'release.auto_reverted'`.

## 3. File-by-file change list

| File | Change |
|---|---|
| `packages/console/prisma/schema.prisma` | `Release.autoRevert` + 2 threshold cols + migration |
| `packages/console/app/api/v1/apps/[appId]/releases/route.ts` | accept/validate/return the 3 fields |
| `packages/console/lib/releases.ts` | fields in `createRelease`; `revertCurrentRelease()` extraction + `updateMany` guard |
| `packages/console/app/api/v1/apps/[appId]/releases/[releaseId]/revert/route.ts` | thin wrapper (same responses) |
| `packages/cli/src/commands/upload.ts` + `lib/upload-workflow.ts` | `--auto-revert` + `--auto-revert-rate` + `--auto-revert-min-sample` + passthrough |
| `tinybird/endpoints/release_health_window.pipe` | new pipe |
| `packages/console/lib/tinybird/events.ts` | `getReleaseHealthWindowCounts` (null on failure) |
| `packages/console/lib/auto-revert.ts` | constants + sweep logic |
| `packages/console/app/api/cron/auto-revert/route.ts` | cron endpoint (auth clone) |
| `packages/console/lib/email.ts` | `sendAutoRevertEmail` |
| `packages/console/lib/audit-log.ts` | += `'release.auto_reverted'` |
| `packages/console/app/components/ProductDashboard.tsx` | release-dialog checkbox + threshold inputs; pinging live dot; dropdown armed icon; auto-reverted badge |
| `packages/console/app/components/dashboard-types.ts` | 3 fields on the release row type |
| docs (site self-host + console README + plugin README step 7) | one section + cron note + one sentence |

Not touched: native plugin, manifest pipeline, signing, ingest Worker,
`vercel.json`.

## 4. Security notes

- Cron endpoint: optional `CRON_SECRET` (bearer or `?secret=` query param,
  `timingSafeEqual`); unset ⇒ open, acceptable because a sweep call without
  tripped thresholds is a no-op and the revert itself is idempotent.
- Device events are unauthenticated by design, so forged rollbacks are a
  downgrade lever for anyone with an `appId` + current `releaseId`.
  Mitigations: opt-in per release, 50-attempt floor, ingest rate limits, the
  one-step cascade guard, and the immediate email. Signed device events would
  be their own plan.
- No new privileged capability — only a new trigger for the existing audited
  revert.

## 5. Failure modes (all fail safe = no revert)

| Failure | Behavior |
|---|---|
| Tinybird down / unconfigured | helper returns `null`; skip counted; no trigger |
| Ingest down | attempts < 50; no trigger |
| NextMQ cron not firing | feature inert; manual revert unaffected |
| Overlapping ticks / human races cron | `updateMany` guard ⇒ second writer no-ops |
| Every bundle broken (shared cause) | one step back, then suppressed emails |
| Email provider down | revert still lands; audit log is the record |

## 6. Verification

1. **Refactor regression**: manual revert from the console before/after §2.4 —
   identical responses (404 / both 409s / success shape).
2. **Rule check**: drive the evaluator with fabricated counts (0 attempts,
   49/50 and 19%/20% boundaries, 100% broken with 0 applied).
3. **End-to-end (staging)**: release a bundle that never calls
   `notifyAppReady` with `--auto-revert` on a `staging` channel; push ≥50
   simulated events (distinct `event_id`s) through the ingest Worker; curl the
   cron endpoint → release reverted, manifest re-baked, audit row
   `release.auto_reverted`, email received; curl again → `reverted: 0`; break
   the fallback too → suppressed email, no second revert.
4. **Fail-safe**: unset Tinybird env → skip counted, no revert.

## 7. Phasing

1. **P1** — `revertCurrentRelease()` extraction + atomicity guard (pure
   refactor, ships alone).
2. **P2** — migration, flag + threshold plumbing (API/CLI/console checkbox
   with revealed inputs), Tinybird pipe + helper.
3. **P3** — sweep + cron endpoint + email + armed indicators (pinging live
   dot, dropdown icon, auto-reverted badge); wire the NextMQ cron job.
4. **P4** — docs; dogfood on our own 50 MB-asset app (flag on every release),
   watch real baseline rates, then consider defaulting the console checkbox
   to on.

## 8. Future (out of scope)

- Editable window / app-level default thresholds — only if a customer asks.
- NextMQ **event-driven** checks (delayed jobs at +15 m/+1 h/+6 h/+24 h per
  release instead of a sweep) — the evaluator is per-release, so the swap is
  mechanical.
- Staged rollout percentages (bounds blast radius; auto-revert ends it) —
  separate plan; needs deterministic device bucketing on the static-CDN model.
- Signed device events to close the §4 forgery vector.
