# Task: Review 7 feature PRs in OtaKit

Repo: `https://github.com/OtaKit/otakit` (local checkout: `/Users/gergomiklos/otakit`, pnpm monorepo: `packages/console` Next.js + Prisma, `packages/cli`, `packages/capacitor-plugin` with iOS Swift + Android Java, `packages/site` docs).

Seven PRs implement the feature plans in `docs/plans/` (read the matching plan file before reviewing each PR — it is the spec, including a "Verified integration constraints" section per plan). Review each PR for correctness bugs, spec deviations, security issues, and cross-platform (iOS/Android/TS) inconsistencies. Do NOT restyle or nitpick formatting; prettier already ran.

## PR list (review in this order)

### 1. PR #5 — `feat/manifest-payload-v2` → `main` (FOUNDATION — review first)
Spec: one-time extension of the ES256-signed manifest canonical payload with `strategy` (default `zip`), `forceImmediate` (default `false`), `encryption` (default `null`; pipe-joined 5-field block when present), inserted between `runtimeVersion` and `kid`.
Files: `console/lib/manifest-signing.ts`, `console/lib/manifest-files.ts`, iOS `ManifestClient.swift` + `ManifestVerifier.swift`, Android `ManifestClient.java` + `ManifestVerifier.java`.
CRITICAL CHECK: all three canonical-payload builders (TS signer, Swift verifier, Java verifier) must produce **byte-identical** strings for: defaults, non-null channel/runtimeVersion, encryption block present, forceImmediate true. Write a quick script/vector comparison if needed. Also check the native parsers' defaults (absent field → `zip`/`false`/`nil`) match what the server always emits.

### 2. PR #7 — `feat/07-update-event-listeners` → `main`
Spec: `docs/plans/07-update-event-listeners.md`. Five events (`updateAvailable`, `updateStaged`, `updateApplied`, `downloadFailed`, `rollback`) emitted next to existing `sendDeviceEvent` telemetry in `UpdaterPlugin.swift`/`.java`; typed `addListener`/`removeAllListeners` forwarded in `src/index.ts` (the wrapper is a plain object, not the registerPlugin proxy); new `/docs/events` site page + llms.txt regen.
Checks: no emission in `load()` (startup rollback must NOT emit — spec says `getLastFailure()` reconciliation instead); `updateApplied` only on genuine trial→success (gated on `prepareNotifyAppReady` returning a payload); iOS/Android payload field parity; failure `reason` strings identical across platforms.

### 3. PR #6 — `feat/04-set-channel` → `main`
Spec: `docs/plans/04-set-channel-sdk.md`. `setChannel`/`getChannel` methods; override persisted in BundleStore (iOS UserDefaults / Android SharedPreferences); resolution order: explicit arg → persisted override → config channel.
CRITICAL CHECK (security): the channel is interpolated into the CDN manifest path; native validation must reject anything failing `^[A-Za-z0-9._-]{1,64}$`, plus `..`, `/`, `\`, control chars, and reserved names `base`/`default` (case-insensitive), BEFORE persisting. Verify both platforms enforce identically and that rejection doesn't leave a partial state.

### 4. PR #8 — `feat/03-compat-guardrail` → `main`
Spec: `docs/plans/03-cli-compatibility-guardrail.md`. CLI detects native deps (file regex `\.(java|swift|kt|scala)$`), computes per-platform checksums, sends `nativePackages` at initiate; console stores it (new `Bundle.nativePackages` + `UploadSession.nativePackages` columns, hand-written migration `20260701120000_bundle_native_packages`), NEW `GET bundles/[bundleId]` handler; CLI compares against the channel's current release (newest `revertedAt: null`, lane-matched on `runtimeVersion`) with rules: missing remote → incompatible (new plugin), version ranges don't intersect → incompatible, checksum changed → incompatible, range-string-only change → informational, no baseline → skipped.
Checks: the new GET handler enforces the same org-access as DELETE; validation caps (≤200 entries / 32KB) can't be bypassed; lane matching is correct; `--fail-on-incompatible` exit codes; checksum determinism (sorted files, path included in hash).

### 5. PR #9 — `feat/06-force-immediate` → `feat/manifest-payload-v2` (stacked on #5)
Spec: `docs/plans/06-force-immediate-update.md`. `Release.forceImmediate` column (+ migration `20260701120000_release_force_immediate`), release/revert APIs accept the boolean (revert applies it to the release that BECOMES current, before manifest re-sync), manifest bakes + signs it, console checkbox/badge, CLI `--force-immediate`, native escalation: in shadow/apply-staged branches of handleLaunch/handleResume/handleRuntime, a staged result whose manifest had `forceImmediate` triggers `requireApplyStaged(reload: true)`.
Checks: `off` policy and the manual JS API must be completely unaffected; `checkInterval` throttle NOT bypassed; no reload loop (after apply, classification must return noUpdate); flag threaded through `DownloadResolution` identically on both platforms; revert route updates the right release.

### 6. PR #10 — `feat/02-bundle-encryption` → `feat/manifest-payload-v2` (stacked on #5)
Spec: `docs/plans/02-bundle-encryption.md`. AES-256-GCM envelope: per-bundle random DEK encrypts the zip, DEK wrapped under a per-app KEK (`bundleKeys` in capacitor config; `otakit generate-encryption-key`); manifest `sha256`/`size` = CIPHERTEXT (so existing finalize size-check and native pre-extract hash-check are unchanged); decrypt slots between hash-verify and extract; encryption params live in the signed payload (via #5).
Checks (crypto review — be rigorous): nonce generation (CSPRNG, never reused), GCM tag verified before plaintext use on BOTH platforms (Android must use explicit `doFinal`, not CipherOutputStream), KEK never logged/committed, kid matching failure produces a clean error (bundle never staged), decrypt failure cannot leave partial state, test vectors in the PR body actually round-trip (run them with node against `cli/src/lib/crypto.ts` logic). Verify the "no matching key" path surfaces via `getLastFailure`.

### 7. PR #11 (DRAFT) — `feat/01-delta-updates` → `feat/manifest-payload-v2` (stacked on #5)
Spec: `docs/plans/01-partial-delta-updates.md`. Opt-in `updateStrategy: 'deltas'`: CLI walks webDir and uploads per-file content-addressed objects (`files/<appId>/<sha256>`) via new `initiate-delta`/`finalize-delta` routes (presign misses only); Bundle stores `sha256 = filesHash`, `storageKey` = file-list object; manifest emits `files[]` + `filesHash` (no top-level `url`); native `DeltaAssembler.swift`/`.java` fills a content cache, verifies per-file hashes, assembles, and hands off to the existing stage/apply path; builtin seeding; prune-to-referenced eviction.
Checks (largest risk surface — deepest review): filesHash canonicalization identical in TS/Swift/Java (UTF-8-byte-sorted `path:sha256` lines — verify byte-for-byte, especially sorting of unicode/case); path traversal guards on `files[].path` (absolute, `..`, backslash) on BOTH platforms; per-file size/count caps enforced server AND client side; cache eviction cannot delete files referenced by current/fallback/staged; zip path completely unchanged when strategy is default; presigned PUT headers match what the CLI sends; HEAD-based dedup can't be poisoned across apps (objects must be namespaced per appId and hash verified server-side or at finalize).

## Known accepted gaps (do not re-flag, but verify they're stated in the PRs)
- Prisma migrations are hand-written SQL, not run against a DB (`pnpm db:migrate` needed before merge).
- Native code is parse/build-checked but not device-tested; no Android gradle compile was run (no SDK on the dev machine).
- Repo has no test suites; verification was typecheck/lint/build + targeted scripts.

## Merge order (for context on conflicts)
#7 → #6 → #8 → #5 → #9 → #10 → #11. PRs #6/#7 both touch `UpdaterPlugin.swift`/`.java`/`definitions.ts`/`index.ts` — whichever merges second needs a rebase; that's expected, not a defect. Stacked PRs (#9/#10/#11) also mutually touch native manifest plumbing and will need sequential rebases.

## Findings from a prior fast pass (verify these, then go deeper)

1. **HIGH (merge-time, not in any single PR): `writeManifestFile` semantic collision across stacked PRs.** #06 hardcodes `encryption: null` while populating `forceImmediate`; #02 hardcodes `forceImmediate: false` while populating `encryption`; #01 changes `strategy` handling. Each stacked branch hardcodes the fields the sibling branches populate. When rebasing/merging #9 → #10 → #11, a clean-looking textual merge can silently drop a sibling's field (e.g. forced releases stop working, or encrypted bundles emit no encryption block). After EACH stacked merge, re-check that `writeManifestFile` passes all live fields to both the manifest JSON and `signManifest`.
2. **MEDIUM (#10): native decrypt buffers the whole bundle in memory** (ciphertext + plaintext ≈ 2–2.5× bundle size; iOS `Data(contentsOf:)`, Android `readAllBytes` + `doFinal`). OOM risk for large bundles on low-end Android. Acceptable v1 (GCM buffers internally anyway) but should be documented with a size guidance; also the pre-download disk-space guard (`size * 2.5`) doesn't account for the extra decrypted zip copy for encrypted bundles.
3. **LOW (#7): `updateApplied` payload re-reads `store.getCurrentBundle()` outside the state lock** after `prepareNotifyAppReady` (both platforms). Tiny TOCTOU; prefer building the payload from the preparation's data.
4. **LOW (#7): failure `reason` strings can drift cross-platform** — iOS detects extraction failures via typed `ZipUtilsError`, Android via message-substring matching ("zip"/"extract"). Verify Android's ZipUtils exception messages actually match, or use a typed exception.
5. **LOW (#6/setChannel): a channel named `.` passes validation** (charset allows it; only `..` is rejected; reserved list doesn't cover it). URL normalization can collapse `/./` and fetch a wrong (harmless, 404) path. Suggest rejecting a bare `.` segment natively and server-side.
6. **NIT (#6): web stub `setChannel` skips name validation** — parity gap with native.
7. **NIT (#10): plan/PR wording says kid-mismatch "surfaces via getLastFailure"** — actually it surfaces via download_error telemetry, the thrown error, and the `downloadFailed` event (#7); `getLastFailure` is rollback-only. Fix the wording, not the code.
8. **Verify on #11 (couldn't fully check): eviction `keep.contains(item.lowercased())`** — confirm the keep-set entries are lowercase hashes, and that builtin-seed entries are never evicted.

Verified-good in the fast pass (don't spend time re-deriving): canonical filesHash byte-identical across TS (`Buffer.compare`) / Swift / Java including lowercase sha256 normalization; delta path-prefix guard appends `/`; zip-vs-deltas required-field branching with signature covering `strategy`; #6 escalation symmetric across platforms with `off`/manual/throttle untouched; #8 GET auth identical to DELETE; #10 CLI streaming tag-append is correct (flush ordering) and the revert flag is applied before manifest re-sync.

## Deliverable
Per PR: verdict (approve / request changes), findings ranked by severity with file:line references, and any cross-implementation mismatch demonstrated with a concrete input. Post findings as PR review comments if you have gh access; otherwise output a single markdown report grouped by PR.
