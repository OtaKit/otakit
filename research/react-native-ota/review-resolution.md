# Delivery review resolution

Date: 2026-09-11. This resolves the five delivery questions discussed after [plan-review.md](plan-review.md). The [architecture](architecture.md) is the current implementation reference; the review remains an unchanged record of the earlier design. This revision changes planning documents and adds executable design examples, not a production RN implementation.

## Customer workflow

**One OtaKit app, one version, one publication action.** Build/export prepares the necessary variants; upload/publish consumes the resulting receipt. A version such as `1.4.2` can include iOS and Android, plus two iOS runtimes when customers support older and newer native builds. The UI uses platform and store-build labels; exact runtime hashes are generated and kept in details. Each device requests only its matching variant.

Capacitor keeps its existing shared web bundle, legacy manifest URL, v2 signature, and one check request. The RN release adds no per-OS Capacitor feature or required Capacitor client upgrade. Expo host/DOM/config support and explicit OtaKit readiness retain the previously selected scope.

## Decisions

| Review question                                    | Resolution                                                                                                                                                 | Why this is the smaller complete solution                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline is downloaded even though it is installed | Give every RN payload a signed `contentHash`; package its exact embedded value in a native receipt; recognize embedded content before starting a transfer. | Reuses the existing canonical delta file-list hash. Works across ZIP compression/encryption; no reset directive or preallocated release ID.        |
| v3 is outside app-prefix cleanup                   | Use `manifests/{appId}/v3/{platform}/{channel}/{runtime}/manifest.json`.                                                                                   | The existing app prefix covers both protocols. Restoration selects one writer per framework.                                                       |
| One version cannot cover several native runtimes   | RN uniqueness includes app, platform, runtime and version. Each variant retains exact native/manifest/descriptor agreement.                                | A display version can group different exports without claiming a fingerprint diff proves compatibility.                                            |
| Release lane lookup requires a bundle join         | Persist immutable platform/runtime copied from the chosen bundle and index the full release lane.                                                          | Improves lookup without allowing runtime overrides or changing a bundle's meaning.                                                                 |
| Put both platforms in one manifest                 | Keep one small manifest for each exact platform/runtime; group variants in the CLI/dashboard.                                                              | The runtime digests normally differ by OS, so the proposed target map would still use separate objects. No false simultaneous-publication promise. |
| Filenames can collide during build/install         | Validate the entire RN path tree at export, declared-inventory upload validation, and native extraction.                                                   | Catches Unicode aliases, portable case aliases, parent-directory spelling conflicts and reserved metadata aliases before normal publication.       |

`contentHash` covers plaintext payload file paths and contents, including the RN descriptor. The native receipt is outside that payload, avoiding a hash cycle. The existing ZIP/delta `sha256` field continues identifying the transferred archive or canonical file list. Native installation verifies both as applicable. For encrypted ZIPs, server validation of the declared inventory does not prove the ciphertext contains those files; CLI and native verification remain necessary.

Matching embedded content already running causes only a durable release/channel association: no download, trial, reload or event. Switching from an OTA to matching embedded content uses the usual activation guard and explicit readiness, with no billable download. A different embedded payload from another store build is an ordinary selected artifact even if its runtime matches; it cannot be replaced with this binary's own differing content.

The baseline archive and embedded identity are fixed by the native build. Upload/publication can happen later, including after an offline store build. First publication establishes the baseline automatically if the lane is empty, using the same concurrency and idempotency rules as ordinary releases. Retries keep completed steps. No publishing credential or release ID needs to be embedded in the application.

Multi-runtime support means the team maintains the relevant native build environments and exports the JS fix for each. The exporter verifies each build record and merges their receipts under one version. It does not make old dependencies compatible by editing a runtime string. A repeated native build with identical inputs reuses its runtime. Current event counts do not establish which store builds are still actively used, so the target matrix comes from configured support/build records rather than an invented “live runtimes” metric.

## Corrections to the review

- The existing builtin matching function checks channel before hash. Embedding only a baseline hash would still miss on a named channel. The new design separates installed content identity from verified publication/channel association.
- iOS distinguishes letter case. It does not distinguish canonically equivalent Unicode filename encodings. Case-alias rejection is a build-portability policy, including common macOS environments. [Apple filename rules](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html)
- A combined target map under a runtime-specific URL does not make different iOS/Android runtime objects publish together. Even a single object would not make every device check or apply at the same instant.
- A signed runtime selection authorizes an update; it does not establish compatibility with a native dependency change. Fingerprint diffs explain changes. Exact validated exports provide this plan's compatibility gate.
- Keep publish/revert request hashes unchanged where bundle/release IDs already identify the target. Separate receipt operation keys distinguish prepared variants; redundant fields need not invalidate old idempotency records.
- The plan already required billing cleanup across namespaces. The app-prefixed path makes that requirement fit the current helper instead of relying on extra namespace enumeration.
- The ZIP `/var` issue was not reproduced by the simple macOS path probe. Canonicalizing an owned staging root once is still the chosen implementation rule, with an iOS device fixture required.

## Scope decisions

Capacitor per-OS delivery and a Capacitor v3 migration are removed from the RN release. Binary patching, arbitrary cross-runtime reuse, percentage rollouts, install analytics and an Expo-protocol server remain separate work. The selected Expo DOM/config support remains subject to its existing acceptance fixtures; it is not silently removed. Native lifecycle, foreground/headless deferral, and the explicit readiness/recovery contract retain their previously reviewed behavior.

The existing ingest trust/billing tradeoff was explicitly accepted in this conversation and is not reopened here. An embedded shared key alone would not establish trustworthy install identity. Other review suggestions about signing-key operations, retry policy, telemetry, cache placement and crash-reporting integrations need their own scoped decisions; this resolution does not mark them implemented or necessary to solve the five delivery questions.

## Checks and implementation acceptance

On September 11, all **15 design checks passed** using Python's Unicode 13.0.0 database. Documentation formatting and local-link checks also passed. These results apply to the executable examples below, not to a completed native updater.

Run the standalone model:

```sh
python3 research/react-native-ota/verify-delivery-plan.py
```

It exercises 15 design cases: version/target uniqueness, copied release targeting, the unchanged Capacitor URL, app-prefix cleanup, content identity across real ZIP compression variants, complete payload hashing, receipt exclusion, baseline selection, guard ordering, malformed targets, failed-publication quarantine, path-tree collisions, and retry conflicts. Its signature-validity flag is an assumption; it does not implement cryptographic verification. Its Unicode behavior reports the Python runtime's database version; production must pin consistent normalization/case-fold rules and run shared vectors on every implementation.

The existing [25 RN/Expo probes](integration-verification.md) verify a different boundary: pinned upstream source and small JavaScript adapters. Neither suite proves native app behavior, SQL migrations, concurrent publication against storage/CDN, or SDK installation.

Architecture section 13 now requires real integration tests for the corrected cases: named-channel baseline detection; encrypted baseline rollback with zero transfer; two native runtimes sharing one version; empty-lane baseline races; release/bundle targeting invariants; legacy nullable-runtime uniqueness and idempotency replay; both-family cleanup; Unicode/case/tree collisions; and iOS temp-directory extraction with real asset loading. Native release fixtures remain the first implementation milestone.
