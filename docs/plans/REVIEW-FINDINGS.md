# OtaKit 7-PR Review — Findings

> **Resolution log (2026-07-02).** All valid findings fixed and pushed; decisions
> favored simplicity per the owner's preference.
>
> - **Fixed:** 5.1 (deploy re-bake note commented on PR #5), 5.2 (strict boolean,
>   `fe0a132`), 7.1 + 7.2 (`0e33c13`), 6.1 + 6.2 + bare-`.` channel (`2e97858`),
>   8.1 + 8.2 (`95f1ec3`), 9.1 (`3341021`), 10.2 + disk multiplier + README
>   memory bound + `getLastFailure` wording (`a5833e7`), 11.1 + 11.2 + 11.3 +
>   11.4 + 11.5 (`1d1fc30`).
> - **11.1 solved lighter than proposed:** instead of finalize-time GET+re-hash,
>   `Content-MD5` is pinned into the presigned PUT — storage itself rejects
>   wrong-content uploads (one extra client-side hash, zero server egress). The
>   malicious-uploader variant is accepted as out of scope: anyone with upload
>   rights can already ship arbitrary code legitimately.
> - **11.3 solved lighter than proposed:** `bundle.json` / `otakit_files.json`
>   are reserved (rejected) delta paths on server + both natives; the bundle
>   layout is unchanged (note `bundle.json` in the web root is a pre-existing
>   pattern).
> - **10.1 resolved as wording, not code:** decrypt failures surface via
>   `download_error` telemetry + the `downloadFailed` event; `getLastFailure()`
>   stays rollback-only. README updated; adding a second failure-marker channel
>   wasn't worth the semantics.
> - **10.3 accepted:** CLI warns (it cannot know server signing config); hosted
>   signs by default.
> - **Won't fix (complexity > value):** 6.3, 8.3, 9.2, 10.4-streaming (documented
>   size bound instead), 11.6 (GC stays an open question in plan 01).
> - **Still open for merge time:** the `writeManifestFile` stacked-rebase
>   collision, and porting #7's `emitEvent` calls into #11's delta path when #11
>   rebases over #7.

Date: 2026-07-01
Reviewer: Claude Code (deep review per `docs/plans/REVIEW-TASK.md`)
Scope: PRs #5, #7, #6, #8, #9, #10, #11 (local branches diffed against their true bases)

**Verification performed:**

- Read all plan specs in `docs/plans/`; diffed each branch against its actual base
  (`main` for #5/#6/#7/#8; `feat/manifest-payload-v2` for #9/#10/#11).
- Ran a canonical-payload vector script (4 cases: defaults, non-null
  channel/runtimeVersion, encryption block present, forceImmediate true) comparing the
  TS signer against Swift/Java transliterations — **byte-identical**.
- Ran an AES-GCM envelope round-trip + tamper test against the CLI crypto layout
  (`cli/src/lib/crypto.ts` logic) — round-trips, tamper detected.
- Ran a filesHash canonicalization vector (unicode, NFC/NFD, case, prefix ordering)
  across the three implementations — **identical**.
- Confirmed every native method referenced by new Android code exists (no gradle
  compile was run per the accepted gaps).

**Summary verdicts:**

| PR | Branch | Verdict |
|----|--------|---------|
| #5 | `feat/manifest-payload-v2` | Approve |
| #7 | `feat/07-update-event-listeners` | Approve with minor fixes |
| #6 | `feat/04-set-channel` | Approve with one fix |
| #8 | `feat/03-compat-guardrail` | Approve with fixes |
| #9 | `feat/06-force-immediate` | Approve |
| #10 | `feat/02-bundle-encryption` | Request changes |
| #11 | `feat/01-delta-updates` (draft) | Request changes |

---

## PR #5 — `feat/manifest-payload-v2` · Verdict: **Approve**

The critical property holds: all three canonical-payload builders
(`console/lib/manifest-signing.ts`, `ManifestVerifier.swift`, `ManifestVerifier.java`)
produce **byte-identical** strings for defaults, non-null channel/runtimeVersion,
encryption block present, and forceImmediate true (verified by script). Native parser
defaults (absent field → `zip` / `false` / `nil`) match what `writeManifestFile`
emits, and `signManifest` has exactly one call site so nothing signs the old shape.

| # | Severity | Finding |
|---|----------|---------|
| 5.1 | Info | **Deploy-order break is bidirectional** — old plugins fail against new manifests *and* new plugins fail against every manifest already sitting on the CDN until each lane is re-baked. Plan 02 accepts this ("no users to break"), but the PR should state it and the deploy should include a one-time re-bake (e.g. `restoreManifestFilesForApp` for all apps) so stale v1-signed manifests don't linger. |
| 5.2 | Low | `ManifestClient.java` parses `forceImmediate` with `optBoolean` (coerces the string `"true"`), while iOS `as? Bool` doesn't — a divergence only reachable with a malformed manifest, which the server never emits. Not blocking. |

---

## PR #7 — `feat/07-update-event-listeners` · Verdict: **Approve with minor fixes**

All the spec's negative checks pass: **no emission anywhere in `load()`** (all 6 emit
sites per platform are in `notifyAppReady`, `checkLatest`, `downloadAndStage`,
`rollbackCurrentBundle`); `updateApplied` is gated on `prepareNotifyAppReady`
returning a payload; `rollback` fires only from the notify-timeout path;
`getCurrentBundle()` can't NPE (falls back to a builtin BundleInfo on both platforms);
`updateAvailable`/`updateStaged` payloads are field-for-field identical across
platforms; the plain-object wrapper forwards `addListener`/`removeAllListeners`
correctly.

| # | Severity | Finding |
|---|----------|---------|
| 7.1 | **Medium** | **iOS never emits `downloadFailed` for network failures.** `downloader.download(from:)` sits *above* the do/catch in `downloadAndStage` (`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift:623`; catch at :687), so a connection reset / timeout / HTTP error emits nothing, while Android's `downloadZip` is inside the try and emits `downloadFailed`. The telemetry gap is pre-existing on main, but this PR turns it into a public cross-platform contract inconsistency. Concrete input: enable airplane mode mid-download → Android app receives `downloadFailed {reason: "download_failed"}`, iOS app receives no event. Fix: wrap the download in the same do/catch (fixes telemetry too). |
| 7.2 | Low | **Android `failureReason` misclassifies via the `"zip"` substring** (`packages/capacitor-plugin/android/src/main/java/com/otakit/updater/UpdaterPlugin.java:1161`). Exception messages frequently contain the temp file path, e.g. `FileNotFoundException: /data/.../cache/otakit-871.zip (Permission denied)` → reason `"extract_failed"` where iOS (which matches on the `ZipUtilsError` *type*) would say `"download_failed"`. Match on `"extract"` only, or classify by exception type like iOS. |

---

## PR #6 — `feat/04-set-channel` · Verdict: **Approve with one fix**

Validation runs before persistence on both platforms (reject → return, no partial
state), resolution order is exactly `explicit arg → persisted override → config`,
reserved names are case-insensitive, and the regex/reserved list matches
`console/lib/validation.ts` exactly.

| # | Severity | Finding |
|---|----------|---------|
| 6.1 | **Medium** (spec deviation, low practical impact) | **iOS accepts a channel with a trailing line terminator.** `isValidChannelName` (`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift:467`) uses `range(of: "^[…]{1,64}$", options: .regularExpression)` — a substring search where ICU's `$` matches *before a final line terminator*. Concrete input: `setChannel({channel: "beta\n"})` → **accepted and persisted on iOS, rejected on Android** (Java `matches()` requires whole-input consumption). No traversal is possible (`/`, `\`, `..` still blocked, and `ManifestClient.swift` trims whitespace/newlines before path building), but the spec requires control chars rejected and both platforms identical. Fix: `\A[A-Za-z0-9._-]{1,64}\z`, or compare the match range to the full string. Same applies to `"beta\r"`, `"beta\u{2028}"`, etc. |
| 6.2 | Info | The web stub persists any string to localStorage unvalidated — inert since web never fetches manifests, but worth mirroring the validation for consistency. |
| 6.3 | Info | `setChannel({})` (key absent) clears the override on both platforms, same as explicit `null`. Consistent and hidden by the TS types; just be aware it's not a rejection. |

---

## PR #8 — `feat/03-compat-guardrail` · Verdict: **Approve with fixes** (one real logic gap)

The GET `bundles/[bundleId]` handler enforces `resolveOrganizationAccess` + `appId`
ownership identically to DELETE; the releases API does return `revertedAt` and
per-release `runtimeVersion`, so lane matching (`!revertedAt && (runtimeVersion ??
null) === lane`, newest first) is correct; caps (≤200 entries, 32KB) can't be
bypassed; checksums are deterministic (sorted relative paths, path mixed into the hash
with `\0` separators); `--fail-on-incompatible` exits 1 via `CliError`/`runCommand`,
and blocks *before* upload.

| # | Severity | Finding |
|---|----------|---------|
| 8.1 | **Medium** | **False negative when a package adds native code for a new platform.** `compareEntry` (`packages/cli/src/lib/native-deps.ts:233-241`) filters to platforms where *both* sides have a checksum; if the intersection is unchanged it returns `unchanged`. Concrete input: baseline `foo@1.0.0 {iosChecksum: X}` (iOS-only plugin); local `foo@1.1.0 {iosChecksum: X, androidChecksum: Y}` (added Android sources) → reported **compatible**, though Android devices need a store build. Rule to add: local checksum present for a platform with no remote counterpart → incompatible (`new_plugin`-like), mirroring the whole-package rule. (The reverse — remote-only checksum — is a removal and correctly compatible.) |
| 8.2 | Low | `checkCompatibilityAgainstChannel` scans only the newest 50 releases (`packages/cli/src/lib/compat-check.ts`). On a channel where 50+ newer releases exist in *other* lanes, the real baseline falls off the page and the check silently reports `skipped`. Paginate or add a lane filter param. |
| 8.3 | Info | `isValidNativePackages` allows arbitrary extra keys per entry (stored and echoed back verbatim, within 32KB), and the 32KB cap counts UTF-16 code units, not bytes (~up to 3× on-disk). Not exploitable; tighten if you want strict shapes. |

---

## PR #9 — `feat/06-force-immediate` (stacked on #5) · Verdict: **Approve**

This one is clean. Verified against every check in the task:

- `off` branches and the manual JS API are untouched (escalation exists only in the
  six shadow/apply-staged automatic branches, identical on both platforms).
- The `checkInterval` throttle is not bypassed (`respectInterval` threading unchanged
  — a forced release still waits out the throttle on resume).
- No reload loop (after apply, `doesBundleMatchLatest` classifies `noUpdate`).
- `forceImmediate` is threaded through `DownloadResolution` identically (Java field +
  `isForcedStaged()`, Swift associated value + `isForcedStaged(_:)`), including both
  expired-URL retry sub-branches.
- The revert route updates the release that **becomes** current (recomputed
  lane-matched inside the transaction, flag applied **before**
  `syncManifestFileForLane`).
- `writeManifestFile` bakes `release.forceImmediate` and the `include:` queries carry
  the column. Migration matches the schema. Console checkbox/badge and CLI flag wired
  correctly.

| # | Severity | Finding |
|---|----------|---------|
| 9.1 | Info | `upload --force-immediate` without `--release` is silently ignored (the help text does say "With --release", but a warning would be kinder). |
| 9.2 | Info | Passing `forceImmediate: false` on revert explicitly clears the reverted-to release's flag — matches the spec's "when provided, set it"; the console sends `{}` when unchecked, which is correct. |

---

## PR #10 — `feat/02-bundle-encryption` (stacked on #5) · Verdict: **Request changes** (one spec requirement missed)

Crypto core is solid:

- CSPRNG (`randomBytes`) for DEK/nonces, fresh per bundle; 12-byte nonces.
- GCM tag **verified before any plaintext use on both platforms** (iOS `AES.GCM.open`,
  Android explicit `doFinal` — the CipherOutputStream pitfall is called out and
  avoided).
- Decrypt slots between hash-verify and extract; kid mismatch throws before anything
  is staged; temp plaintext cleaned in `finally`/`defer` and written atomically (iOS)
  / only after successful `doFinal` (Android); KEK never logged (only the kid).
- Server-side envelope validation is strict (exact key set, alg pinned, 12B/48B length
  checks with base64 round-trip).
- Envelope layout round-trip (wrap → unwrap → decrypt → tamper) verified against the
  CLI logic: passes, tamper detected.

| # | Severity | Finding |
|---|----------|---------|
| 10.1 | **Medium** (spec deviation) | **Decrypt failures do not surface via `getLastFailure()`.** The plan (§4.4) explicitly requires "no matching bundle key" to surface there — but `setLastFailedBundle` is written only in `rollbackLocked` (`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterCoordinator.swift:500`, Java mirror). All download-path failures, including kid mismatch and tag failure, never touch it. On default policies a wrong/missing `bundleKeys` config is invisible to the app (telemetry only) until PR #7's `downloadFailed` event merges — and even then, cold-start auto-flows fire before listeners attach. Either record a failure marker for decrypt errors or amend plan+README to say telemetry/`downloadFailed` is the surface. |
| 10.2 | Low | `writeManifestFile` silently degrades a malformed stored encryption row to `null` (`packages/console/lib/manifest-files.ts:65`, `parseBundleEncryption(bundle.encryption) ?? null` — note `null` (malformed) and `undefined` (absent) collapse to the same value). An encrypted object would be published with an unencrypted manifest: devices pass the hash check, then fail extraction on ciphertext, every cycle. Malformed-but-present should throw, not degrade. |
| 10.3 | Low (spec deviation) | Plan §4.3: "The CLI should **fail** `--encrypt` unless manifest signing is configured." Implementation only prints a warning. Acceptable in practice (tampering unsigned enc params is DoS-only, since url/sha256 tampering is the bigger unsigned problem anyway), but it's a deviation — state it in the PR or check the fetched manifest for a `signature` block post-release. |
| 10.4 | Info | Both platforms buffer the full ciphertext **and** plaintext in memory (Android ~3× bundle size counting the stream copy). For a 50 MB-asset app that's ~150 MB peak on Android — consider a documented size bound now and streaming decrypt later. |

---

## PR #11 (draft) — `feat/01-delta-updates` (stacked on #5) · Verdict: **Request changes**

What holds up well:

- filesHash canonicalization is **byte-identical** in TS/Swift/Java (UTF-8-byte sort,
  `path:sha256` lines — verified by vector script including unicode, NFC vs NFD, case,
  and prefix-ordering cases).
- Path traversal guards are complete and mirrored on both platforms (absolute, `\`,
  `.`/`..`/empty segments, control chars, 512 length) *plus* canonical-path prefix
  checks at write time.
- Per-file HTTPS is enforced at manifest parse on **both** platforms.
- Device-side caps exist (10k files / 500 MB); zip path is completely untouched for
  the default strategy.
- The CLI's PUT headers exactly match the presign-pinned fields
  (`Content-Type: application/octet-stream`, `Content-Length`,
  `Cache-Control: public, max-age=31536000, immutable`).
- Objects are namespaced per `appId`; cache eviction **cannot** corrupt live bundles
  because assembled bundles are self-contained copies (pruning only costs future
  re-downloads; staged/current/fallback hash lists are kept regardless).

| # | Severity | Finding |
|---|----------|---------|
| 11.1 | **High** | **File-object content is never hash-verified server-side.** `initiate-delta` dedups by HEAD existence+size (`packages/console/app/api/v1/apps/[appId]/bundles/initiate-delta/route.ts:106`) and `finalize-delta` verifies only existence+size (`.../finalize-delta/route.ts:138`). A presigned PUT pins length, not content — so any same-length wrong-content upload (malicious org member, or a CLI race where a file changes between hashing and PUT) permanently poisons `files/<appId>/<sha256>`: it's cached immutable at the edge, dedup guarantees it is *never re-uploaded*, and every future release referencing that hash hard-fails on-device (per-file verify) while the server keeps reporting success. Cross-app poisoning is impossible (namespace ✓), but this is a permanent, silent, self-inflicted DoS the task explicitly requires closing. Fix: persist the initiate-time "missing" set on the `UploadSession` and GET+hash-verify exactly those objects in finalize (bounded work: only newly-uploaded objects). |
| 11.2 | **Medium** | **Content-cache writes are not crash-safe.** Android `DeltaAssembler.copyFile(temporary, cached)` (`packages/capacitor-plugin/android/src/main/java/com/otakit/updater/DeltaAssembler.java:195`) streams directly to the final `otakit_files/<sha256>` path; iOS `copyItem` (`packages/capacitor-plugin/ios/Sources/UpdaterPlugin/DeltaAssembler.swift:173`) is likewise non-atomic. Process death mid-copy leaves a truncated file whose `exists()` check short-circuits `ensureCached` forever, and **assembly never re-verifies cache content** — the corrupt file is copied into the bundle, staged, and applied (broken asset ships; if it's `index.html`, trial/rollback catches it, otherwise nothing does). Fix: copy to a temp name inside the cache dir and rename into place (atomic on same volume, both platforms), which also fixes the same pattern in builtin seeding. |
| 11.3 | Low | `otakit_files.json` (the pruning hash list) is written into the **bundle web root** on both platforms — it gets served by the webview and collides with/overwrites a genuine app file of the same name. Store it beside `bundle.json` in the store's metadata area instead, keyed by bundle id. |
| 11.4 | Low | **NFC/NFD divergence in duplicate detection on iOS.** `validate()` uses a Swift `Set<String>`, where canonically-equivalent strings compare equal — a manifest containing both `é.js` (NFC) and `é.js` (NFD) passes server validation (JS code-unit comparison) and Android, but throws `duplicatePath` on iOS, permanently failing the update on one platform. Only reachable from a Linux-built webDir (byte-based filesystem); dedupe on `Array(path.utf8)` or normalize server-side to close it. |
| 11.5 | Info | CLI performs no client-side pre-check of the 5000-file / max-size caps — it hashes everything and gets a 400 from initiate. Fine functionally; a fast local check would improve UX. (Device-side caps are present, satisfying the "server AND client" requirement where it matters for safety.) |
| 11.6 | Info | Per-file objects are never GC'd; bundle DELETE removes only the file-list object. The plan lists this as an open question — make sure the PR body states it. |

---

## Cross-cutting notes

- **Accepted gaps**: PR bodies could not be read (no `gh` auth) to confirm the
  migration / no-device-test / no-test-suite caveats are stated — verify each PR body
  carries them, especially #5's re-bake requirement (finding 5.1).
- **Stacking/rebases**: as the task predicts, #6/#7 collide on
  `UpdaterPlugin.*`/`definitions.ts`/`index.ts`, and #9/#10/#11 each modify
  `writeManifestFile` + `LatestManifest` plumbing with hardcoded defaults for the
  other features' fields (e.g. #11 hardcodes `forceImmediate: false`) — the sequential
  rebases must re-thread those, particularly `writeManifestFile`, where all three
  features meet. Worth a fresh eyes-on of that one function after the final rebase.
- **Merge-order nit**: #7's `downloadFailed`/`updateStaged` emissions live in
  `downloadAndStage`, but #11 adds a parallel `assembleAndStage` path that only sends
  telemetry — after rebasing #11 over #7, the delta path needs the same `emitEvent`
  calls or delta apps get no events.
