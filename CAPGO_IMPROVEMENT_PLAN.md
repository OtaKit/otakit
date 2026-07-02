# Capgo → OtaKit Improvement Plan

Research notes and a prioritized plan from a deep read of Capgo (`../capgo`), our
biggest open-source competitor. Goal: steal the ideas that matter, skip the ones
that don't, and be honest about where OtaKit's design is already better.

Sources read in Capgo:
- `supabase/functions/_backend/utils/update.ts` — the device update decision engine
- `supabase/functions/_backend/plugins/{updates,stats,channel_self}.ts`
- `supabase/schemas/prod.sql` — `channels`, `stats_action` enum, devices
- `cli/src/index.ts` + `cli/src/bundle/{partial,encrypt,compatibility}.ts`
- `README.md`, `PRODUCT.md`, `RBAC_SYSTEM.md`

---

## Decision — what we're building now

Three features, in priority order:

1. **Partial / delta updates**
2. **End-to-end bundle encryption**
3. **CLI compatibility guardrail**

The important property: **all three work on top of OtaKit's existing static-CDN
manifest model. None of them require a dynamic per-device endpoint.** We keep our
cost/simplicity moat and still ship the features that hit bandwidth, security,
and reliability.

Explicitly deferred (see "Later" at the bottom): expanded crash/error telemetry
(agreed — mostly noise for now, additive later) and per-device targeting (it's "a
custom channel + a way to route a live device to it without a rebuild" — that
routing is the part that needs the dynamic endpoint, so it waits).

### Architecture note (why the static model is fine here)

Capgo serves updates from a dynamic, per-device endpoint; OtaKit serves a static
signed manifest from the CDN per `(app, channel, runtimeVersion)` lane
(`lib/manifest-files.ts` → `syncManifestFileForLane`). That static model is a
strength — cheap, CDN-cacheable, no per-request DB cost, trivially self-hostable.
Capgo built an entire second backend (Cloudflare Workers) *because* their dynamic
endpoint was too expensive at scale (README: ~50M devices, "Supabase Edge
Functions are cost-prohibitive"). The three chosen features deliberately stay on
the static path:

- **Partial updates** = a richer manifest (`files[]`) + content-addressed file
  storage. Still a static, cacheable manifest.
- **Encryption** = `keyId` baked into the manifest; the plugin checks its local
  key match itself. (Capgo enforces `key_id_mismatch` server-side in `update.ts`
  only because it already has a dynamic endpoint — we don't need to.)
- **Compatibility guardrail** = CLI-only, no backend or plugin change at all.

---

## 1. Partial / delta updates (only download changed files)

**What Capgo does.** Instead of one bundle zip, Capgo uploads each file
individually, content-addressed by checksum, Brotli-compressed per file, dedup'd
against storage (`cli/src/bundle/partial.ts`: `fileExists()` does a
`range: bytes=0-0` HEAD before uploading). The update response carries a
`manifest: ManifestEntry[]` (per-file `{file_name, file_hash, download_url}`,
see `resToVersion` / `getManifestUrl` in `update.ts`). The device compares the
manifest to what it already has and downloads only the diff. Uploads use TUS
resumable uploads. Files below 8 KB skip Brotli (RFC `BROTLI_MIN_SIZE`).

**Why it matters.** This is Capgo's headline feature ("🔁 Delta Updates"). For a
typical JS bundle change, a user re-downloads a few hundred KB instead of the
whole 5–20 MB app. Massive bandwidth + speed win, and bandwidth is the metered
cost driver. This is probably the single most valuable feature to copy.

### How delta actually works — two designs, and which we pick

There are two distinct things people call "delta updates." Picking the right one
is the most important decision in this whole feature, so it's recorded here before
any native work starts.

**Model B — version-pair patches (the intuitive one).** Precompute a binary diff
per recent version pair (`v3→v8.patch`, `v4→v8.patch`, …). The device sends its
current version, gets the matching patch (one file), applies it to reconstruct the
full bundle, or downloads the whole bundle if no patch matches.
- ✅ One request per update; smallest possible bytes (bsdiff can be sub-file —
  change one line, ship a few KB).
- ❌ Must precompute + store a *window* of patches every release ("last 5
  versions"); a device older than the window falls back to full download.
- ❌ Needs server-side compute on every release to generate patches.
- ❌ Patches are version-pair-specific → poor CDN cache sharing; applying needs
  the old bundle intact on device.

**Model A — per-file content-addressed manifest (what Capgo does, what we pick).**
The bundle is *not* one zip. Every file is stored individually, named by its
content hash (`files/<sha256>`). A version's manifest is just the list of files it
contains (`{path, sha256, size, url}`). The device downloads only the files whose
hash it doesn't already have, then assembles the bundle locally.

Walkthrough — build is `index.html`(a1) `main.abc.js`(b2) `vendor.def.js`(c3)
`logo.png`(d4). Ship v9 where only `main.js` changed:
1. CLI hashes every file, asks storage which hashes already exist → `vendor`,
   `logo`, `index` are already there from v8 → uploads only the new `main` object.
2. Writes the v9 manifest: 4 entries, 3 pointing at existing objects, 1 new.
3. A device on v8 fetches the v9 manifest, diffs hashes against what it has, sees
   only `main` differs, downloads that one file, assembles v9 from 3 cached files
   + 1 new one.

That "set of changed files, each its own object" is the **"N files"** in the cost
model (N ≈ 1–3 for a typical JS change — your hashed chunks).

**Why Model A wins for OtaKit:**

| | Model A (per-file) | Model B (version patches) |
|---|---|---|
| Server compute per release | none — just upload new files | generate patches every release |
| Version window to manage | **none — works for any age** | pick & store last N; older = full DL |
| CDN caching | excellent — each file is an immutable, content-addressed object shared across every version/app | poor — each patch is a unique pair |
| Storage | natural dedup (unchanged file stored once) | O(window) patches |
| Requests per update | N (small, mostly cache hits) | 1 |
| Smallest bytes | whole changed *file* | sub-file (bsdiff) |

Model B wins only on request count and raw bytes. Model A needs **zero server
compute, no version window, and every file is an immutable CDN object that caches
forever** — which is exactly the static-CDN philosophy. Its one downside ("N
requests") is pennies and mostly absorbed by the CDN cache (see pricing section).

Important consequence: with Model A there is **no "last 5 versions" to manage.** A
device on a 2-year-old build resolves correctly with no special handling — it just
fetches whatever it's missing. The "download the whole zip" fallback exists only
for *old SDK versions* that don't understand the file manifest, not as a
per-version-window gap.

**How to add to OtaKit (Model A).**
- CLI: on upload, walk `webDir`, hash each file, upload only files whose hash
  isn't already in storage (content-addressed key `files/<sha256>`), and write a
  per-bundle file manifest. Keep producing the whole-zip too as the legacy
  fallback.
- Manifest schema: extend the static `manifest.json` written by
  `writeManifestFile` to optionally include a `files[]` array
  (`{path, sha256, size, url}`). Keep the single-zip `url` as the fallback for
  older plugins — gate the `files[]` field on plugin version like Capgo does.
- We already have `Bundle.metadata Json?` and a content hash per bundle — store
  the file list as an object next to the bundle (cheaper + CDN-cacheable) rather
  than bloating the DB.
- Plugin (iOS/Android): add a manifest-aware download path that diffs against the
  current bundle's file hashes, fetches only missing files, and reassembles on
  device. This is the bulk of the work and lives in native code.
- **Serve files behind the CDN cache** (content-addressed keys are immutable →
  cache forever) so repeat file fetches across devices cost ~nothing.
- Compression: support Brotli (`.br`) per file; independent of delta and worth
  doing on the whole-zip path too. Skip files < ~8 KB (Capgo's `BROTLI_MIN_SIZE`).

Possible future refinement: if a few large files dominate transfer, layer
sub-file bsdiff *within* Model A for those specific files only — keeping the
content-addressed manifest as the backbone. Not needed for v1.

**Effort:** large (native plugin work). **Payoff:** very high.

## 2. End-to-end bundle encryption

**What Capgo does.** RSA+AES hybrid: CLI `key create` generates a keypair, the
bundle is encrypted with a per-bundle AES key, that key is RSA-wrapped into the
`session_key` returned in the update response, and the device decrypts with its
private key. The backend enforces a `key_id` match between device and bundle
(`update.ts`: `key_id_mismatch` path) so a device with the wrong key never even
downloads. CLI has `encrypt`/`decrypt`/`key save`/`key create`/`key delete_old`.

**Why it matters.** "🔒 Encrypt and sign each update" is a headline feature and a
hard requirement for some enterprise/regulated buyers — the bundle is unreadable
at rest in storage and in transit even if a CDN URL leaks. OtaKit currently
*signs* the manifest (good — integrity/authenticity) but does **not encrypt the
bundle** (confidentiality). Different guarantee.

**How to add to OtaKit.**
- CLI: `otakit generate-signing-key` already exists for manifest signing; add an
  encryption keypair flow and an `--encrypt` upload mode.
- Store `keyId` on `Bundle`; include it in the manifest; plugin verifies its
  local `keyId` matches before downloading.
- Plugin: decrypt on device after hash-verify.

**Effort:** medium. **Payoff:** medium–high (enterprise gate, marketing parity).

## 3. CLI compatibility guardrail / fail-on-incompatible-upload

**What Capgo does.** `cli bundle compatibility` and `releaseType` compare a
bundle's native dependencies against what a channel's current bundle was built
with, and can **fail the upload** if a bundle that needs a new native build is
about to be shipped as an OTA update (`docs/.../fail-on-incompatible-upload`).
`releaseType` prints "native" vs "OTA" so CI can branch.

**Why it matters.** The #1 way OTA updates brick apps is shipping JS that calls a
native API the installed shell doesn't have. OtaKit's `runtimeVersion` lanes
*prevent* serving across boundaries, but nothing *warns the developer at upload
time* that they just created a new boundary. This is the guardrail that prevents
the incident in the first place.

**How to add to OtaKit.** CLI-only, no backend/plugin change needed.
- On upload, diff the project's Capacitor/native plugin set + versions against
  the last bundle on the target channel/runtime (store this in `Bundle.metadata`).
- Warn (or `--fail-on-incompatible`) when native deps changed, prompting a new
  `runtimeVersion` / store build instead of an OTA release.

**Effort:** small. **Payoff:** high (prevents the scariest failure mode).

## 4. `setChannel()` SDK method (dynamic channel switching, client-side)

**What it is.** Expose `OtaKit.setChannel("beta")` / `getChannel()` in the plugin
so an app can switch its release channel *at runtime* — e.g. a "Join beta" toggle
in settings — without a rebuild. Today the channel is fixed in
`plugins.OtaKit.channel` (static config).

**Why this fits the static model (no backend needed).** Channels in OtaKit are
already just different manifest paths on the CDN:
`buildManifestStorageKey(appId, channel, runtimeVersion)` →
`manifests/<appId>/<channel>/<runtime>/manifest.json`. So switching channel is
purely a client concern: persist the chosen channel locally and have the plugin
fetch a different (already-published, already-cached) manifest URL on the next
check. **Zero server work, zero per-device cost** — it stays on the static fast
path. This is the cheap 80% of Capgo's `channel_self` without their dynamic
endpoint.

**How to add to OtaKit.**
- `definitions.ts`: add `setChannel(name: string | null)` and `getChannel()`.
- Native (iOS/Android): persist the override channel in local storage; the
  existing manifest-fetch path reads it (override → config → unnamed) when
  building the manifest URL. `null` clears back to the configured channel.
- The CDN manifest for that channel must exist (it's published on release like
  any other lane) — no new infra.

**Limitations (and where the deferred dynamic endpoint would extend it).** Channel
names become guessable public CDN paths, so this can't enforce *private* channels
or do server-controlled QA pinning of a specific device — that's the deferred
"per-device targeting" work. For the common "let users opt into beta/staging"
case, the SDK method alone is enough.

**Effort:** small (mostly native plumbing). **Payoff:** medium-high (unlocks
beta opt-in, the most-requested slice of targeting, for almost nothing).

---

## Later (deferred)

### Per-device targeting ("set channel to one device") — deferred

A *custom channel* is the destination (a private channel with its own bundle —
OtaKit can already do that). **Targeting** is the missing half: routing a *live*
device to that channel without rebuilding the app. Capgo pins a device via a
`channel_devices` override resolved in `update.ts`, and `channel_self`
(`plugins/channel_self.ts`) lets the device opt in at runtime (a "join beta"
button) when `allow_device_self_set` is on. Both need the dynamic per-device
endpoint, which is why this waits. When we do it: `DeviceChannelOverride` table +
plugin `setChannel()` + a thin `/api/v1/check` that returns the override's lane.

### Expanded crash/error telemetry — deferred

Capgo's `stats_action` enum has ~80 event types (`app_crash`, `app_anr`,
`webview_javascript_error`, download-progress buckets, etc.). Useful eventually
for per-release health + smarter auto-rollback, but agreed it's mostly noise
right now. It's purely additive to the existing ingest pipeline
(`packages/ingest/src/index.ts` currently accepts 4 actions), so we can bolt it
on whenever without rework.

### Other Capgo features worth a later look

**Update-direction & build-type gating** (needs the dynamic endpoint)

Capgo channels carry a pile of safety toggles (`channels` table): `ios`,
`android`, `electron`, `allow_dev`, `allow_prod`, `allow_emulator`,
`allow_device`, `disable_auto_update` (`major|minor|patch|version_number|none`),
`disable_auto_update_under_native`, `min_update_version`. The update engine
enforces all of them per request (`update.ts` lines ~390–510).

Most valuable subset to copy once the dynamic endpoint exists:
- **`disable_auto_update_under_native`** — never serve a bundle older than the
  installed native build (anti-downgrade). OtaKit's lanes don't fully cover this
  within a lane.
- **prod/dev + device/emulator gating** — don't ship prod bundles to dev builds
  or emulators. Prevents noise and accidental leaks.
- **major/minor/patch ceiling** — let a channel refuse to auto-jump majors.

Note: OtaKit's `runtimeVersion` lane is arguably a *cleaner* native-compat model
than Capgo's `min_update_version` + `disable_auto_update_under_native` combo.
Don't throw the lane model away — layer these as optional per-channel guards.

**Gradual / percentage rollout** (needs the dynamic endpoint)

Staged rollout is table-stakes for a live-update product. With the dynamic
endpoint + `deviceId`, it's a few lines: hash `deviceId` into `[0,100)` and serve
the new release only if under the channel's `rolloutPercent`. Deterministic per
device (no flapping), no extra state. Pairs perfectly with crash-rate telemetry
for "auto-promote if healthy at 10%."

**QR preview** — Capgo CLI `get-qr` + `upload --preview-qr` prints a terminal QR
that opens the bundle in their sandbox app for instant on-device preview. Nice
DX; needs a preview/sandbox surface to point at.

**CLI `doctor`** — checks plugin/CLI versions and gathers an environment report
for bug reports. Cheap, reduces support load. Could fold onto our existing
`config validate/resolve`.

**MCP server in the CLI** (`cli/src/mcp/`) — lets AI agents drive uploads/
releases. Low-cost, forward-looking differentiator given our agent-heavy audience.

---

## Probably skip (scope/complexity vs payoff)

- **Native cloud builds.** Capgo's CLI has a huge `build` surface (request iOS/
  Android store builds in their cloud, manage certs/keystores/Play OAuth,
  `prescan`, `apple-key` helper). This is a whole second product (an Appflow/EAS
  competitor). High value but enormous scope — out of band for an OTA tool.
- **Full RBAC system.** `RBAC_SYSTEM.md` is 65 KB: channel-scoped roles, groups,
  permission overrides, per-API-key scopes. OtaKit's `owner/admin/member` is fine
  for now; revisit only when enterprise deals demand channel-level permissions.
- **Provider-infra IP blocking / update-enumeration guard.** Capgo blocks
  Apple/Google review-bot IPs and rate-limits bundle enumeration
  (`updateOracleGuard.ts`, `invalids_ip.ts`) — anti-MAU-inflation and
  anti-scraping. Only relevant once we bill on MAU *and* run a dynamic endpoint.
  Keep in back pocket.
- **Dual Supabase + Cloudflare backend.** Their cost workaround for the dynamic
  endpoint at 50M devices. Our static-CDN model sidesteps this entirely — a point
  *in our favor*, don't copy it.

---

## Pricing — yes, we can undercut hard (and why)

Short answer: **yes, way more, and it's not close.** The CDN-static model means
our cost-to-serve per active device is roughly *zero*, while it's Capgo's single
biggest cost. That's a structural margin advantage, not a temporary one.

### The cost asymmetry

- **Capgo bills on MAU + bandwidth + storage** (`utils/plans.ts`, `seed.sql`)
  *because every active device hits a dynamic endpoint* (Cloudflare Worker +
  Postgres read replica) on every check, several times a day, whether or not an
  update ships. MAU ≈ their actual compute/DB cost driver. That's why they had to
  build a whole second backend to survive at scale.
- **OtaKit's update check is a static `manifest.json` on the CDN**
  (`s-maxage=300`) backed by **Cloudflare R2 (zero egress fees)**. A device that
  checks 100×/day but is already up-to-date costs us ~$0 — it's a CDN cache hit.
  We only incur cost on an *actual bundle download* (an R2 read with no egress
  charge) + storage. And **delta updates (priority #1) shrink even that** to the
  changed files.

So our marginal cost per MAU ≈ a rounding error; our only real COGS are object
storage (R2: ~$0.015/GB-mo), the Postgres behind the console (hit on uploads/
dashboard, not per-device), and Tinybird for analytics.

### Capgo's published pricing (from `seed.sql`)

| Plan  | $/mo | $/yr | MAU     | Storage | Bandwidth |
|-------|------|------|---------|---------|-----------|
| Solo  | $14  | $146 | 2,000   | 1 GiB   | ~13 GB    |
| Maker | $39  | $396 | 10,000  | 3 GiB   | 250 GB    |
| Team  | $99  | $998 | 100,000 | 6 GiB   | 500 GB    |

Overage: MAU $0.003→$0.0007/user (tiered), bandwidth **$0.06/GB**, storage
**$0.09/GB**.

### OtaKit today (limits in `lib/billing/config.ts`)

We bill on **downloads**, not MAU: starter 1k / pro 100k / scale 1M downloads per
month (the $ live in Polar env vars, not the repo). A "download" is an actual
bundle pull, counted from the `downloaded` ingest event.

### Two ways to play it

1. **Keep the download metric, lean into "we don't charge for users."**
   Marketing wedge: *"Capgo bills you for every active user. OtaKit bills only for
   updates you actually ship."* A stable app with a big user base and infrequent
   releases pays us little. This is honest (it's our real cost axis) and a clean
   differentiator.
   - Caveat: download-based billing risks **bill shock** on a huge release (1M
     users × weekly = 4M+ downloads). Mitigate with generous included quantities
     (cheap for us) and/or a soft cap. Also, buyers compare on MAU, so *show an
     MAU-equivalent* next to our number for apples-to-apples.

2. **Match Capgo on MAU but at a fraction of the price.** Because MAU is nearly
   free for us, we can offer e.g. **100k MAU for ~$29** vs their $99 — 3× cheaper,
   still high margin — and make MAU the comparison axis they already anchored.

Either way the move is the same: **price 3–5× under Capgo and make the free tier
a weapon.** A free tier that covers most indie devs entirely (e.g. ~10k
downloads/mo) would be unprofitable for Capgo to match because their free users
still cost them dynamic-endpoint compute — ours cost ~nothing. Combined with
MIT/open-source + self-host, that's a strong top-of-funnel.

My recommendation: **option 1** (own the "no MAU tax" story, it's defensible and
unique), with an MAU-equivalent shown for comparison, aggressive free tier, and
delta updates shipped first so bandwidth — the one cost that does scale — stays
negligible.

### Proposed tiers (and are we profitable?)

| Tier       | Price          | Downloads / mo            |
|------------|----------------|---------------------------|
| Free       | $0             | up to 10,000              |
| Pro        | $20/mo         | up to 1,000,000           |
| Scale      | +$20 per extra | each additional 1,000,000 |
| Enterprise | custom         | volume + SLA + SSO        |

**Yes, this is comfortably profitable.** Modeled COGS per 1M downloads on
Cloudflare R2 (zero egress is what makes this work):

| Cost component (per 1M downloads) | Whole-zip | Delta (~15 files/dl) |
|-----------------------------------|-----------|----------------------|
| R2 GETs (bundles)                 | $0.36     | $5.40                |
| R2 GETs (manifest, 5% cache miss) | $0.18     | $0.18                |
| R2 storage (~5 GB)                | $0.08     | $0.08                |
| **Egress (R2 = free)**            | **$0.00** | **$0.00**            |
| Ingest Workers + Queues           | $2.20     | $2.20                |
| Tinybird                          | $0.03     | $0.03                |
| **Total COGS**                    | **~$2.84**| **~$7.88**           |
| **Gross margin at $20**           | **86%**   | **61%**              |

Why it holds: the only cost that scales with volume — **bandwidth/egress — is
$0 on R2**, the thing that would be ~$450 (5 TB @ S3 $0.09/GB) on AWS. What's
left (R2 ops, ingest, storage) is cents. Delta updates *raise* op count slightly
(more small GETs) but still land at 61% margin; if that ever matters we serve
delta files behind the CDN cache so repeat files cost nothing.

The free tier is trivially cheap: **~$0.06 per free org per month** at the full
10k downloads. We could carry tens of thousands of free users for the price of a
coffee — and Capgo *can't* match that free tier because their free users still
burn dynamic-endpoint compute.

Caveats / what to watch:
- **Fixed overhead, not unit cost, is the real floor**: console Postgres (~$25),
  Workers paid plan ($5), Tinybird base. Amortized across paying orgs — need a
  handful of Pro customers to clear it, then it's mostly margin.
- **Keep bundle serving on R2/CDN, never proxy bytes through a Worker** (that
  would add per-request + CPU cost per download). Static asset path only.
- At the extreme high end (e.g. 1M-user app shipping weekly ≈ 4M downloads/mo =
  ~$80 on this scheme vs thousands on Capgo), still ~60–85% margin — but that's
  exactly where "Enterprise custom" lets us add an SLA and capture more.

---

## Where OtaKit is already better — protect these

- **Static CDN manifest** = near-zero per-update cost, trivial caching, dead-simple
  self-hosting. This is our moat against Capgo's expensive dynamic endpoint. Any
  dynamic features should be *opt-in fallbacks*, never the default path.
- **`runtimeVersion` lanes** are a cleaner native-compatibility model than Capgo's
  per-version gating soup.
- **Small, legible plugin surface** (3 lifecycle events, one policy enum). Capgo's
  plugin/backend carries years of version-compat cruft (v4 rejections, four
  different "min Brotli version" constants, deprecated-version notification spam).
  Keep ours lean.
- **Modern stack** (Next.js + Prisma + Better Auth + Polar) vs their Vue +
  Supabase + Stripe + Deno/Cloudflare split. Easier to move fast.

---

## Detailed implementation plans

Each of the four chosen features has a deep, implementation-ready plan in
[`docs/plans/`](./docs/plans/README.md) (file-by-file changes, security
checklist, tests, phasing), written after reading both the Capgo source and
OtaKit's CLI/console/plugin internals:

- [01 — Partial / delta updates](./docs/plans/01-partial-delta-updates.md)
- [02 — Bundle encryption](./docs/plans/02-bundle-encryption.md)
- [03 — CLI compatibility guardrail](./docs/plans/03-cli-compatibility-guardrail.md)
- [04 — `setChannel()` SDK method](./docs/plans/04-set-channel-sdk.md)

## Suggested sequence

1. **CLI compatibility guardrail (#3)** — small, CLI-only, prevents the worst
   incidents. Ship first.
2. **Partial / delta updates (#1)** — the headline bandwidth/speed feature and the
   biggest native investment; start the plugin work early.
3. **Encryption (#2)** — can run as a parallel track alongside the delta work
   (both touch the CLI upload path and the manifest).
4. **`setChannel()` SDK method (#4)** — small native add, no backend; can ship
   anytime (good quick win to interleave with the heavier native delta work).

All four stay on the static-CDN model. The dynamic endpoint, targeting,
rollout, gating, and telemetry come later only if/when we decide to.
