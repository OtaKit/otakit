# Implementation Plan: Update Strategy (zip + opt-in deltas)

Status: **v1 — default `'zip'`; `'deltas'` opt-in alongside it.**
Owner: —
Related: [02-bundle-encryption.md](./02-bundle-encryption.md),
[05-immediate-update-splash.md](./05-immediate-update-splash.md) (deltas shrink the
download the splash waits on), [CAPGO_IMPROVEMENT_PLAN.md](../../CAPGO_IMPROVEMENT_PLAN.md)

## Decision

An app picks one **update strategy**; it is never a mix:

```
updateStrategy: 'zip' | 'deltas'      // app-level setting, default 'zip'
```

- The setting steers the **CLI**: upload one zip, *or* upload per-file objects.
- The CLI writes the chosen strategy into the **manifest**.
- The **SDK** reads `strategy` and runs exactly that one path. No fallback, no
  mixing, no device-side diffing.

**Both strategies ship in v1; `'zip'` is the default.** Deltas live *alongside*
zip as an **opt-in** — an app turns it on deliberately. The risk is contained:
every app that doesn't opt in stays on the unchanged, proven zip path and is
completely unaffected. The native delta path is additive (a second branch behind
the manifest's `strategy` field), not a rewrite of the zip path.

Honest note: deltas are still real native work (the content cache + assembly on
both platforms), and the bandwidth they save is **free for us** on R2 — the win is
the *user's* download size, which matters for large/asset-heavy apps. But because
it's strictly opt-in and zip stays the default, shipping it carries no risk to
apps that don't use it.

---

## v1 — `'zip'` (what exists today)

- CLI zips `webDir`, uploads it (`lib/upload-workflow.ts`), finalize creates the
  `Bundle`.
- Manifest (`lib/manifest-files.ts`) publishes `{ version, url, sha256, size, …,
  signature }`. **Add `"strategy": "zip"`** so the manifest is self-describing
  going forward.
- Plugin downloads the zip, verifies SHA-256, extracts, stages/applies. Unchanged.

That's the whole v1 change: one new constant field in the manifest. Done.

---

## `'deltas'` strategy (opt-in)

The simplest robust delta is **per-file content-addressed objects + a device-side
content cache**. It is not a version-pair patch scheme (those are fragile — they
need precomputed diffs per source version and a version window). Here there is no
diffing and no version math; correctness comes from content hashes.

### Storage

Each file is stored once, by its content hash, namespaced per app, immutable:

```
files/<appId>/<sha256>
```

Content addressing = automatic dedup across releases; immutable → cached forever
at the edge.

### Manifest (`strategy: "deltas"`)

```jsonc
{
  "version": "1.2.3", "runtimeVersion": null, "releaseId": "…",
  "strategy": "deltas",
  "filesHash": "…",                      // sha256 of the canonical file list (signed)
  "files": [
    { "path": "index.html",         "sha256": "…", "url": "https://cdn/files/<appId>/<sha256>" },
    { "path": "assets/main.abc.js", "sha256": "…", "url": "https://cdn/files/<appId>/<sha256>" }
  ],
  "signature": { … }                     // ES256, now covers filesHash
}
```

The file list is the complete *target*. It is the same for every device (still a
static CDN file) — it does **not** describe per-device deltas; the device derives
those itself from its cache (below), cheaply.

### SDK execution — fill cache misses (no diffing)

The device keeps a content cache keyed by hash: `otakit_files/<sha256>`.
Assembling a bundle is just:

```
for each { path, sha256, url } in manifest.files:
    if not exists(otakit_files/<sha256>):      # a filesystem stat
        download(url) -> verify sha256 -> otakit_files/<sha256>
    link otakit_files/<sha256> -> bundleDir/<path>
require index.html at root; then stage/apply as today
```

No version comparison, no manifest diffing — for each file, "do I already have
this exact content?" (cache lookup); download only the misses. The cache is the
state; previous bundles populated it.

**Seed the cache from builtin once** (hash the web assets packed in the store
build into `otakit_files/<sha256>`) so the *first* OTA reuses everything that
shipped in the binary and only fetches what changed.

### What it touches (sketch — detail when we build it)

- CLI: walk `webDir`, hash files (include empty files), upload missing hashes,
  send file list to finalize.
- Console: store per-file objects (server-side dedup check), store the bundle's
  file list (as a storage object, not a DB table), emit `files[]` + `filesHash`,
  extend the signed canonical payload with `filesHash`.
- Plugin (iOS + Android): the content cache + the loop above + builtin seeding +
  per-file hash verify + the same path-traversal/symlink/size guards `ZipUtils`
  already enforces.

### Verified integration constraints (from source — shape the build)

- **`initiate` presigns exactly one zip PUT today** —
  `createPresignedUpload` hardcodes `bundles/<appId>/<uploadId>.zip` with
  `ContentType: application/zip` and a pinned `ContentLength`
  (`console/lib/storage.ts:85-110`), and `finalize` HEAD-verifies that single
  object's size. Deltas need a **new batch initiate**: CLI sends the candidate
  file list `{ path, sha256, size }[]`; server answers with presigned PUTs for
  the **missing** hashes only (server-side dedup check by key existence);
  finalize verifies each uploaded object and persists the canonical file list.
  This is a real new API surface, not a tweak to the existing one.
- **`Bundle.storageKey` is a non-null column pointing at the zip.** For a
  deltas bundle, point it at the uploaded **file-list object** (so existing
  delete/GC code paths still have one object to own), and set `Bundle.sha256 =
  filesHash`. That keeps the device-side identity comparison working unchanged
  — `doesBundleMatchLatest` matches `releaseId` first, `sha256` second
  (`UpdaterCoordinator.swift:593-626`).
- **Native manifest parsing requires `url`/`sha256`/`size` today**
  (`ManifestClient.swift:94-100` throws without them). The deltas manifest has
  no top-level `url` — parsing must branch on `strategy` (`zip` keeps today's
  required fields; `deltas` requires `files[]` + `filesHash`). Same for the
  verifier inputs: for `deltas`, `sha256` in the signed payload is `filesHash`.
- **ZipUtils guards confirmed** and reusable as the checklist for per-file
  writes: absolute path, `..` traversal, symlink entries, file-count cap, total
  uncompressed-size cap (`ZipUtils.swift:28-60`).
- **File objects get the immutable cache header** — reuse `BUNDLE_CACHE_CONTROL`
  (`public, max-age=31536000, immutable`, `storage.ts:12`); content-addressed
  keys make that safe forever.

### Known, accepted tradeoffs

- `'deltas'` always fetches per file, even when a release changes almost
  everything (rare big dependency bump). No zip shortcut — that's the price of "no
  mixing," and it's the owner's informed choice for picking deltas.
- Brotli per-file compression is **out of scope for now** (needs a native decoder
  on both platforms). Discuss later; uncompressed delta is already the main win.

### Security (when built)

- Manifest signature covers `filesHash`; both natives verify.
- Every downloaded file's decoded SHA-256 verified before use.
- Per-file writes reuse the `ZipUtils` guards (reject `..`/absolute/symlink;
  enforce file-count / total-size caps).
- Content objects namespaced per `appId`; server decides dedup.

---

## Open questions

- Cache eviction policy (prune to current + staged + builtin? size cap?).
- Hardlink vs copy from cache.
- Brotli (own follow-up — needs a native decoder on both platforms).
- Unreferenced-object GC.
