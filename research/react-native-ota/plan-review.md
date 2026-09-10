# Adversarial review of the RN OTA plan

Date: 2026-09-10. Reviewer viewpoint: read [architecture.md](architecture.md), [README.md](README.md) and
[integration-verification.md](integration-verification.md), then re-derived the conclusions from the OtaKit source
independently. Every finding below is anchored to a file and line in this repository or to an explicit quote from the
plan. Nothing here reopens the native RN/Expo source verification, which holds up.

**Summary of the position.** The plan is unusually careful about the things most OTA designs get wrong (launch
generations, trial identity, headless deferral, embedded fallback, signature binding). Its weaknesses are not in the
native lifecycle. They are in three other places:

1. **Concrete defects it would ship** — the baseline release causes a full redundant download for the entire install
   base, and the v3 CDN path silently breaks billing enforcement. Sections 1–2.
2. **Two structural choices that will hurt within weeks of launch** — the runtime lane is welded to the bundle row, and
   platform is put in the URL path instead of inside the manifest. Sections 3–4.
3. **Scope** — roughly a third of the plan is work that RN does not need, while the two features that decide whether a
   pilot converts (staged rollout, install identity) are absent. Sections 6–8.

---

## 1. The baseline release downloads the whole app to every device, for nothing

Section 9 of the plan: *"every RN platform/channel/runtime lane must have a known-good baseline before its first OTA
release… Before publishing the first OTA to that platform/channel/runtime, publish its baseline as the lane's initial
release if the lane is empty."*

The idea is right — operator rollback needs a real target. The mechanism is wrong, and the existing client proves it.

A freshly installed device's current bundle is the builtin record, which carries `sha256: nil`, `releaseId: nil`,
`channel: nil` ([BundleStore.swift:69-80](../../packages/capacitor-plugin/ios/Sources/UpdaterPlugin/BundleStore.swift)).
`doesBundleMatchLatest` compares release ID, then hash, then falls through:

```swift
// UpdaterCoordinator.swift:618-624
if trimToNil(bundle.releaseId) != nil ||
    trimToNil(latest.releaseId) != nil ||
    trimToNil(bundle.sha256) != nil ||
    trimToNil(latest.sha256) != nil {
  return false
}
```

The manifest always has a release ID and a hash; the builtin record never does. So **the baseline manifest is always
classified as "an update is available"**. Consequences at the moment a new store version reaches general availability:

- Every device downloads the full artifact — for RN that is the Hermes bundle *plus every asset*, because none of the
  embedded assets exist as files on disk yet. First-update deltas reuse nothing.
- Every device runs a trial and a full JS reload to arrive at code byte-identical to what it already had.
- Under delivery-based billing this is a **billable download per install**, charged to the customer for a no-op. For an
  app with a 50 MB asset payload and 100k installs this is ~5 TB and 100k billable deliveries per store release.
- It happens exactly during a phased store rollout, when the fleet is least stable.

**Fix: make the embedded build a first-class artifact identity, not an anonymous fallback.** The export that produces the
baseline already knows its bytes, so the native build can embed `baselineSha256` (and, if the baseline is published
before the store build, `baselineReleaseId`) alongside the runtime ID that section 4 already embeds. Then:

- `builtinBundle()` returns that hash and release ID, so `doesBundleMatchLatest` short-circuits and no download happens.
- Rollback to baseline becomes **zero bytes**: the client recognises the manifest as the embedded app and selects it.
  That is strictly better than Expo's `rollBackToEmbedded` directive, which the plan correctly declined to copy — you get
  the same capability out of the ordinary release path with no new directive *and* no transfer.
- No `downloaded` event fires (nothing was downloaded), so the customer is not billed for adopting their own baseline.
  Record the release ID as current and emit `applied` on confirmation only if the trial actually ran; simpler still,
  treat baseline selection as "already current" and emit nothing.

This is the single highest-value change in this review. It converts section 9 from a liability into a feature.

Two supporting details:

- Build tooling must upload the baseline artifact at **native build** time, not at first-OTA time, otherwise the hash
  embedded in the binary and the hash on the server can diverge. The plan's *"Build tooling checks that its application
  payload matches the embedded build"* is the right check but is scheduled too late.
- Publishing the baseline should be idempotent per `(app, platform, channel, runtime)` and should be skipped when the
  lane's current release already *is* the baseline, so repeated CI runs don't create release churn.

## 2. The v3 manifest path defeats billing enforcement and app deletion

The plan's layout is:

```text
{cdnUrl}/manifests/v3/{appId}/{platform}/{channelKey}/{runtimeKey}/manifest.json
```

Every bulk manifest operation in the product is a prefix sweep keyed on app:

```ts
// packages/console/lib/manifest-files.ts:144-145
export async function deleteAllManifestFilesForApp(appId: string): Promise<void> {
  const prefix = `${MANIFEST_PREFIX}/${appId}/`;
```

`manifests/v3/{appId}/…` does not start with `manifests/{appId}/`. That function is what enforces a usage block
([packages/console/lib/billing/usage.ts:70-73](../../packages/console/lib/billing/usage.ts)) and what clears an app's
manifests. With the proposed path, **a blocked organisation keeps serving v3 manifests to every RN device and every
upgraded Capacitor device indefinitely**, and a deleted app keeps serving too. The legacy v2 objects would be removed,
so the failure is silent and looks like enforcement worked.

**Fix: version below the app, not above it** — `manifests/{appId}/v3/{platform}/{channel}/{runtime}/manifest.json`. One
prefix still covers every namespace, `listStorageKeys` already paginates correctly
([storage.ts:284-308](../../packages/console/lib/storage.ts)), and no call site changes. If the path really must lead
with the version, then `deleteAllManifestFilesForApp` and `restoreManifestFilesForApp` need an explicit namespace list
and a test that asserts a blocked org serves nothing on *any* namespace. The prefix fix is cheaper and cannot rot.

While in that file: `restoreManifestFilesForApp` writes lanes in a sequential `await` loop, each iteration doing a
storage write plus a CDN purge (manifest-files.ts:232-250). Today an app has a handful of lanes. Section 3 explains why
that number is about to become hundreds.

## 3. Runtime lanes are welded to the bundle row — which makes the normal case impossible

This is the structural problem in the plan.

Two facts combine badly:

- Section 4 makes the runtime a **fingerprint digest of the native build**. Every native build produces a new runtime.
- The lane's runtime is read off the bundle: `Bundle.runtimeVersion` is a column
  ([schema.prisma:431](../../packages/console/prisma/schema.prisma)), every lane lookup filters through the relation
  (`bundle: { is: { runtimeVersion } }` — [releases.ts:388-393](../../packages/console/lib/services/releases.ts),
  [manifest-files.ts:170-178](../../packages/console/lib/manifest-files.ts)), and the plan keeps bundle uniqueness at
  `(appId, platform, version)`.

Now take the most ordinary situation in mobile: **a phased App Store rollout**. Build N-1 and build N are both live for
several days. They have different fingerprints, therefore two runtimes, therefore two lanes. A JavaScript hotfix is
compatible with both. Under the plan you cannot publish it to both:

- One bundle row carries exactly one runtime, so it can only ever feed one lane.
- Producing a second bundle for the second runtime requires a different `version`, because uniqueness is
  `(appId, platform, version)` — so you get `1.4.2-rtA` / `1.4.2-rtB`, the exact version suffixing the plan says it
  avoids ("No extra app IDs or platform suffixes in user-facing versions are required", section 12).
- You also upload, store and bill the same bytes twice, and analytics splits one logical release across two bundle IDs.

The same shape recurs for anyone supporting more than one live app version, which is everyone with an Android staged
rollout, a slow-updating enterprise fleet, or a beta channel one native build ahead of production.

**Fix: put the lane on the release, not the bundle.** Add two immutable columns to `Release`:

```prisma
model Release {
  platform       BundleTarget   // copied from bundle at creation, immutable
  runtimeVersion String?        // the lane this release serves
  @@index([appId, channel, platform, runtimeVersion, revertedAt, promotedAt(sort: Desc)])
}
```

- `Bundle.runtimeVersion` keeps its meaning: *the runtime this artifact was built against* (provenance).
- `Release.runtimeVersion` means: *the lane this artifact is served to*. Default equal to the bundle's.
- One bundle → N releases across N runtime lanes. No duplicate uploads, no version suffixes, one bundle ID in analytics.
  The plan already accepts one-bundle-many-releases for channels ("A bundle may have multiple releases, for example to
  beta and production channels"); this is the same relationship applied to the other lane axis.

This change pays for itself three times over:

1. **It fixes the multi-runtime publish**, above.
2. **It fixes lane-lookup performance.** `findCurrentRelease` filters through the bundle relation, so Postgres cannot use
   a composite index for the lane; the existing indexes are `[appId, channel, promotedAt]` only (schema.prisma:468-470).
   That is on the hot path of every publish, revert, auto-revert scan and manifest rebuild, and section 4 is about to
   multiply lane count by the number of native builds ever shipped. Denormalising is safe: production code never mutates
   a bundle row (the only `bundle.update` calls in the repo are in
   [releases.integration.test.ts:160](../../packages/console/lib/services/releases.integration.test.ts)).
3. **It removes the descriptor/manifest conflict.** Section 3 requires *"exact agreement on app framework, platform, and
   runtime between its native configuration, signed manifest, and descriptor"*. That constraint is what forces one
   artifact per runtime. Relax it to: the **manifest's** runtime must equal the device's runtime (authoritative, signed),
   the **descriptor's** `platform` and `bundleFormat` must match, and the descriptor's `builtForRuntime` is recorded for
   provenance and shown in the console. Safety is unchanged — the signed lane still gates delivery — and one artifact can
   legitimately serve several lanes.

**Guard rail, and a good use of a tool the plan already pins.** Fanning a bundle into a runtime it wasn't built for must
be a deliberate act, not a flag. `@expo/fingerprint` emits per-source hashes, so the CLI can *diff* two build records and
show precisely which inputs changed between runtime A and runtime B. Default to blocking when the diff touches native
modules, autolinking, entitlements or codegen; allow it when the diff is confined to inputs with no JS-visible surface,
with the diff printed in the receipt and stored on the release. That is a better answer than a `--force` flag, and it is
a feature no competitor has: *"this fix is safe for both of your live builds, and here is why."*

**Operator ergonomics for lane explosion.** With fingerprint runtimes, "which lanes matter?" becomes the daily question.
The events table already carries `runtime_version`
([device_events_raw.datasource](../../tinybird/datasources/device_events_raw.datasource)), so the console can rank live
runtimes by active device share and offer `otakit release --runtimes live` to fan a JS fix out to every runtime holding
more than *n* % of checks. Without something like this, the fingerprint policy is technically correct and operationally
miserable.

**Also make the runtime policy explicit.** Fingerprint should be the default, not the only option. Expo ships
`appVersion` / `sdkVersion` / `fingerprint` policies for a reason. Record the chosen policy on the app so the console can
explain lane behaviour, and so a team that deliberately wants coarse lanes isn't forced to fork the tooling.

## 4. Put the platform inside the manifest, not in the path

The plan gives each platform its own manifest object and then needs a precedence rule to make Capacitor work:
*"Request the actual OS target first; only 404/204 permits checking `cross`."* That means **every existing Capacitor
install performs two CDN requests per check forever**, since almost no Capacitor app will ever publish an OS-specific
bundle. It also creates ordering rules, an extra namespace to purge, extra dashboard states, and an explicit disclaimer
that cross-platform publication is not atomic.

The alternative: **one manifest per `(app, channel, runtime)` containing a target map.**

```jsonc
{
  "schemaVersion": 3,
  "framework": "react-native",
  "targets": {
    "ios":     { "version": "20260910.1", "sha256": "…", "releaseId": "…", … },
    "android": { "version": "20260910.1", "sha256": "…", "releaseId": "…", … }
  },
  "signature": { … }   // one ES256 signature over the whole canonical document
}
```

The client selects `targets[actualOS] ?? targets.cross`. What this buys:

- **One request, no 404 dance, no precedence rules.** Legacy v2 clients keep their unchanged legacy path, so nothing
  regresses for them.
- **Cross-platform publication becomes atomic for free.** One object write flips both platforms together, which is the
  release story the plan wants to tell in the console. The current design has to disclaim it.
- **A third fewer objects to write and purge** per publication, which matters because `syncManifestFileForLane` purges
  on every write and `restoreManifestFilesForApp` loops sequentially.
- **Target confusion becomes unrepresentable.** One signature covers both entries, so an iOS manifest can never be
  replayed into the Android path — the plan needs the path-vs-payload comparison rule to achieve the same thing.

Costs, stated honestly: an Android device re-fetches a 400-byte manifest when only iOS published (irrelevant at 60 s
client / 300 s edge caching), and per-platform publish becomes a read-modify-write. The latter is already how the code
works — `syncManifestFileForLane` rebuilds the lane from the database under the advisory lane lock
([releases.ts:186-193](../../packages/console/lib/services/releases.ts)), so it is a full rebuild, not a patch, and
concurrent publishes are already serialised.

If you keep per-platform paths anyway, at minimum drop the Capacitor `cross` precedence feature (see section 6) so the
double fetch never ships.

## 5. Smaller defects, each verified in the source

**5.1 The iOS `/var` bug is still latent in the ZIP path, and RN is where it bites.**
`DeltaAssembler` was fixed by resolving symlinks once on the base
([DeltaAssembler.swift:210-215](../../packages/capacitor-plugin/ios/Sources/UpdaterPlugin/DeltaAssembler.swift)).
`ZipUtils` still uses `standardizedFileURL` on both sides
([ZipUtils.swift:74, 118-122](../../packages/capacitor-plugin/ios/Sources/UpdaterPlugin/ZipUtils.swift)) and extracts
into `fileManager.temporaryDirectory`, i.e. `/var/folders/…`
([UpdaterPlugin.swift:748](../../packages/capacitor-plugin/ios/Sources/UpdaterPlugin/UpdaterPlugin.swift)). It survives
today only because `validateEntries` runs **before** `createDirectory` (ZipUtils.swift:45-50) — `standardizedFileURL`
resolves `/var` only for a path that exists, so both sides currently come out unresolved. That is an undocumented
ordering invariant guarding a bug that already shipped once in 2.3.0. The RN plan reshapes exactly this code path
("extract into a new private directory; validate descriptor and entrypoint", section 8), and adding a descriptor read
before validation reintroduces the incident. Two actions: use `resolvingSymlinksInPath()` on the base in `ZipUtils` now,
and make canonical-path handling a rule of the extracted shared native package rather than a per-call-site habit.

This matters more for RN than for Capacitor: RN receives the artifact directory as a `file://` source URL and resolves
every asset relative to it. A `/var` vs `/private/var` discrepancy between what OtaKit hands to RN and what the platform
reports back breaks asset resolution, not just a containment check. Add a fixture with a bundle staged through the temp
directory and an image resolved from a `require()`.

**5.2 Delta path validation accepts collisions that only collide on one OS.**
`isValidDeltaPath` ([delta-files.ts:41-62](../../packages/console/lib/delta-files.ts)) rejects traversal, absolute paths,
backslashes and reserved names, and `parseDeltaFiles` rejects exact duplicates — but not paths differing only by **case**
or by **Unicode normalisation**. Android is case-sensitive and normalisation-preserving; iOS/APFS is case-insensitive and
normalisation-insensitive. Two entries like `Icons/Back.png` and `icons/back.png`, or an NFC/NFD pair of `café.ttf`,
assemble into two files on Android and one on iOS. The canonical file-list hash is computed over declared paths, so the
device's inventory silently disagrees with the signed identity. Capacitor web bundles rarely produce these; RN asset
directories with designer-named images and fonts do. Reject at publish time — case-folded and NFC-normalised uniqueness —
so the artifact can never be created, rather than relying on the plan's native-side rejection (section 8), which turns a
publish-time error into a fleet-wide download failure.

**5.3 The finalize conflict path can hand back the wrong bundle.**
The plan already flags this; here is the exact shape. On `P2002` the route looks up `(appId, version)` and returns that
bundle with a 200, without comparing hash, size, runtime, strategy or encryption
([finalize/route.ts:170-200](../../packages/console/app/api/v1/apps/[appId]/bundles/finalize/route.ts)). A CLI retry
after a version was reused therefore reports success for bytes the server never received. Compare the full expected
descriptor before returning an existing row. Related: finalize verifies **size only**, never the declared SHA-256
(`inspectUploadedObject`, route.ts:97-115). The signature is computed over `session.expectedSha256`, so a mismatch is
caught on-device — which means it manifests as a fleet-wide `download_error` instead of an upload error. Cheap fix:
compare the storage provider's checksum at finalize.

**5.4 Adding platform to the idempotency request hash is unnecessary and dangerous.**
Section 2 says *"New targeting requests include platform in canonical hashes and per-target keys."* Look at what the hash
actually covers: publish keys on `bundleId` ([releases.ts:541-551](../../packages/console/lib/services/releases.ts)),
revert keys on `releaseId` (releases.ts:926-933). Both already determine the platform uniquely. Adding a `platform` key
changes `stableHash` output for every request and risks breaking replay of stored legacy mutations
(`assertIdempotencyHash`, releases.ts:227-234). Leave the hashes alone. If a platform ever must be included, pass
`undefined` for the legacy default — `JSON.stringify` drops undefined keys, so legacy hashes stay byte-identical.

**5.5 Don't overload the `Platform` enum.**
The plan extends the database platform enum with `cross`, then has to add a rule that a device may never report `cross`.
`enum Platform` in schema.prisma:10-13 is currently **not referenced by any model** — it is dead. Define a separate
`BundleTarget { ios, android, cross }` for artifacts and leave device platform alone. Same migration cost, no
cross-contamination rule to enforce, and the ingest worker's `VALID_PLATFORMS` stays honest by construction
([ingest/src/index.ts:60](../../packages/ingest/src/index.ts)).

**5.6 Quarantine-after-one-strike contradicts the plan's own reasoning.**
Section 7 says *"A kill before readiness is conservatively an unsuccessful trial, not proof that the OTA caused a
crash"* — and then treats it identically to a crash: quarantined for that runtime, unretryable, *"A corrected update has
a new artifact identity."* So a user who swipes the app away during the readiness window loses that release until the
team publishes a new version. For a weekly release cadence that is a week of stale code from one unlucky gesture, and it
is invisible in telemetry (it emits `rollback`, inflating the auto-revert numerator with a non-failure). Split the
policy: **one strike** when a native exception hook actually fired, **two strikes** when the process merely disappeared
without an error signal. Record which case occurred in the state snapshot; it costs one enum field.

**5.7 One hosted signing key is embedded, with a one-year manifest TTL.**
`HostedManifestKeys.defaults` holds exactly one key
([HostedManifestKeys.swift:5-14](../../packages/capacitor-plugin/ios/Sources/UpdaterPlugin/HostedManifestKeys.swift)).
Rotation therefore requires a store release from every customer. The RN plugin is a fresh binary contract — ship it with
a current key **and a pre-generated successor** in the trust list from day one, and document the rotation window in terms
of store-build adoption. Retrofitting a second key later has the same cost as the incident it is meant to prevent.

**5.8 Where downloaded content lives.**
Section 7 says to keep everything in app-private non-cache storage so eviction cannot remove the selected bundle. Correct
for the *assembled* directories (active, last-good, staged) — but the content-addressed file cache
(`otakit_files/<sha256>`, [BundleStore.swift:44-58](../../packages/capacitor-plugin/ios/Sources/UpdaterPlugin/BundleStore.swift))
is purely re-derivable and `ensureCached` already handles a miss. On a 50 MB-asset RN app, keeping it in Application
Support permanently inflates reported app storage across current + fallback + staged + cache. Split by re-derivability:
assembled directories in Application Support, the shared file cache in Caches. Free footprint reduction, no reliability
cost.

## 6. What I would cut from v1

The plan is a single production release covering an own native updater on two platforms, Expo host adapters, Expo DOM,
a Constants facade, fingerprint build records, a v3 protocol, a backend migration, Capacitor per-OS targeting, and a
baseline workflow. The README's own estimate for just the native updater is 16–28 engineer-weeks. Three of these are not
load-bearing for the first RN customer:

**6.1 Capacitor per-OS bundles.** Nothing in the RN work needs it. It brings the `cross` enum value into the device-facing
enum, the OS-then-cross precedence rules, a second CDN request per check for the entire existing Capacitor fleet, an
extra namespace, extra dashboard states, and a block of the acceptance matrix. Backfill Capacitor to `cross`, make
`cross` a backfill-only value, and ship OS-specific Capacitor targeting later if a customer asks. This removes the
largest source of migration risk to the revenue-generating product.

**6.2 Expo DOM components.** This is the most fragile part of the design — it requires intercepting a *relative internal
import* inside the `expo` package (`expo/src/dom/base.ts`) by resolved file identity, and that breaks on any SDK refactor.
It is also used by a small minority of Expo apps. Ship v1 with `doctor` detecting `'use dom'` and refusing to publish
with a clear message, and add DOM when a paying pilot needs it. The Constants facade should stay — `extra` changes are
routine, the interception is at the package entry point, and the probes already exercise it.

**6.3 Binary-patch anxiety.** Section 8 is right that per-file deltas are enough to start. Keep it and add patches later
(section 7.3 below), but don't let the absence of patching gate v1.

## 7. What is missing, and would decide a pilot

**7.1 Staged rollout — and OtaKit can do it better than every competitor listed.**
The plan has auto-revert but no rollout, so a bad release reaches 100 % of devices before the revert fires. Every
competitor in the README ships percentage rollouts using a **server in the request path**. OtaKit's manifest is a static
signed object, and that turns out to be an advantage: put the rollout in the signed payload and evaluate it on-device.

```jsonc
"rollout": { "percent": 5, "salt": "<per-release random>" }
```

The device computes `H(salt ‖ installId) mod 100 < percent`. Properties that fall out for free: cohorts are stable across
checks; raising the percentage is monotone (the same hash, a higher threshold, so the new cohort is a superset — nobody
is ever un-updated); it works offline; it costs zero server requests; and it is covered by the existing ES256 signature,
so it cannot be stripped. It is advisory — a modified client can ignore it — which is exactly the right threat model for
a rollout. Roughly two days of work on each side.

Paired with the existing auto-revert (`rollbacks / (applied + rollbacks)`,
[auto-revert.ts:39-52](../../packages/console/lib/auto-revert.ts)), this becomes **canary + auto-halt**: hold at 5 %,
watch the health ratio, expand or stop. That is the story that sells an OTA service to a team that has been burned, and
it reuses machinery that already exists.

**7.2 A per-install identifier.** The event schema has no device or install identity
([device_events_raw.datasource](../../tinybird/datasources/device_events_raw.datasource)), and billing deduplicates on
client-generated `event_id` via `uniqExact`
([organization_download_counts.pipe](../../tinybird/endpoints/organization_download_counts.pipe)). Three things are
impossible without an install id: stable rollout cohorts (7.1), MAU figures comparable to the EAS/Revopush pricing the
README models, and any real adoption curve for a release. A random app-scoped UUID regenerated on reinstall carries no
PII. The Tinybird schema change is additive and is far cheaper now than after RN ships.

**7.3 Hermes bundle patching, expressed in the existing delta model.** For a typical RN app the JS bundle dominates and
changes every release, so per-file deltas reuse almost nothing and every release ships full. Expo enables Hermes diffing
by default in SDK 56; the comparison will be made. The existing content-addressed model extends to it without a protocol
redesign — add an optional patch reference to a file entry:

```jsonc
{ "path": "index.bundle", "sha256": "<to>", "size": 8123456,
  "patch": { "from": "<sha256 of previous>", "algo": "zstd-patch-from",
             "url": "…/patches/{appId}/{from}-{to}", "sha256": "…", "size": 210432 } }
```

The client already holds the previous bundle's `index.bundle` in the content-addressed cache, and it already verifies the
reconstructed file against `sha256`, so the trust model is unchanged: a bad patch fails the existing hash check. Patch
objects are immutable and content-addressed like everything else, generated by a background worker for the previous N
releases in the lane, absent → fall back to the full file. `zstd --patch-from` is adequate and far cheaper to run than
bsdiff.

**7.4 Source maps that reach the crash reporter.** Section 3 stores maps privately, keyed by artifact identity, and stops
there. Symbolicating a Hermes stack trace from an OTA bundle is one of the top practical pains in RN OTA, and it is a
cheap wedge: emit a stable `debugId` per artifact, have `otakit export` optionally upload to Sentry/Bugsnag under a
release name derived from the OtaKit release ID, and expose a maps-by-artifact endpoint for anything else. Small work,
disproportionate perceived value, directly comparable to what EAS does.

**7.5 Deferred activation needs to be visible.** Section 6 latches automatic-reload deferral for the lifetime of any host
that has run background work. On Android a process can live for days, and an app with push handlers or geofencing may run
headless work constantly — such an app could effectively never auto-apply, while the console shows downloads and no
`applied` events, i.e. exactly the signature of a broken release. Two mitigations: latch on *active* tasks plus a grace
window rather than for the host's lifetime, and surface deferral counts. The `detail` field is 500 characters
([ingest/src/index.ts:167](../../packages/ingest/src/index.ts)) and can carry a structured reason code on existing
actions without touching the schema; if a fifth action is acceptable, `activation_deferred` needs an ingest allow-list
change and a pipe, but no datasource migration. Note also that deferred activation drags out the auto-revert denominator,
so the RN defaults for `autoRevertMinSample` (50) and the 24-hour window should be re-derived, not inherited.

**7.6 `notifyAppReady()` is the adoption foot-gun.** Explicit readiness is the right contract, but a team that forgets the
call ships a release that rolls back on every device *and* trips auto-revert. `doctor` string-matching
(`findNotifyAppReady`, [project-inspect.ts:26-63](../../packages/cli/src/lib/project-inspect.ts)) cannot prove it runs.
Make the missing call a **hard failure** of `export`, not a warning; ship a documented one-line gate component for the
common case; and rely on 7.1 so the first release to a lane reaches 1 % of devices before anyone finds out.

## 8. On the go-to-market decision the plan reversed

The architecture plan supersedes the README's Expo-adapter recommendation and builds an own updater. For the *product*
that is the right call: the plan's argument about owning the update engine, readiness contract and rollback policy is
sound, and reusing `expo-updates` would import a readiness policy the plan explicitly rejects.

But the adapter's value was never the runtime — it was **trialability**. With an own updater, evaluating OtaKit requires
installing a native plugin, producing a build record and shipping a store binary. The README's commercial gate asks for
three paid pilots; that gate is being asked to clear a store-review-shaped obstacle. A thin, read-only Expo-protocol
endpoint over the same per-platform artifacts would let an existing Expo team point a development build at OtaKit and see
a real update the same afternoon. It is optional, it is deferrable, and it should be costed against the funnel rather
than against the runtime.

Related and free: the static-manifest architecture is the sharpest technical difference from every competitor in the
README — no server in the device path, so update checks are unmetered and unbounded, the whole delivery plane is a bucket
plus a CDN, and a control-plane outage cannot break customer apps. That also makes a "manifests in your own bucket"
deployment nearly trivial, which is precisely what the README's "teams requiring their own infrastructure" segment buys.
The plan treats this as an implementation detail. It is the positioning.

## 9. Security note on the existing product, amplified by this plan

Ingest authenticates with nothing but an `X-App-Id` header
([ingest/src/index.ts:184-190](../../packages/ingest/src/index.ts)). The app ID and the release ID are both published in
the public manifest ([manifest-files.ts:93-104](../../packages/console/lib/manifest-files.ts)). Therefore anyone who can
read a customer's manifest can:

- forge `rollback` events until `shouldAutoRevert` fires (defaults: 20 %, 50 samples) and **revert a competitor's release
  at will**, repeatedly;
- forge `downloaded` events with fresh UUIDs and **inflate that organisation's bill**, since billing counts
  `uniqExact(event_id)`;
- exhaust the per-app ingest rate limit and suppress the customer's real telemetry.

This is live today, not a consequence of the RN plan — but the plan doubles down on the analytics contract, adds a
retrying outbox, and makes auto-revert the safety mechanism for a much larger blast radius. Worth fixing alongside:
an app-scoped ingest key embedded in the binary (rotatable, raises the bar substantially), per-app-per-release rate
caps, and an auto-revert plausibility check — require rollbacks from a plausible spread of `native_build` values and a
sane ratio against `downloaded` before acting. The install id from 7.2 makes all three materially stronger.

## 10. Revised sequence

Ordering by risk retired per week rather than by layer.

| # | Work | Why here |
| - | ---- | -------- |
| 1 | Bare RN + Expo release fixtures: prepared local artifact, host reload, early bootstrap binding, headless distinction | Unchanged from the plan — this is the real technical risk and it must come first |
| 2 | `Release.platform` + `Release.runtimeVersion`, `BundleTarget` enum, `manifests/{appId}/v3/…` layout, embedded baseline identity | Sections 1–3 and 5.5; all four are schema/path decisions that are expensive to change after the first RN customer |
| 3 | v3 manifest with a target map and a signed rollout block; Capacitor v2 legacy path untouched | Sections 4 and 7.1 — the signed payload is the thing you cannot renegotiate later |
| 4 | Build records, exporter, CLI branch, fingerprint diff gate, baseline capture at native build time | Section 3's guard rail plus finding 1's supporting detail |
| 5 | Recovery, policies, outbox, install id, revert, auto-revert re-tuning | Sections 5.6, 7.2, 7.5 |
| 6 | Packaging, migration automation, docs, full acceptance matrix | Unchanged |

Deferred out of v1: Capacitor per-OS targeting, Expo DOM, Hermes patching, the optional Expo-protocol endpoint.

## Confidence

| Finding | Confidence | Basis |
| ------- | ---------- | ----- |
| Baseline release causes a full redundant download (§1) | High | `doesBundleMatchLatest` and the builtin record read directly |
| v3 path breaks usage-block and app-delete sweeps (§2) | High | Prefix construction and both call sites read directly |
| One bundle cannot serve two live runtimes (§3) | High | Schema uniqueness plus every lane query read directly |
| Manifest target map is the better layout (§4) | Moderate | Design judgement; the cost side is measured, the benefit side is not |
| ZIP `/var` latency bug is latent, not live (§5.1) | Moderate | Ordering invariant inferred from the fixed delta path; reproduce on a device before acting |
| Ingest forgery enables forced reverts and bill inflation (§9) | High | No authentication in the worker; release ID public in the manifest |
| Rollout/install-id absence is what blocks pilots (§7) | Low | A commercial hypothesis, not a measured one |
