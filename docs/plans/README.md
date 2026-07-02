# Implementation Plans — Capgo parity features

Detailed, implementation-ready plans chosen from the
[Capgo improvement analysis](../../CAPGO_IMPROVEMENT_PLAN.md). Each was written
after reading both the Capgo source (`../capgo`) and OtaKit's own CLI / console /
plugin internals, and includes a file-by-file change list, security checklist,
backward-compat notes, tests, and phasing.

**Verified 2026-07-01:** every factual claim in these plans (routes, schema,
native flow, line refs) was re-checked against the current source. Corrections
made: 07's startup-rollback emission point, 03's nonexistent bundle-detail GET,
02's plaintext-vs-ciphertext hashing, 05's trial-timer interaction, and the old
06 was replaced by the minimal `forceImmediateUpdate` flag.

All stay on OtaKit's static-CDN model — none require a dynamic per-device update
endpoint.

| # | Plan | Size | Touches | Status |
|---|------|------|---------|--------|
| 07 | [Update event listeners](./07-update-event-listeners.md) | medium | native plugin, TS, docs | **v1 — 1st (table-stakes DX)** |
| 04 | [`setChannel()` SDK method](./04-set-channel-sdk.md) | small | native plugin, TS | **v1 — 2nd (quick win)** |
| 03 | [CLI compatibility guardrail](./03-cli-compatibility-guardrail.md) | small | CLI (+1 read API, 1 col) | **v1 — 3rd (trust/safety)** |
| 06 | [`forceImmediateUpdate` emergency flag](./06-force-immediate-update.md) | small–medium | DB, API, CLI, console, native | **v1 — early (signature change: do before real users)** |
| 02 | [Bundle encryption (zip)](./02-bundle-encryption.md) | medium | CLI, API, DB, native | **v1 (with 06's signature change)** |
| 05 | [Immediate-update splash](./05-immediate-update-splash.md) | small | native plugin | **v1 — opt-in, filler** |
| 01 | [Update strategy: zip + opt-in deltas](./01-partial-delta-updates.md) | large | CLI, API, native | **first big rock after the small wins** |

Notes:
- **Listeners (07)** are the #1 eval-time gap — the docs currently say "there is
  no listener API." Every emission point co-locates with existing telemetry;
  iOS download progress plumbing already exists (`Downloader.swift`).
- **06 shrank**: the full "server-controlled update strategy" rework is replaced
  by one signed per-release boolean covering the actual emergency use case
  ("we shipped a bad release"). It changes the signed manifest payload, which is
  a clean break only while there are no real users — ship it early, and bundle
  the canonical-payload change with **02**'s (one break, not two).
- **Deltas (01)** ship as an **opt-in** (`updateStrategy: 'zip' | 'deltas'`,
  default `zip`). Apps that don't opt in are unaffected — risk is contained.
  Promoted because it's the demo-able differentiator for asset-heavy apps
  (50 MB app → KB-sized updates) and validated by our own app's pain.
- **Splash (05)** turned out small once verified against `@capacitor/splash-screen`
  source: reuse that package with `launchAutoHide:false` and **defer only the
  JS resolve of `notifyAppReady()`** during a cold-start immediate update
  (native side effects run immediately, so trial/rollback is untouched).
  Cold-start only (resume is `shadow` by default).

Suggested order: **07 → 04 → 03 → 06 (+02's payload change together) → 02 → 01
(deltas)**, with **05** slotted in anywhere as filler.
