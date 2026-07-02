# Implementation Plan: CLI Compatibility Guardrail

Status: ready to implement (smallest of the four — ship first)
Owner: —
Related: [CAPGO_IMPROVEMENT_PLAN.md](../../CAPGO_IMPROVEMENT_PLAN.md)

## 1. Goal

Catch the most dangerous OTA mistake **at upload time**: shipping JS that depends
on native code the installed app shell doesn't have (a new/changed native plugin).
That ships fine over the air and then crashes on launch. Today OtaKit's
`runtimeVersion` lanes *prevent serving* across a boundary, but nothing *tells the
developer they just created a boundary*. This adds the warning (and an optional
hard fail) before the bundle is ever released.

CLI-only. No plugin changes. One small read-side API addition.

## 2. How Capgo does it (verified from source)

- **Detect native deps** — `cli/src/utils.ts::getLocalDependencies()`:
  - Reads `package.json` dependencies, resolves each in `node_modules`, reads the
    *actual* installed version from the dep's `package.json` (handles
    `catalog:`/`workspace:`/`link:`).
  - A dep is **native** if its folder contains a file matching
    `nativeFileRegex = /([A-Za-z0-9]+)\.(java|swift|kt|scala)$/`.
  - For native deps, computes per-platform checksums
    (`calculatePlatformChecksums`): sha256 over the sorted native files **plus**
    platform config files (podspec, `Package.swift`, `build.gradle`), including
    each file's relative path in the hash (detects renames). → `ios_checksum`,
    `android_checksum`.
  - Result per dep: `{ name, version, requested_version, native, ios_checksum,
    android_checksum }`.
- **Remote set** — `getRemoteDependencies(appId, channel)` reads the native
  package list that the channel's current bundle was built with (Capgo persists it
  server-side on upload).
- **Compare** — `getCompatibilityDetails()` marks a package **incompatible** when:
  - local native dep has **no remote** counterpart → `new_plugin` (needs store
    update);
  - version ranges **don't intersect** (`rangeIntersects`) → `version_mismatch`;
  - `requested_version` changed → `requested_version_changed`;
  - **checksum changed** even if version matches (patched native code) →
    ios/android changed.
  - A remote-only package (removed locally) is **compatible** (removal is fine OTA).
- **Surfaces**: `cli bundle compatibility --channel X` prints a table;
  `releaseType` prints `native`/`OTA` for CI branching; upload integrates the check
  and can fail (the "fail-on-incompatible-upload" spec in
  `docs/superpowers/specs/`). `summarizeUploadCompatibility` distinguishes
  `compatible` / `incompatible` / `skipped` (new channel / no remote metadata).

## 3. OtaKit today

- CLI upload (`lib/upload-workflow.ts`) has no notion of dependencies; `initiate`
  is called with only `{ version, runtimeVersion, size, sha256 }` — the CLI does
  not currently send `metadata` at all.
- `Bundle.metadata Json?` exists and `bundles/initiate` accepts/validates a
  `metadata` object (≤8KB, depth 5, `lib/validation.ts::isValidMetadata`) and
  persists it through `UploadSession` → finalize → `Bundle`. That proves the
  initiate→finalize carry-through pattern we need — but we use a **dedicated
  column** instead of `metadata` (see §4.2 for why).
- Native compatibility is modeled by `runtimeVersion` lanes (cleaner than Capgo's
  per-version gating). The guardrail complements lanes: it tells the dev *when to
  bump the lane / ship a store build*.
- `releases?channel=X` GET returns releases **including reverted ones**, ordered
  `promotedAt desc`, each with `bundleId`, `runtimeVersion`, and `revertedAt` —
  enough to resolve the channel's current release client-side.
- **`bundles/[bundleId]` has only a DELETE handler today (verified) — there is
  no GET.** A bundle-detail GET must be added, not extended.

## 4. Design for OtaKit

### 4.1 Compute the native set (CLI)

Port Capgo's detection into `packages/cli`:
- `lib/native-deps.ts`:
  - `collectNativePackages({ packageJsonPath?, nodeModules? })` →
    `NativePackage[] = { name, version, requestedVersion, iosChecksum?,
    androidChecksum? }` (only native deps; non-native filtered out to keep it
    small for the 8KB metadata cap).
  - Native detection regex `/\.(java|swift|kt|scala)$/`; checksum = sha256 over
    sorted native + config files (podspec / `Package.swift` / `build.gradle`),
    path-in-hash. Reuse `lib/hash.ts`.
  - Robust to monorepos via `--package-json` / `--node-modules` flags (mirror
    Capgo).

### 4.2 Persist it on upload

- Store the native set in a **dedicated nullable column `Bundle.nativePackages
  Json?`**, *not* in the user-facing `metadata`. (Cramming it into `metadata`
  shares the 8 KB `initiate` validation budget with user metadata — a user with
  large metadata could push the request over the cap and **fail the upload**. A
  dedicated column avoids that and is cleaner to query.) `upload-workflow.ts` sends
  `nativePackages` as a top-level field to `initiate`; it flows through
  `UploadSession` → `finalize` → `Bundle.nativePackages`.

### 4.3 Read the remote set + compare

- Add a **new `bundles/[bundleId]` GET handler** (bundle detail incl.
  `nativePackages`) — only DELETE exists today — and/or include
  `nativePackages` on the release response, reading from the column.
- CLI on upload (and in the standalone command):
  1. Resolve the target channel's current release: newest release with
     `revertedAt: null` **whose bundle is in the same `runtimeVersion` lane as
     the upload** (the GET returns reverted releases too — filter client-side,
     or add a `current=true` query param). Then its `bundleId` → its
     `nativePackages` (the "remote" set). Lane-matching matters: comparing
     against another lane's bundle would produce false alarms; a brand-new lane
     has no baseline and is correctly `skipped` (§7).
  2. Compute local native set.
  3. Compare with the same rules as Capgo (`getCompatibilityDetails` ported to
     `lib/native-deps.ts::compareNative`). Use `semver` `rangeIntersects` (the CLI
     can add `semver`/`@std/semver`).
  4. Outcome: `compatible` / `incompatible` / `skipped` (no remote metadata / new
     channel / `--ignore-compat`).

### 4.4 CLI surface

- `otakit upload` integrates the check and **warns by default**, with:
  - `--fail-on-incompatible` (CI gate; exit non-zero on `incompatible`).
  - `--ignore-compat` (skip the check).
  - On incompatible: print the offending packages + reason, and the actionable
    hint: *"These native changes require a new store build. Bump
    `runtimeVersion` and ship a native build before releasing this bundle OTA."*
    (Ties the warning to OtaKit's lane model.)
- `otakit compatibility --channel <name>` — standalone table report (no upload).
- (deferred) `otakit release-type` — `native`/`OTA` for CI branching. Not needed
  for v1; the upload-integrated check + `compatibility` cover the use case.

## 5. File-by-file change list

CLI (`packages/cli`):
- `lib/native-deps.ts` — new: `collectNativePackages`, `compareNative`,
  `summarize`.
- `lib/hash.ts` — reuse for file/dir checksums.
- `lib/api.ts` — `getBundle(bundleId)` (incl. `nativePackages`),
  ensure `listReleases(channel)` exposes current `bundleId`.
- `lib/upload-workflow.ts` — send `nativePackages` to `initiate`; run the check;
  honor flags.
- `commands/upload.ts` — `--fail-on-incompatible`, `--ignore-compat`,
  `--package-json`, `--node-modules`.
- `commands/compatibility.ts` — new.
- `lib/table.ts` (or reuse existing formatting) — results table.

Console (`packages/console`):
- `prisma/schema.prisma` — add `Bundle.nativePackages Json?` (small migration).
- `bundles/initiate` + `finalize` — accept `nativePackages`, carry through
  `UploadSession`, persist on `Bundle`.
- `bundles/[bundleId]` GET — **new handler** (route currently has only DELETE);
  return bundle detail incl. `nativePackages`.
- (optional) `releases` GET — include current bundle's `nativePackages` to save a
  round-trip.

No plugin changes.

## 6. Decision rules (ported, explicit)

A local **native** package is incompatible when, vs the channel's current bundle:
- no remote entry → **new native plugin** (store build required);
- version ranges don't intersect → **version mismatch**;
- ios/android checksum changed though version matches → **native code changed**.

Remote-only (removed locally) → compatible. No remote metadata at all → **skipped**
(never silently report "compatible").

**Reduce false positives:** unlike Capgo, do **not** fail on a changed
`requested_version` *range string* alone (e.g. `^1.2.0` → `^1.3.0` resolving to the
same installed native with an identical checksum). The checksum is the
authoritative "native code actually changed" signal. Report a range-string change
as **informational only**, not incompatible — keeps the guardrail from crying
wolf.

## 7. Edge cases

- **First release on a channel** → no remote set → `skipped` (don't block).
- **First release on a new `runtimeVersion` lane** (dev just bumped the lane for
  a native change) → no baseline in that lane → `skipped`. This is the correct
  outcome: the lane bump *is* the fix the guardrail exists to recommend.
- **Channel's current bundle has no `nativePackages`** (e.g. uploaded without this
  feature) → `skipped`; the next upload establishes the baseline.
- **Monorepos / pnpm / workspaces** → `--package-json` / `--node-modules` flags;
  read actual version from the resolved package's `package.json`.
- **`webDir` vs project root** → native detection runs against the project's
  `node_modules`, not the built `webDir`.

## 8. Testing

- Unit: native detection (swift/java/kt/scala), checksum stability + sensitivity
  to a one-line native change, range intersection, new/removed plugin
  classification, `skipped` cases.
- Integration: upload attaches `nativePackages`; second upload reads remote set
  and compares; `--fail-on-incompatible` exits non-zero on a new native plugin.
- Fixture apps: one pure-JS change (→ compatible/OTA), one adding a native plugin
  (→ incompatible/native).

## 9. Rollout

Ship as-is; warnings are non-breaking. Encourage `--fail-on-incompatible` in CI.
Once adoption is high, consider defaulting to fail in CI environments
(`process.env.CI`) with an opt-out.

## 10. Open questions

- Should we also store a coarse `runtimeVersion` recommendation in the warning
  (e.g. suggest the next lane name)? Nice-to-have.
- Reuse Capgo's exact checksum file set (podspec/Package.swift/build.gradle) or
  broaden? Start with Capgo's set — it's battle-tested.
