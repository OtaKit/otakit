# Deep review of the React Native OTA production plan

September 11, 2026. Reviewed the current [architecture](architecture.md), [delivery resolution](review-resolution.md), earlier [review](plan-review.md), verification scripts, and the relevant OtaKit implementation at `86acc2eee590204307a89e3c8fa130fe021456da`. This review evaluates the revised production design. The original Expo-server recommendation is superseded.

**The overall design is viable, but two publication guarantees need stronger contracts before backend implementation.** Baseline initialization is assigned to a CLI workflow although other publication entry points remain available. Durable publication receipts also promise more retry safety than the inherited idempotency service provides. Three additional findings concern baseline adoption and asset validation. These are gaps in the proposed RN design or assumptions about reused code; there is no shipped RN implementation to diagnose.

| Priority | Finding                                                               | Consequence                                                           |
| -------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| P1       | Enforce baseline initialization through every publication entry point | Reverting a first OTA can leave confirmed devices running it          |
| P1       | Bound retries by actor identity and idempotency retention             | A retry can republish an explicitly reverted update                   |
| P2       | Separate baseline content adoption from exact upload replay           | An abandoned encrypted baseline upload can obstruct first publication |
| P2       | Validate asset destinations before the exporter copies files          | Distinct images can silently become the same asset                    |
| P2       | Apply filename limits to encoded bytes and individual components      | A valid macOS export can fail installation on Android                 |

P1 means settle the contract before implementing the affected publication workflow. P2 means include the correction before RN release acceptance. Neither category means existing Capacitor clients suddenly acquired an RN defect.

**1. P1 — A CLI-only baseline workflow does not establish the required server invariant.**

The plan requires a known-good baseline before the first OTA in every lane, then assigns baseline upload and publication to the CLI. It also preserves publication by bundle ID, dashboard actions, and MCP workflows. The proposed data model does not identify a bundle's baseline or carry a server-readable prepared baseline relationship. See [baseline initialization](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:434), [bundle-ID publication](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:127), and [dashboard publication](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:537).

Consider an ordinary supported workflow: export an RN artifact, upload it without publishing, then publish it from the dashboard into an empty production lane. Nothing in the specified shared-service validation requires that the archived embedded baseline also exists or has been published. The dashboard cannot obtain an archive that exists only in the customer's CI artifacts.

The inherited service permits this exact shape. [Publication](/Users/gergomiklos/otakit/packages/console/lib/services/releases.ts:622) creates the first release with `previousBundleId: null`. [Reversion](/Users/gergomiklos/otakit/packages/console/lib/services/releases.ts:1005) can consequently produce `currentRelease: null`, and [manifest synchronization](/Users/gergomiklos/otakit/packages/console/lib/manifest-files.ts:204) deletes the manifest. Under the new client's deliberate [missing-manifest behavior](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:455), devices keep their installed safe selection.

This matters when the first OTA passed readiness but has a functional defect discovered later. Native trial recovery helps devices that failed readiness; it does not make a missing server rollback target work for devices that already confirmed the update.

The review probe executes the real current release service with a sequential database fake: first publication succeeds, and its revert returns no current release. The RN extension must add the missing invariant; merely propagating platform/runtime fields preserves the inherited behavior.

**Required change:** make baseline availability part of a prepared RN publication understood by the shared service. Upload the necessary baseline with the prepared target, retain its validated relationship, and either initialize the lane there or reject a first OTA without it. Apply the same rule to HTTP, dashboard, CLI and MCP entry points. A single lane transaction can establish baseline history and the requested OTA while publishing only the final manifest; this would also avoid exposing an intermediate baseline unnecessarily. This does not require a general native-build registry.

**Acceptance:** exercise upload-then-dashboard publication, direct HTTP publication and MCP publication into empty lanes. Every accepted first OTA must have an actual rollback target. A missing baseline must fail before changing the current release. Include named channels and two store binaries with different embedded content in the same runtime.

**2. P1 — An uncertain retry can resurrect an explicitly reverted release.**

The plan says a durable receipt resumes unfinished work without replacing a lane someone else changed. It retains the existing request hashes and per-variant operation keys. See [grouped publication](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:131) and [receipt retries](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:539).

The existing server's guarantee has two boundaries: mutation records expire after [seven days](/Users/gergomiklos/otakit/packages/console/lib/services/releases.ts:27), and lookup includes the [actor identity](/Users/gergomiklos/otakit/packages/console/lib/services/releases.ts:555). Expired published operations are [discarded before replay](/Users/gergomiklos/otakit/packages/console/lib/services/releases.ts:571). An API-key rotation changes that actor. The receipt design does not specify a response to either boundary.

The failure sequence is:

1. The current release is A. A publisher records its intent to publish B with `expectedCurrentReleaseId=A` and operation key K.
2. The server commits B, but the response is lost before the CLI records completion.
3. An operator reverts B. The existing revert operation makes the original release A current again.
4. The CLI retries K after its mutation record expires, or under a different API key.
5. There is no replay record in the lookup scope. The current-release check passes because A is current again. The server creates a new publication of B.

Checking the current release ID cannot distinguish an untouched lane from one that went A → B → A. A durable local receipt cannot know an unacknowledged server result by itself.

The review probes execute the actual publish/revert functions and reproduce both the expired-record and changed-actor cases. A control probe verifies that an unexpired same-actor retry correctly replays the old operation without republishing. This is a limit of the reused contract, rather than a claim that all retries are broken.

**Required change:** record the initiating actor, request time, exact arguments and uncertain completion state before sending each operation. Automatic retry must remain within the proven replay scope. If that scope is lost, reconcile through a durable operation lookup or stop for a new reviewed publication; do not treat matching `expectedCurrentReleaseId` as proof that the previous attempt did not commit. Supporting automatic recovery across arbitrary key rotation and retention expiry needs a stronger durable operation identity. Preserve legacy request-hash bytes while choosing the RN behavior explicitly.

**Acceptance:** lose the successful response, revert the release, then retry with the same actor, a rotated key, and an expired mutation. The latter two must not create another publication implicitly. Include a process crash between receiving a response and persisting it.

**3. P2 — Baseline content reuse needs a separate operation from exact transfer replay.**

The new content identity correctly survives compression and encryption changes. However, [finalization conflict checking](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:157) and [receipt validation](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:539) require transport hash, size, strategy and encryption to agree. The [baseline procedure](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:438) describes reusing an already established baseline release, but does not resolve an equivalent uploaded baseline with no release yet.

Two CI jobs can start from the exact same archived baseline and prepare encryption independently. The existing [encryptor](/Users/gergomiklos/otakit/packages/cli/src/lib/crypto.ts:61) generates a fresh DEK and nonces on each invocation. The review probe confirms that even with the same input and key, transport hashes and envelopes differ. This is correct encryption behavior.

Suppose job A finalizes its baseline and crashes before publishing it. The lane remains empty, but its `(appId, platform, runtime, version)` bundle key is occupied. Job B's baseline has identical content and different ciphertext. Ordinary initiation conflicts with an existing bundle; the newly specified finalize comparison also refuses to return it as an exact replay. There is no current baseline release for the procedure's existing reuse branch to adopt. Preserving each job's own archive does not solve this cross-job case.

**Required change:** define explicit adoption of an existing baseline by plaintext identity and target, subject to the required encryption/key policy. Resolve its stored bundle and transfer representation, then record that representation in the publication receipt. Keep normal upload retries strict. Do not turn this into a global rule that silently accepts arbitrary same-content transfer changes. Define behavior for finalized-but-unpublished baselines as well as established releases.

**Acceptance:** independently encrypt one archived baseline twice, finalize A, terminate A before release creation, and resume through B. B must safely adopt the approved existing baseline or return a specific actionable conflict. Include mismatched content and disallowed encryption/key policies as rejection cases.

**4. P2 — Post-export path validation misses assets already overwritten by the exporter.**

The plan preserves the project's Metro asset layout and validates the output path tree. That catches ambiguous names still present in the inventory. It cannot detect two source assets that the exporter has already collapsed into one output. See [portable paths](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:172) and [export integration](/Users/gergomiklos/otakit/research/react-native-ota/architecture.md:222).

The published `@expo/cli@57.0.19` Android mapper lowercases the source path, replaces directory separators and removes other characters. With the same source directory and scale, it maps both of these names to the same destination:

```text
assets/icons/log-in.png → drawable-mdpi/icons_login.png
assets/icons/login.png  → drawable-mdpi/icons_login.png
```

These source names have no case or Unicode alias. The review probe executes the published mapper and asset-copy function against two different file contents. Export succeeds and the destination contains the second asset's bytes. The resulting file inventory has one valid path, so checking duplicates, Unicode normalization and `contentHash` afterward cannot recover the lost distinction. The signed artifact can be internally consistent while showing the wrong image.

Evidence: [published mapper](/Users/gergomiklos/otakit-references/react-native-ota/source-snapshots/released-packages/@expo__cli-57.0.19/build/src/export/metroAssetLocalPath.js:116) and [copy destinations](/Users/gergomiklos/otakit-references/react-native-ota/source-snapshots/released-packages/@expo__cli-57.0.19/build/src/export/persistMetroAssets.js:105). Their hashes were independently checked against the integrity-verified [npm tarball](https://registry.npmjs.org/@expo/cli/-/cli-57.0.19.tgz).

**Required change:** validate the source-asset-to-destination mapping before copying, covering every scale and output namespace. Reject conflicting destinations with both original source names in the error. Do not silently rename outputs without changing the matching Metro resolution contract. Keep the existing output-tree validation as the second check.

**Acceptance:** export the two assets above with different bytes. Export must reject them before creating a publishable receipt. Also test directory flattening collisions, ordinary non-colliding names and multiple density variants.

**5. P2 — The filename contract needs component limits in UTF-8 bytes.**

The plan reuses a 512-character path limit and adds Unicode/case collision checks. Neither it nor the [delivery model](/Users/gergomiklos/otakit/research/react-native-ota/verify-delivery-plan.py:25) limits the byte length of an individual filename component.

A filename consisting of 140 `é` characters followed by `.png` contains 144 characters but 284 UTF-8 bytes. The design validator accepts it under `www.bundle/`. This machine's macOS filesystem successfully created and read it, so it can be a real exported public asset, rather than just an invented malformed request. The supported Expo DOM scope preserves public-file names.

Ext4 and F2FS directory entries limit names to 255 bytes. Consequently this accepted asset cannot be installed on Android using either filesystem. That Android result is inferred from the filesystem contracts; this review did not run an Android device. Sources: [ext4 name storage](https://github.com/torvalds/linux/blob/v6.12/fs/ext4/ext4.h#L2157), [F2FS name storage](https://github.com/torvalds/linux/blob/v6.12/include/linux/f2fs_fs.h#L219).

**Required change:** specify a common UTF-8 byte limit for each component and an explicit complete-path budget that accounts for the native staging root. A character count alone is insufficient. Apply the same contract to export, declared upload inventory and native installation. Preserve the existing normalization/case-fold rules separately.

**Acceptance:** test component lengths immediately below, at and above the byte limit, using multibyte names and directory components as well as ASCII. Test complete paths beneath actual iOS/Android staging roots. The current 284-byte example must fail during export.

**What remains sound in the revised plan.**

The previous review's principal delivery changes are incorporated: one app with explicit bundle targets; full platform/runtime lane lookup; app-prefixed v3 cleanup; unchanged Capacitor v2 delivery; separate content and transfer identity; an embedded receipt outside its own hash; and explicit reporting of partial publication. Signing release attribution in v3 and keeping JS-instance context immutable are appropriate boundaries. The RN reload and Expo DOM/Constants source findings survived verification.

This review does not treat accepted scope choices as newly discovered defects. Percentage rollouts, install analytics, binary patches, Expo-protocol hosting and the existing ingest trust model remain outside the selected work. Conservative one-strike quarantine and lifetime headless deferral retain the tradeoffs already recorded in the earlier review.

**Decisions to resolve in the first native fixture.**

The native build record still needs an exact canonical schema and exclusion/normalization rules. In particular, demonstrate stable identity across clean machines and repeated builds, separate store-build labels from compatibility evidence, and prove that changing JS-only Expo config preserves the runtime while changing generated native output does not. The fingerprint documentation describes collection and its limitations; it does not supply OtaKit's complete proposed record. [Expo Fingerprint](https://docs.expo.dev/versions/latest/sdk/fingerprint/)

Also specify what happens when headless work begins after a foreground trial starts and that trial subsequently times out. The background guard prevents reloads that interrupt work, while recovery requests a fallback reload. The plan needs an explicit precedence rule for that transition and a fixture verifying the executing instance, pending recovery, late readiness rejection and single failure outcome. This is an unresolved transition, not a reproduced native failure.

The existing milestone order appropriately puts real native loading, reload and Expo integration first. Add these cases there. The source probes do not implement the native instance binding, Metro interception or WebView lifecycle, and the plan correctly says so. Successful source checks should continue to be reported separately from those acceptance results.

**Verification and reproduction.**

The [review probes](deep-review-probes.mjs) are a reproducible supplement to this document:

```sh
python3 research/react-native-ota/verify-delivery-plan.py
node research/react-native-ota/deep-review-probes.mjs
```

The second command accepts an optional snapshot-directory argument. It otherwise uses the existing sibling `otakit-references/react-native-ota/source-snapshots` directory. It needs the repository's TypeScript dependency, Node 22+ and Python. Temporary asset/encryption fixtures are deleted afterward; it does not use production credentials, a database, a native build or a live service.

| Verification                                                         | Result                                                                    | Boundary                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Existing delivery model                                              | 15 checks passed                                                          | Design examples, including assumed signature validity                                                                              |
| Existing upstream verifier                                           | 25 checks passed; 7 npm tarball integrities and 32 source hashes verified | Source contracts and JavaScript adapter prototypes                                                                                 |
| Review probes                                                        | 7 checks confirmed                                                        | Real service control flow with a sequential database fake; real CLI encryption and Expo asset-copy code; path-model counterexample |
| Additional Expo exporter sources                                     | 2 file hashes verified from the published tarball                         | Mapper and asset persister used in the new counterexample                                                                          |
| Native devices, SQL migration and concurrent storage/CDN publication | Not executed                                                              | Required during implementation                                                                                                     |

The initial direct Node fetch timed out. Repeating the unchanged upstream assertions with `curl` as the fetch transport succeeded against the published artifacts. The committed review script also supports offline replay against the original 32 hashes; that replay alone does not revalidate complete tarball integrity. The service fake is intentionally sequential and is not evidence about PostgreSQL isolation, authorization middleware, transaction rollback or CDN races.

Additional verified SHA-256 values:

```text
@expo/cli@57.0.19 build/src/export/metroAssetLocalPath.js
fb7e2a841313fd622783f622078b314b4320a86bb8729f246a85b415f9036107
@expo/cli@57.0.19 build/src/export/persistMetroAssets.js
a2946ee31207b7016116add39ce8d108722b45bccc0fc4d519488d8a97ef4fc9
```

The architecture, prior reviews and production code remain unchanged. The new files record findings and reproductions for review.
