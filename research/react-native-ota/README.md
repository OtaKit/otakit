# React Native OTA support for OtaKit

**Current implementation direction:** build our own production React Native updater with one OtaKit app per mobile product, `framework` (`capacitor` / `react-native`) on the app, `platform` (`ios` / `android` / `cross`) on each bundle, and each release referencing one bundle. App has no platform field. The subsequent [production architecture plan](architecture.md) is the implementation reference and supersedes the original Expo-adapter/pilot recommendation below. It specifies the targeted backend extensions and migration that preserve existing Capacitor clients.

The RN-specific plan revision is backed by [published-source verification and executable probes](integration-verification.md), covering native launch/reload, headless work, Expo DOM/config adapters, and build compatibility. The [source inventory](integration-sources.json) pins the published artifacts independently of the earlier default-branch checkouts. The September 11 [delivery review resolution](review-resolution.md) adds one-version publishing across platform/runtime variants, exact embedded-baseline recognition, app-prefixed RN manifests and portable filename checks. Capacitor keeps its existing v2/shared-bundle workflow.

**Original research recommendation:** pursue a small Expo-compatible pilot, then expand only if paying customers validate it. Build an OtaKit backend for the existing `expo-updates` client. Start with current Expo projects on iOS and Android; support existing React Native projects that can adopt Expo modules next. Maintaining a separate native updater or promising universal CodePush compatibility would substantially increase the investment.

The technical opportunity is credible: Expo explicitly supports custom update servers, and OtaKit already owns much of the account, release, storage, billing, and operational infrastructure. The commercial opportunity is less certain. Expo has strong distribution, several independent alternatives already exist, and some customers receive OTA capacity inside a subscription they need for builds anyway.[^1][^2][^22][^25]

The evidence supports **high confidence in technical feasibility, moderate confidence in this entry strategy, and low confidence in a precise dollar market size**. Public sources do not establish total React Native OTA spending or OtaKit's likely conversion rate. A 100% confidence claim would be misleading. The scenarios below make those unknowns visible.

## Decision and scope

The proposed product is **one managed and self-hostable release platform for Capacitor and Expo/React Native**, retaining the established runtime for each framework. Its best initial customers are agencies and product teams with multiple apps, organizations seeking control over update infrastructure, and apps with meaningful avoidable OTA bills.

| Decision                                            | Recommendation          | Reason                                                                                             |
| --------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| Add React Native as a product direction             | Conditional yes         | Adjacent buyer, workflow, and infrastructure; much larger ecosystem exposure                       |
| Start with Expo-compatible delivery                 | Yes                     | Existing native client and documented protocol reduce maintenance scope                            |
| Replace `expo-updates` with a new OtaKit native SDK | Defer                   | Would take ownership of startup, filesystem recovery, native integration, and architecture churn   |
| Offer a Hot Updater adapter                         | Reconsider after demand | Useful route for teams that reject Expo dependencies, but adds another protocol and build pipeline |
| Reimplement the complete CodePush service           | Defer                   | Broad migration promise; historical SDK is archived and incompatible with modern architecture      |
| Promise a major new business immediately            | No                      | Paid demand, acquisition cost, support load, and cross-framework demand remain unmeasured          |

Research is current to **September 10, 2026**. OtaKit source was inspected at `39cafb4e115cd8445c9d5e6fe6738a9c4fd2883c`. Nine public repositories were checked out locally; exact commits, licenses, and useful files are recorded in [reference-checkouts.md](reference-checkouts.md) and [reference-checkouts.json](reference-checkouts.json). This is a source and documentation assessment, not a completed native-device integration or production certification.

## How React Native updates actually work

### The two parts of an installed app

A React Native installation contains a compiled native application and a JavaScript application. The native part includes the JavaScript engine, React Native renderer, native modules, permissions, entitlements, and platform configuration. JavaScript describes application logic and the UI rendered through those native capabilities. The app is not a Capacitor WebView loading `index.html`.[^4][^7][^12]

An OTA system replaces the compatible JavaScript bundle and associated assets stored inside the application's writable container. It does not replace the installed native executable. The initial store binary must already contain the updater and the native capabilities the downloaded code will use. A server cannot add an updater to an arbitrary installed app merely by publishing a bundle.[^1][^2]

| Change                                                                           | Technically deliverable OTA?    | Qualification                                                            |
| -------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Fix JavaScript business logic, text, styling, navigation behavior                | Usually                         | Existing native APIs must support the change; store policies still apply |
| Change images or fonts included in the exported update                           | Usually                         | Asset paths, hashes, and runtime asset resolution must agree             |
| Add a JavaScript-only dependency                                                 | Usually                         | It must not introduce a new native dependency indirectly                 |
| Add a camera, payments, or other native SDK                                      | No, if absent from the binary   | Ship a store build containing the native implementation first            |
| Upgrade React Native, Expo native packages, or Hermes                            | Generally requires a new binary | Old and new native runtimes need separate compatibility lanes            |
| Change native permissions, entitlements, app extensions, or compiled native code | No                              | Store build required                                                     |
| Migrate local application data                                                   | Sometimes technically possible  | Rollback may become unsafe even when native compatibility is unchanged   |

This table describes technical capability, not an exemption from app-store rules. In particular, a technically compatible feature change can still be unsuitable for OTA distribution.

### Publishing and installation

The useful end-to-end model is:

```mermaid
sequenceDiagram
    participant CI as Developer / CI
    participant API as OtaKit release API
    participant CDN as Manifest endpoint + asset CDN
    participant Native as expo-updates native client
    participant JS as React Native application
    CI->>CI: Export platform bundles and assets; resolve runtime
    CI->>API: Upload immutable artifacts and publish a release
    API->>CDN: Publish signed manifests and lane selection
    Native->>Native: Select embedded or cached compatible update
    Native->>CDN: Check using platform, runtime, channel
    CDN-->>Native: Manifest or directive
    Native->>CDN: Fetch missing assets / supported patch
    Native->>Native: Verify, persist, stage complete update
    Native->>JS: Launch selected bundle at restart or reload
    Native->>Native: Apply native error-recovery rules if needed
    JS->>API: Report observed launch and application health
```

Publishing is generally a **pull distribution system**: devices discover updates when they check. A published update does not instantly reach an offline or inactive app. A configured startup wait can trade startup latency for freshness; background download followed by activation on a later launch avoids that wait. A deliberate reload can activate an already downloaded update, but restarts application execution and can discard in-memory work.[^4][^40]

Metro and Expo's export tooling produce separate platform outputs. A source tree can be shared while iOS and Android bundles differ because of platform-specific modules and configuration. With Hermes, export can produce engine bytecode rather than plain JavaScript. The compiler must match the engine in the installed binary: a downloaded bytecode file is not portable across arbitrary Hermes versions.[^7][^14]

The updater is responsible for making downloads safe before execution: retain a working embedded update, resolve assets to local files, verify integrity, persist metadata, and avoid launching a partially downloaded update. Source maps should be retained privately for error symbolication and associated with the exact platform and update identity; they are separate from the assets users need to execute the app. The substantial native implementation and tests in Expo demonstrate how much work sits behind a small manifest API.[^38]

### Runtime compatibility

The fundamental release key is **application + platform + runtime version + channel**, with an optional rollout cohort. A marketing version, a Git SHA, and a runtime version describe different things. Two binaries with different native dependencies must not receive the same update merely because both are called version `1.0`.[^5]

For example, a binary containing a payments module at native version A can receive a JavaScript bug fix using its existing API. An update using a method introduced in native version B must target a runtime containing B. The build pipeline must record the runtime of the actual store build, and the publish pipeline must calculate or resolve the corresponding value from the same dependency and configuration inputs.

Expo's fingerprint tooling hashes native-relevant project inputs. It is a strong default, but not proof that every change is safe: ignored inputs, dynamic configuration, environment differences, and raw config-plugin functions can undermine the result. Preserve fingerprint input evidence and native build provenance; treat unknown compatibility as a failed production preflight rather than inventing a runtime value.[^6]

Modern architecture support is mandatory for a new offering. React Native 0.82 and later run exclusively on the New Architecture; Expo SDK 55 and later inherit that requirement. The historical Microsoft CodePush client explicitly says it does not support this architecture. Modern forks may, but that is a property of a particular fork and version.[^12][^21]

### Recovery and rollback are different operations

**Local recovery** happens on one device after a bad launch. Expo's current documented recovery distinguishes errors before first content appears from errors after it has appeared. Early failure may allow a fallback; later failure favors downloading a fix for a subsequent launch. Its error listener has a limited early-life window. This mechanism does not guarantee that users never see a crash.[^8]

**Operator rollback** changes which update the service offers. Expo's normal selection policy compares publication times. Pointing the server back to an old manifest with an old timestamp can leave a device running the newer broken update. The conventional solution is to republish known-good contents with a new update identity and time. Resetting to the binary's embedded bundle uses a separate `rollBackToEmbedded` directive.[^9][^38]

**Fleet rollback** uses aggregate observations to decide whether to stop or reverse a rollout. Its quality depends on the observations: a manifest request proves an update check; an asset request proves attempted transfer; neither proves a completed install or healthy launch. Devices that fail before JavaScript starts are especially easy to miss.

Database and local-state migrations are the important exception to routine rollback. A bundle can be fully compatible with the native runtime yet unable to read data written by the newer bundle. Release guidance therefore needs both a native compatibility check and an explicit assessment of backward-compatible application state. Use expand-and-contract migrations or fix forward where reversal is unsafe.[^8]

### Deltas and current expectations

There are three distinct optimizations: compress transferred content, reuse unchanged assets already on the device, and patch changed files at the byte level. OtaKit's existing `deltas` strategy is a content-addressed file manifest. It does not, by itself, turn a changed large Hermes bundle into a small binary patch.

Expo introduced opt-in Hermes bundle diffing in SDK 55 and enabled it by default in SDK 56. Its service can fall back to full bundles when a patch is unavailable or unhelpful. Patching from the embedded bundle is a separate experimental opt-in, so first-update economics need their own measurement. Hot Updater and Revopush also implement binary diff approaches.[^10][^11][^15][^18]

The checked-out Expo client recognizes patch responses through native download code, validates the base update, and verifies the reconstructed asset. A custom server can initially serve complete assets to these clients; it does not need to manufacture a patch for every request. Later patch support must negotiate capabilities and use the exact supported format, including the relevant HTTP and base-update metadata. A generic compressed archive difference is insufficient.[^38]

## Open-source projects and their relevance

| Project                                | What it provides                                                                                         | License / status at inspected revision                         | Usefulness for OtaKit                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `expo/expo`, especially `expo-updates` | Native client, platform integration, selection, assets, signing, recovery, patch support                 | MIT; actively maintained                                       | Preferred native dependency and behavioral reference                     |
| `expo/custom-expo-updates-server`      | Small TypeScript/Next.js example with export, manifests, assets, and directives                          | MIT; example, explicitly not a production backend              | Best initial protocol walkthrough                                        |
| `gronxb/hot-updater`                   | React Native updater, build/storage/database plugins, console, fingerprints and diffs                    | MIT text plus additional disclaimer; active                    | Best independent native updater and adapter reference                    |
| `mercuretechnologies/xprem`            | Expo-compatible server, channels/branches, rollouts, publishing, dashboard and observability integration | MIT outside `ee/`; enterprise code separately licensed; active | Closest example of the proposed server product                           |
| `vknow360/otaship`                     | Go/Postgres server, Svelte dashboard and CLI using Expo protocol                                         | Apache-2.0; early project                                      | Compact implementation to study and critically review                    |
| `microsoft/code-push-server`           | Historical standalone CodePush management and acquisition service                                        | MIT; archived                                                  | Migration vocabulary, endpoint and rollout reference                     |
| `microsoft/react-native-code-push`     | Historical native SDK                                                                                    | MIT; archived; no New Architecture support                     | Understand legacy integration and recovery contracts                     |
| `revopush/react-native-code-push`      | Maintained CodePush-style client with modern architecture and diffs                                      | MIT client; managed backend is a separate offering             | Shows a practical modern CodePush migration path                         |
| `codemagic-ci-cd/codemagic-patch`      | Native SDK, server, CLI, dashboard, precomputed CDN manifests and patches                                | Restricted Codemagic Server License                            | Architectural comparison; not a permissively reusable competitor backend |

Repository and documentation sources support the descriptions above; a public repository does not establish production quality or that the whole hosted service is open source.[^14][^15][^16][^17][^18][^19][^20][^21][^38]

Codemagic Patch deserves an explicit distinction: the inspected license limits free use to one million monthly requesting devices and restricts competing uses. Its announced future license conversion does not make the current revision unrestricted. Study its delivery design, but do not use its restricted implementation as OtaKit's foundation. For xprem, the open-source boundary is directory-specific, so preserve that boundary when considering reuse.[^19][^16]

### Findings from reading the implementations

The Expo example turns exported platform metadata into a manifest, computes asset metadata, serializes multipart parts, and signs the exact serialized body using RSA-SHA256. It is small enough to understand, but deliberately lacks the production assurances and full operational system a commercial service requires. Its own README says it is a demonstration.[^14]

Hot Updater separates the resolver and native storage layers. Its resolver includes platform, version or fingerprint, channel, minimum/current bundle IDs, and cohort in selection. A subtle finding in the current iOS implementation is that `notifyAppReady()` reads a launch report; native first-content handling marks the pending launch complete. Older tutorials presenting every readiness API as an identical JavaScript confirmation contract are unreliable. This observation is pinned to the inspected source, not generalized to every released version.

OTAShip illustrates why feature checklists need code review. Its inspected manifest cache key includes project, platform, runtime, and channel. A cache hit sends the cached manifest before the rollout-percentage check used on the uncached path. Once an eligible request fills that cache, the code path appears able to serve the update to an otherwise ineligible device. Its download event is also emitted from manifest serving. These are source-level findings, not reproduced live incidents; they identify tests OtaKit must perform rather than a basis for adopting the code unchanged.

The detailed paths and line anchors for these observations are in [the reference guide](reference-checkouts.md). No upstream code was modified, no native reference app was launched, and no vendor production service was tested.

## What changes inside OtaKit

The reusable portion is the product's operational infrastructure: organizations, scoped access, apps, upload sessions, object storage, release history, audit records, idempotent release mutations, dashboard, CLI, and event ingestion. The existing Capacitor runtime remains useful for Capacitor. React Native needs its own artifact and protocol integration.

| Current implementation                                   | React Native gap                                                                 | Proposed change                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Bundle` unique on `(appId, version)`; no platform field | iOS and Android artifacts can share a display version but contain different code | Introduce explicit platform artifacts and a release group                        |
| Runtime optional; lane key is app/channel/runtime        | RN runtime must be resolved and platform-isolated                                | Require runtime for Expo publications; include platform in selection and locking |
| CLI validates a root `index.html`                        | Expo export contains metadata and platform JS/Hermes assets                      | Add an Expo export importer and format-specific validation                       |
| CDN manifest is OtaKit-specific JSON                     | `expo-updates` expects its own headers, structures and directives                | Add an Expo protocol endpoint and serializer                                     |
| Custom ES256 signature over canonical fields             | Expo uses its certificate and manifest-signature contract                        | Add separate Expo signing; preserve the existing format for Capacitor            |
| Revert exposes a previous release manifest               | Old timestamps can fail to displace a cached Expo update                         | Publish a new rollback publication or an embedded-reset directive                |
| File-level deltas require web-compatible content         | RN asset and bytecode formats differ                                             | Reuse storage ideas; add Expo asset metadata and optional binary patch workers   |
| Capacitor configuration and plugin inspection            | Expo apps fail current project inspection                                        | Add framework-aware setup, export, compatibility and MCP context                 |
| `applied` means confirmed Capacitor trial                | Expo launch/recovery semantics differ                                            | Define events and health denominators per runtime                                |

These findings come from the actual schema and implementations: [schema](../../packages/console/prisma/schema.prisma), [manifest publishing](../../packages/console/lib/manifest-files.ts), [signing](../../packages/console/lib/manifest-signing.ts), [release service](../../packages/console/lib/services/releases.ts), [upload validation](../../packages/cli/src/lib/zip.ts), [project inspection](../../packages/cli/src/lib/project-inspect.ts), and [auto-revert](../../packages/console/lib/auto-revert.ts).

One further compatibility gap is significant. The current [native dependency scanner](../../packages/cli/src/lib/native-deps.ts) walks direct dependencies and recognizes a limited set of native file extensions. It does not represent the full React Native native build, including Objective-C/C++, generated code, native project edits, and build configuration. Reusing its verdict as a comprehensive RN safety guarantee would be unsafe. Integrate native build/runtime evidence and Expo fingerprinting instead.

### Proposed architecture

Keep one dashboard and release control service. Introduce an artifact abstraction with framework-specific importers and manifest publishers. A proposed `expo` artifact set contains immutable asset records, a per-platform launch asset, resolved runtime, public Expo config, source provenance, and private source-map references. The proposed names are design suggestions, not existing API contracts.

Separate artifact identity from publication identity. Reuse the same content-addressed bytes across publications; allocate a new per-platform update UUID and monotonic publication time when republishing for rollback. Retried requests with the same idempotency key must retain the same publication. A release group provides one user-facing action while preserving separate platform manifests and a verifiable publication result.

The Expo endpoint should implement version and content negotiation, platform/runtime matching, multipart manifests and directives, structured-field headers, signatures, and correct no-update responses. Existing CDN objects cannot simply be returned unchanged. Start with a small protocol adapter in the API or an edge worker, backed by immutable publication data and cached lane selection.[^3]

The following contract details are especially relevant when turning the design into code. Core protocol fields and commonly used client/service extensions should be distinguished; a channel system and percentage rollouts are product behavior layered on the protocol.

| Wire element                                           | Meaning and implementation consequence                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `expo-protocol-version: 1`                             | Negotiate the supported protocol; reject unsupported representations appropriately                                          |
| `expo-platform: ios` or `android`                      | Select the correct exported platform artifact, even when both have the same runtime string                                  |
| `expo-runtime-version`                                 | Match the installed native runtime; never fall back to an arbitrary latest runtime                                          |
| `expo-channel-name`                                    | Common service convention for a configured release channel; not a substitute for runtime matching                           |
| `expo-current-update-id`, `expo-embedded-update-id`    | Client state used by implementations for no-update decisions, recovery, and embedded rollback                               |
| `Accept` and `Content-Type`                            | A simple JSON manifest and a multipart response have different capabilities; directives need the appropriate representation |
| Manifest `id`, `createdAt`, `runtimeVersion`           | UUID identity, publication time and native compatibility; display-version strings cannot replace these                      |
| `launchAsset`, `assets`                                | Entry-point code plus asset records with keys, URLs, types and integrity information; hash encoding is base64url SHA-256    |
| `expo-manifest-filters`, `expo-server-defined-headers` | Structured-field metadata that can affect subsequent client selection and requests                                          |
| `expo-expect-signature`, `expo-signature`              | Signing negotiation and verification over the serialized manifest or directive body                                         |

The official example provides concrete serialization and asset-hashing code. Implement an empty/no-update response deliberately, distinguish it from service failure, and ensure an unavailable service leaves the device's cached or embedded application runnable. Serving this protocol does not automatically implement the EAS CLI, EAS dashboards, account APIs, or EAS observability ingestion.[^14]

Preserve the CDN economics by caching shared selection data and immutable assets. Final responses that depend on device state or rollout assignment need an appropriate cache key or private caching. Platform, runtime, channel, protocol/acceptance, signing expectations and cohort cannot accidentally share a response. A percentage rollout must keep devices in stable cohorts across checks and have defined behavior when increasing, pausing, or reverting it.

OtaKit currently stores manifests with up to five minutes of shared-cache freshness, coupled with CDN purging. React Native publication needs measured visibility and rollback latency under both successful and failed purges. A release should not claim full publication merely because the database transaction completed; OtaKit's existing pending-publication handling is a useful foundation.

### Signing, assets, and telemetry

Expo signing uses a certificate trusted by the installed binary and a signature over the manifest or directive body. OtaKit's custom ES256 envelope and encrypted ZIP format are not accepted by an unmodified Expo client. Standard Expo asset integrity and certificate verification should be the initial security contract.[^37]

Choose the key-custody model explicitly. Server-held signing keys protect against storage/CDN compromise but still trust the signing service. A customer-controlled CI signing workflow can reduce that trust, provided publication and rollback bodies are immutable and signed in advance. Key rotation, expiry, and trust changes must be designed around what installed binaries already trust. Do not describe server-side signing as end-to-end protection against a compromised publisher.

Retain immutable assets while a supported installed binary may need them. Track publication references before garbage collection. Upload completion should verify the entire platform artifact set before making it eligible, and the importer should reject unsafe paths, missing files, invalid hashes, and accidentally public source maps.

For events, distinguish check, download attempt, completed update download, launched update, recovered failure, and application-defined health. A thin optional OtaKit wrapper can add telemetry and deliberate reload UI using public `expo-updates` APIs. It cannot promise the same native trial-confirmation behavior as OtaKit's Capacitor plugin without additional native integration.

The current billing pipeline counts deduplicated `downloaded` events, and the auto-revert denominator is successful trials plus rollbacks. Neither can be populated from asset requests alone. Recoverable native failures should be reported on a later successful launch where available; missing observations should remain unknown. Define retries, reinstalls, cached assets, multiple devices, and forged client events before claiming accurate delivery-based billing. See [billing event query](../../tinybird/endpoints/organization_download_counts.pipe) and [health logic](../../packages/console/lib/auto-revert.ts).

### Migration and initial support boundary

The easiest initial customer already uses `expo-updates` and can ship a binary configured for OtaKit's update URL, runtime policy, and certificate. Expo documents the use of a custom server and also supports installation into existing RN projects after Expo modules are installed. This does not require buying EAS Build.[^1][^2]

For an app already distributed with a different native update URL or trust configuration, plan a normal store release to install the new configuration. Advanced runtime URL overrides exist, but should not be marketed as a universally safe, zero-store migration. CodePush-to-Expo migration also changes native integration and needs a supported store-build path.[^41]

Proposed beta support: Expo SDK 57 on iOS and Android with Hermes and the New Architecture; add SDK 56 if pilot demand warrants it. SDK 57 is an actual released baseline, not an inferred future version. Use the latest stable patch appropriate to each customer and record the exact compatibility matrix.[^33]

Expo Go is not the production acceptance environment. Its May 2026 changes specifically restrict self-hosted Hermes bytecode loading; that restriction concerns Expo Go, not an app's own production binary. Test installed release builds and development builds configured for realistic update behavior. Defer brownfield, multiple RN runtimes, alternate bundlers, desktop/TV, encrypted content, and custom-native recovery promises until separately validated.[^34]

## Store-policy constraints

Apple's current guideline 2.5.2 restricts downloaded code that introduces or changes app features or functionality. Google's device-and-network policy prohibits replacing executable native code outside the permitted update mechanisms and places policy obligations on runtime-loaded interpreted code. JavaScript capability and store eligibility are separate questions.[^30][^31]

The appropriate product promise is delivery of compatible, policy-compliant fixes and assets, with native changes continuing through store builds. Do not promise that arbitrary new features can bypass review, or that a platform has pre-approved every OTA update. This product wording matters for Capacitor as well as React Native. Actual eligibility depends on the application's behavior and the current rules.

## Competitive landscape

**Expo is the default comparison.** It combines the framework, build tooling, distribution, updates, and operational services. In the 2025 State of React Native survey, 68.2% of respondents to the EAS Build item said they had used it. That is a self-selected survey result about build-tool experience, not OTA market share, but it illustrates Expo's distribution advantage.[^27]

**Independent alternatives already cover the obvious feature list.** Hot Updater offers self-hosting and plugins; xprem serves the same Expo protocol; Revopush serves CodePush migration customers; CodePushGo markets managed React Native recovery and release operations. OtaKit cannot rely on “open source,” “rollbacks,” or “CLI support” being unique.[^15][^16][^18][^24]

**The CodePush retirement is an established transition, not a fresh surprise.** Microsoft retired the relevant App Center services on March 31, 2025, and archived the standalone repositories. The longer Analytics and Diagnostics support window did not extend CodePush. By September 2026, the initial migration event is more than seventeen months old.[^13][^20]

**Agent tooling is useful but already competitive.** Hot Updater, xprem, Revopush and Expo expose agent-oriented integrations. Expo's standalone web Agent was wound down after July 31, 2026, while its announcement said work would continue through SDK, CLI, MCP, and integrations. The April funding announcement must not be used to imply that standalone Agent remains available.[^15][^16][^18][^35][^36]

OtaKit's proposed differentiation is the combination of transparent delivery-based pricing, one release workflow across Capacitor and React Native, fully self-hostable operations, and understandable failure handling. This is a positioning hypothesis. Cross-framework demand and buyers' willingness to change updater configuration must be demonstrated.

## Pricing and customer economics

Current published EAS plans include Free at 1,000 OTA MAUs, Starter at $19/month with 3,000, and Production at $199/month with 50,000. Additional users are charged through graduated bands, and bandwidth allowances increase with paid excess MAUs. EAS counts an installation that downloads updates during the period, rather than billing each release delivery separately.[^22][^39]

Revopush publishes Startup at $25/month with 50,000 MAUs and 100 GB egress, and Growing at $100 with 300,000 MAUs and 1 TB. The published excess rates are $1 per thousand users and $0.03/GB. Its free Starter tier also lists overages, so the cheapest published configuration can be that tier plus usage.[^23]

OtaKit's current source advertises $10/month for 100,000 delivered updates, and Pro at $50/month or $25/month equivalent billed annually for one million, with $50 per additional million. Those are existing Capacitor prices. Applying them to RN below is a **hypothetical extension**, not a shipped price or proven cost structure. See [site pricing](../../packages/site/app/page.tsx) and [enforced plan limits](../../packages/console/lib/billing/config.ts).

The following scenarios assume one receiving installation per OTA MAU, four completed deliveries per installation per month, and **5 MiB actually transferred per delivery** for every provider. They include stated bandwidth overages, assume no storage overage, exclude tax and enterprise negotiations, and do not subtract build credits. The equal-byte assumption isolates pricing; actual asset reuse and patches will differ.

| Receiving installations | Deliveries/month | EAS modeled monthly bill | Lowest Revopush list-price bill | OtaKit at current monthly meter, hypothetically |
| ----------------------- | ---------------- | ------------------------ | ------------------------------- | ----------------------------------------------- |
| 10,000                  | 40,000           | $54.00                   | $14.99, Starter plus usage      | $10                                             |
| 50,000                  | 200,000          | $199.00                  | $53.46, Startup                 | $50                                             |
| 250,000                 | 1,000,000        | $1,136.50                | $227.29, Growing                | $50                                             |

The calculations are reproducible in [model.py](model.py); [pricing-scenarios.csv](pricing-scenarios.csv) adds bandwidth quantities, selected-plan alternatives, annual equivalents, and a larger scenario. Revopush GB/TB are treated as decimal units and overages as pro rata; checkout rounding and billing definitions should be confirmed before using the numbers in sales claims. Feature eligibility also matters: the cheapest EAS plan by usage may lack capabilities a particular customer requires.

The critical counterexample is a customer already paying for EAS Production for builds and staying within its update allowances. That customer's **avoidable incremental OTA bill can be zero**. Moving them to OtaKit adds another subscription. For larger customers, compare the EAS usage actually avoided, residual build-service costs, migration work, support, and update reliability; do not compare the whole EAS bill against a standalone OTA bill and call the difference savings.

Delivery-based pricing also grows with release frequency. A million receiving installations at eight deliveries each generate eight million billable deliveries under the proposed mapping. Unlimited releases are not unlimited device deliveries. Repeated checks, individual assets, and retries must not accidentally become separately billable updates.

### Infrastructure margin and support cost

R2's published Standard storage rates are $0.015/GB-month, $4.50 per million Class A operations, and $0.36 per million Class B operations, with free internet egress. That can make immutable delivery inexpensive, but does not remove worker, database, signing, patch-generation, observability, support, or on-call costs.[^32]

For illustration, one million deliveries fetching one launch asset and twenty uncached assets each generate 21 million object reads. Before free allowances and caching, those reads cost about $7.56 at the listed R2 Class B rate. This is an object-read example, not an estimate of the whole service. Ten times as many assets or extra request-processing layers change the economics. Repeated checks also create traffic when no update is downloaded.

The pricing danger is support. At $10/month, a customer generates $120/year before any costs; recurring native build troubleshooting can erase that contribution quickly. Separate automated hosted delivery from hands-on migration and support. Self-hosting availability is valuable, but self-hosted usage does not automatically generate subscription revenue.

At an **assumed** $60,000/year in incremental fixed operating and maintenance cost and an **assumed** 80% contribution margin before those fixed costs, break-even requires 625 customers at $10/month, 250 at $25, 125 at $50, or 63 at $100 when rounded up. This excludes acquisition cost and recovery of the initial development investment. The model is a decision aid, not observed OtaKit financials.

## How large could the business be?

### What public evidence establishes

Georgian's April 2026 investment announcement reported more than three million developers on Expo and over 250% year-on-year growth in paying customers, without disclosing a paying-customer count or OTA revenue. Expo separately said it had been profitable and raised a $45 million Series B. These are investor/company statements about the whole platform, with commercial interests and broad metric definitions.[^25][^26]

AppBrain detected React Native in more than ten thousand Android apps and reported a 6.67% share in its measured app population. It acknowledges weaker coverage of less-popular apps. Presence of the library can represent only part of a product and does not prove third-party OTA use. This is evidence of substantial deployment, not a count of addressable paying organizations.[^28]

For comparison, its Capacitor detail page reported more than three thousand detected apps and a 1.16% share. The two retrieved snapshots suggest roughly six times as much RN library presence by share, but differ slightly in update date and inherit the same detection biases. They support the direction of ecosystem expansion; they do not justify multiplying OtaKit's revenue opportunity by six.[^28][^42]

RevenueCat's 2026 subscription-app report spans over 115,000 apps and $16 billion in revenue. It finds meaningful monetization among React Native apps, while emphasizing large variation within each framework. Its overall app count is not the React Native app count, and subscription consumer revenue is not OTA infrastructure spending.[^29]

Together these sources establish a significant ecosystem and an existing paid tooling business. They do not establish a defensible single TAM figure for React Native OTA. Npm downloads, GitHub stars, installed-device counts, total mobile revenue, and Expo funding cannot be substituted for paying OTA accounts.

### Explicit opportunity scenarios

The purchasing unit is an **organization operating maintained RN apps**. Agencies may own many apps; an app on both iOS and Android should not become two organizations. The following inputs are assumptions chosen for sensitivity analysis, informed only directionally by the ecosystem evidence. They are not a census, a statistical confidence interval, or an estimate of current vendor revenue.

Annual category opportunity = maintained RN organizations × share paying for OTA × monthly OTA spend × 12.

| Scenario            | Assumed organizations | Paid OTA share | Monthly spend per paying organization | Annual category opportunity | Assumed share open to an independent entrant | Annual contestable opportunity |
| ------------------- | --------------------- | -------------- | ------------------------------------- | --------------------------- | -------------------------------------------- | ------------------------------ |
| Conservative        | 10,000                | 20%            | $50                                   | $1.2M                       | 10%                                          | $120K                          |
| Middle illustration | 30,000                | 30%            | $100                                  | $10.8M                      | 20%                                          | $2.16M                         |
| Upside              | 75,000                | 40%            | $200                                  | $72M                        | 25%                                          | $18M                           |

The final column is the subset of category spending potentially contestable by independent providers, not OtaKit's forecast. It allows for satisfied Expo customers, free-only projects, internally maintained systems, migration friction, and buyers OtaKit cannot serve. The upper scenario is speculative. The wide range is evidence of uncertainty, not justification for using its midpoint as a market fact. See [market-scenarios.csv](market-scenarios.csv).

A more actionable question is the number of paying accounts needed for OtaKit's desired outcome:

| Paying organizations | At $25/month average | At $50/month average | At $100/month average |
| -------------------- | -------------------- | -------------------- | --------------------- |
| 100                  | $30K ARR             | $60K ARR             | $120K ARR             |
| 500                  | $150K ARR            | $300K ARR            | $600K ARR             |
| 1,000                | $300K ARR            | $600K ARR            | $1.2M ARR             |

At $50/month, reaching $1M ARR requires roughly 1,667 paying organizations. At $25 it requires roughly 3,334. Those outcomes require distribution and retention, not just a functioning updater. The evidence is compatible with a useful independent software business; it does not establish that RN OTA alone is a venture-scale opportunity for OtaKit.

A useful initial planning target is a path to **100–500 paying RN organizations**, equivalent to $60K–$300K ARR at $50/month. This is a target to validate, not a forecast. The route to $1M-plus becomes more plausible with higher-value operational contracts or materially stronger distribution. Pilot commitments should test those mechanisms before committing to a broad native support burden.

### Initial buyer selection

| Segment                                                   | Attractiveness                    | Evidence needed before prioritizing                                                |
| --------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------- |
| Agencies operating Capacitor and RN portfolios            | Strong strategic fit              | Actual mixed-framework portfolios, workflow pain, willingness to consolidate       |
| Established Expo apps with material OTA overages          | Clear measurable pain             | Real avoidable bills, migration economics, retention after the first fix           |
| Teams requiring their own infrastructure                  | Potentially higher contract value | Paid support/security requirements rather than only interest in free self-hosting  |
| Existing bare RN/CodePush users                           | Selective opportunity             | Supported architecture, remaining migration demand, acceptance of a native rebuild |
| Small Expo apps already within paid build-plan allowances | Weak price case                   | A reason to buy beyond price                                                       |
| Hobby and newly generated apps                            | Useful adoption funnel            | Conversion and support cost; project creation alone is insufficient                |

The best product hypothesis is a managed release service for teams that already feel release pain. Expanding the top of the funnel to every React Native developer would obscure whether the paying segment works.

## Delivery investment and validation gates

The following are planning estimates based on the code review, not measured implementation time. They assume familiarity with OtaKit and access to an engineer comfortable with native RN integration. Calendar time depends on staffing, customer availability, and app-store migration schedules.

| Stage                      | Proposed investment                                          | Required outcome                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatibility spike        | 3–5 engineering days                                         | A production-style iOS and Android app receives a signed Expo update from an isolated OtaKit-compatible endpoint; wrong-runtime rejection, offline launch and rollback demonstrated |
| Private beta               | Approximately 4–6 additional engineer-weeks                  | Real artifact import, release identity, signing, platform isolation, publish visibility, telemetry and documented migration; several real pilot apps                                |
| Supported public release   | Approximately 4–8 additional engineer-weeks                  | Supported version matrix, recovery/rollout tests, operational controls, billing correctness, docs and support process                                                               |
| Own native updater instead | Roughly 16–28 engineer-weeks as an initial planning envelope | Separate native lifecycle implementation and a substantially broader maintenance obligation                                                                                         |

The stages are additive. A short successful spike does not establish that production support is a one-week feature. Budget continued dependency tracking, release-build testing, and support after launch; initially reserve roughly a quarter to half of an engineer's capacity, then replace that assumption with actual beta data.

**Commercial gate:** interview ten qualified teams across the target segments; obtain actual update volumes and avoidable costs from at least five; seek three paid pilot commitments with explicitly agreed scope. Interest in an open-source repository or free hosting should not satisfy this gate. Target buyers whose price or workflow problem is recurring, not a one-off migration rescue.

**Technical gate:** demonstrate the supported behavior on real release builds, not only HTTP fixtures. Include interrupted downloads, killed processes, corrupted assets, invalid signatures, first launch without network, native upgrades, wrong platform/runtime, failed initial render, error after first render, rollback with persistent data, offline devices returning after rollback, and cache behavior under concurrent publication.

**Operational gate:** validate stable rollout membership across repeated checks, recoverable publication failure, unambiguous per-platform release status, deduplicated delivery events, and visibility into missing telemetry. Measure startup overhead, transfer bytes, completion rate, recovery outcome, and support time. Define latency targets before the pilot and report observed results rather than borrowing another vendor's benchmarks.

**Go/no-go after the pilot:** proceed if buyers pay, the existing Expo client is sufficient, migrations are tractable, and support-adjusted contribution is positive. Re-scope or stop if most requests require a custom native runtime, if prospects are satisfied with included Expo capacity, or if free-only demand dominates. Compare this evidence with the revenue and retention work the same effort could fund in Capacitor.

That opportunity cost is concrete: Ionic's current commercial-products announcement says Appflow access continues through December 31, 2027 as its commercial offerings wind down, while Capacitor remains open source. This creates a prospective replacement window in OtaKit's existing market. Preserve capacity to serve those buyers; React Native's larger ecosystem is not sufficient reason to abandon a closer migration opportunity.[^43]

## Confidence and outstanding evidence

| Finding                                                                 | Confidence | Remaining uncertainty                                                                |
| ----------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| A custom backend can serve an existing Expo native client               | High       | OtaKit implementation and supported-version tests remain to be done                  |
| OtaKit needs artifact, platform, protocol, signing and rollback changes | High       | Final schema and migration design require an implementation review                   |
| Reusing an established client limits native maintenance                 | High       | Framework upgrades and customer-specific integration still require support           |
| A limited Expo-first pilot is the best next investment                  | Moderate   | Customer demand and opportunity cost are unmeasured                                  |
| Low-price delivery alone is a durable advantage                         | Low        | Competitors already price aggressively; included EAS capacity can cost nothing extra |
| The modeled market lies in a particular dollar band                     | Low        | No authoritative OTA spending census or disclosed vendor segment revenues            |

The next confidence increase will come from paid pilots and release-build experiments. More generic framework-market articles will not resolve those two uncertainties.

## Sources

All live pages were accessed September 10, 2026. Dates below are publication or update dates where available; repository revisions and license details are pinned separately. Company and investor claims are identified as such in the text.

[^1]: Expo. [Updates SDK reference](https://docs.expo.dev/versions/latest/sdk/updates/). Current reference. Custom server support, runtime configuration, and public client API.

[^2]: Expo. [Install expo-updates in an existing React Native project](https://docs.expo.dev/bare/installing-updates/). Updated June 26, 2026. Native installation and custom update URL.

[^3]: Expo. [Expo Updates v1 specification](https://docs.expo.dev/technical-specs/expo-updates-1/). Updated August 12, 2026. Wire protocol, manifests, assets, directives and signatures.

[^4]: Expo. [How EAS Update works](https://docs.expo.dev/eas-update/how-it-works/). Current documentation. Builds, updates and delivery lifecycle.

[^5]: Expo. [Runtime versions and updates](https://docs.expo.dev/eas-update/runtime-versions/). Updated July 3, 2026. Native compatibility and runtime lanes.

[^6]: Expo. [Expo Fingerprint](https://docs.expo.dev/versions/latest/sdk/fingerprint/). Current reference. Fingerprint inputs, configuration and limitations.

[^7]: Expo. [Using Hermes engine](https://docs.expo.dev/guides/using-hermes/). Updated July 29, 2026. Engine and bytecode compatibility.

[^8]: Expo. [Error recovery](https://docs.expo.dev/eas-update/error-recovery/). Updated May 23, 2026. Early-error handling and persistence-related rollback limits.

[^9]: Expo. [Rollbacks](https://docs.expo.dev/eas-update/rollbacks/). Updated March 3, 2025; current guidance. Republish versus embedded rollback.

[^10]: Expo. [Bundle diffing for EAS Update](https://docs.expo.dev/eas-update/bundle-diffing/). Updated August 10, 2026. Patch eligibility and embedded-bundle limitations.

[^11]: Expo. [Expo SDK 56](https://expo.dev/changelog/sdk-56). May 21, 2026. Binary diffing enabled by default.

[^12]: Expo. [React Native's New Architecture](https://docs.expo.dev/guides/new-architecture/). Updated September 3, 2026. RN 0.82 and Expo SDK 55 architecture requirements.

[^13]: Microsoft. [Visual Studio App Center Retirement](https://learn.microsoft.com/en-us/appcenter/retirement). Updated April 15, 2026. CodePush retirement and separate analytics support timeline.

[^14]: Expo. [custom-expo-updates-server](https://github.com/expo/custom-expo-updates-server). Repository and inspected implementation; exact revision in the checkout inventory.

[^15]: Sungyu Kang and contributors. [Hot Updater](https://github.com/gronxb/hot-updater). Repository, native implementation and license; exact revision in the checkout inventory.

[^16]: Mercure Technologies and contributors. [xprem](https://github.com/mercuretechnologies/xprem). Formerly Expo Open OTA. Repository and scoped license; exact revision in the checkout inventory.

[^17]: vknow360 and contributors. [OTAShip](https://github.com/vknow360/otaship). Repository; exact revision in the checkout inventory.

[^18]: Revopush and contributors. [React Native CodePush SDK](https://github.com/revopush/react-native-code-push). Repository; exact revision in the checkout inventory.

[^19]: Nevercode Ltd. [Codemagic Patch license at the inspected revision](https://github.com/codemagic-ci-cd/codemagic-patch/blob/f22294f7c2599b79979b8620e5cb6db4bf3bdf0a/LICENSE), and [project](https://github.com/codemagic-ci-cd/codemagic-patch). 2026. Use and competition restrictions.

[^20]: Microsoft. [code-push-server](https://github.com/microsoft/code-push-server). Archived May 2025. Standalone server and retirement notice.

[^21]: Microsoft. [react-native-code-push](https://github.com/microsoft/react-native-code-push). Archived May 2025. Legacy architecture restriction and SDK behavior.

[^22]: Expo. [EAS pricing](https://expo.dev/pricing) and [published pricing tables](https://expo.dev/pricing.md). Observed September 10, 2026. Plans, graduated overages and bandwidth allowances.

[^23]: Revopush. [CodePush and React Native OTA pricing](https://revopush.org/pricing). Observed September 10, 2026. MAU, bandwidth and overage pricing.

[^24]: CodePushGo. [React Native live-update platform](https://codepushgo.com/). Observed September 10, 2026. Product positioning; numerical pricing was not visible in the retrieved homepage.

[^25]: Emily Walsh / Georgian. [Why Georgian Invested in Expo](https://georgian.io/posts/why-georgian-invested-in-expo). April 16, 2026. Investor-reported developer scale and paying-customer growth.

[^26]: Charlie Cheever / Expo. [What Expo's Series B funding means for you](https://expo.dev/blog/what-expo-s-series-b-funding-means-for-you). April 16, 2026. Company-reported profitability and $45M round.

[^27]: Software Mansion. [State of React Native 2025: Build and publish](https://results.2025.stateofreactnative.com/en-US/build-and-publish/). Survey edition 2025; results available in 2026. Self-reported tool experience.

[^28]: AppBrain. [React Native Android SDK statistics](https://www.appbrain.com/stats/libraries/details/react_native/react-native). Observed September 10, 2026. Detected-app footprint and coverage caveat.

[^29]: RevenueCat. [State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps). 2026. Subscription-app dataset and framework monetization observations.

[^30]: Apple. [App Review Guidelines, section 2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements). Current rules observed September 10, 2026.

[^31]: Google. [Device and Network Abuse policy](https://support.google.com/googleplay/android-developer/answer/16559646). Current rules observed September 10, 2026.

[^32]: Cloudflare. [R2 pricing](https://developers.cloudflare.com/r2/pricing/). Updated August 7, 2026. Storage, operation and egress pricing.

[^33]: Expo. [Expo SDK 57](https://expo.dev/changelog/sdk-57). June 30, 2026, with later patch notes. Released SDK baseline.

[^34]: Brent Vatne / Expo. [Changes to project loading behavior in Expo Go](https://expo.dev/changelog/expo-go-loading-changes-may-2026). May 13, 2026. Self-hosted HBC restriction in Expo Go.

[^35]: Expo. [Expo Agent: ending the closed beta and winding the project down](https://expo.dev/changelog/expo-agent-ending-the-closed-beta-and-winding-the-project-down). July 20, 2026. Availability ended after July 31; integration work continues.

[^36]: Expo. [MCP tools for EAS Build and Workflows](https://expo.dev/changelog/mcp-build-and-workflows). February 6, 2026. Existing agent integrations.

[^37]: Expo. [End-to-end code signing with EAS Update](https://docs.expo.dev/eas-update/code-signing/). Updated July 21, 2026. Certificates, signing and rotation.

[^38]: Expo contributors. [expo-updates native source at the inspected revision](https://github.com/expo/expo/tree/176be976b9f4290afbf03b6ddd0cb001326a2c01/packages/expo-updates). September 10, 2026 snapshot. Selection, persistence, error recovery, patching and native tests; see the reference guide for specific files.

[^39]: Expo. [Usage-based pricing](https://docs.expo.dev/billing/usage-based-pricing/). Updated August 13, 2026. Per-installation MAU definition, bandwidth allowances and incremental usage examples.

[^40]: Expo. [Downloading updates](https://docs.expo.dev/eas-update/download-updates/). Current documentation. Startup, download and activation strategies.

[^41]: Expo. [Override update configuration at runtime](https://docs.expo.dev/eas-update/override/). Current documentation. Advanced request-header and URL overrides and their limitations.

[^42]: AppBrain. [Capacitor Android SDK statistics](https://www.appbrain.com/stats/libraries/details/capacitor/capacitor). Page dated September 2, 2026; accessed September 10. Comparison of detected SDK presence with React Native.

[^43]: Ionic Team. [Important Announcement: The Future of Ionic's Commercial Products](https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products). Originally February 11, 2025; current retrieved text accessed September 10, 2026. Appflow access through December 31, 2027 and continued open-source Capacitor support.
