# Blog Migration Rewrite Plan

## Objective

Rewrite `app/blog/migrate-from-capgo-and-capawesome/page.tsx` into a technical migration guide for teams that already run Capgo or Capawesome in production.

This article must read like an operator guide, not a marketing page.

## Editorial Rules

- Assume the reader already has OTA in production.
- Assume they already understand channels, rollbacks, CI, and release hygiene.
- Do not tell the reader they "probably do not need" a feature they already use.
- When OtaKit lacks a feature, say so directly.
- For every migration difference, classify it as one of:
  - exact mapping
  - workable redesign
  - no current workaround
- The article must explain the real cutover constraint:
  - existing Capgo or Capawesome binaries will keep using their current plugin until users install a new native build that contains OtaKit
  - migration therefore requires a temporary dual-system period

## Product Facts Verified

### OtaKit

Verified from local docs and repo:

- Package: `@otakit/capacitor-updater`
- Config:
  - `appId`
  - optional `channel`
  - optional `runtimeVersion`
  - `updateMode`
  - `checkInterval`
  - `appReadyTimeout`
  - optional hosted overrides: `cdnUrl`, `ingestUrl`, `serverUrl`, `manifestKeys`
- Runtime methods:
  - `getState()`
  - `check()`
  - `download()`
  - `apply()`
  - `update()`
  - `notifyAppReady()`
  - `getLastFailure()`
- Hosted release model:
  - `otakit upload --release`
  - `otakit upload --release <channel>`
  - `otakit release <bundleId> --channel <channel>`
- Compatibility model:
  - device resolution is by fixed `(appId, channel, runtimeVersion)` lane
  - `runtimeVersion` is an exact lane, not a version range
- Current intentionally smaller public surface:
  - no runtime `setChannel()`
  - no runtime `unsetChannel()`
  - no runtime channel discovery
  - no public per-device targeting API
  - no rollout percentage control
  - no documented delta update delivery
  - no public `reset()` to builtin bundle
  - no runtime config mutation API similar to `setConfig()`

### Capgo

Verified from official Capgo docs:

- Package: `@capgo/capacitor-updater`
- Config surface includes:
  - `appId`
  - `defaultChannel`
  - `autoUpdate`
  - `directUpdate`
  - `periodCheckDelay`
  - `appReadyTimeout`
  - `publicKey`
- Runtime methods include:
  - `notifyAppReady()`
  - `download()`
  - `next()`
  - `set()`
  - `reset()`
  - `reload()`
  - `current()`
  - `getLatest()`
  - `setChannel()`
  - `unsetChannel()`
  - `listChannels()`
  - `setCustomId()`
- Channel model includes strict precedence:
  - forced device mapping
  - cloud override
  - config `defaultChannel`
  - cloud default
- Version targeting supports more than one strategy:
  - channel-based version routing
  - semver blocking rules
  - minimum native version constraints
  - device overrides
- Delta updates are supported with `bundle upload --delta`

### Capawesome

Verified from official Capawesome docs:

- Package: `@capawesome/capacitor-live-update`
- Config surface includes:
  - `appId`
  - `defaultChannel`
  - `autoUpdateStrategy`
  - `readyTimeout`
  - `publicKey`
  - `serverDomain`
  - `autoDeleteBundles`
  - `autoBlockRolledBackBundles`
- Runtime methods include:
  - `ready()`
  - `reload()`
  - `reset()`
  - `setChannel()`
  - `setConfig()`
  - `resetConfig()`
  - `setCustomId()`
  - `setNextBundle()`
  - `sync()`
  - `downloadBundle()`
  - `getCurrentBundle()`
  - `getChannel()`
- Channel resolution options:
  - `defaultChannel`
  - native config default
  - runtime `setChannel()`
  - one-off `sync({ channel })`
  - higher-priority forced channel assignments from Capawesome Cloud
- Version targeting supports:
  - versioned channels
  - versioned bundles with min/max/eq version codes per platform
- Rollouts support percentage-based deployment
- Delta updates support manifest-style delivery

## Core Migration Thesis

The correct OtaKit migration story is not "swap config and keep going".

It is:

1. Inventory the routing model you already depend on.
2. Reduce that model to fixed OtaKit lanes wherever possible.
3. Ship a new store binary that embeds OtaKit.
4. Keep Capgo or Capawesome alive for old binaries during install-base transition.
5. Start OtaKit releases only for the new binaries.

This is the central point the old article missed.

## Translation Model

### Static routing maps cleanly

- `defaultChannel` maps to OtaKit `channel`
- ready/health handshake maps to `notifyAppReady()`
- automatic polling roughly maps to `updateMode` + `checkInterval`
- version isolation can map to `runtimeVersion`

### Dynamic routing usually translates into simpler OtaKit primitives

- runtime channel switching
- per-device overrides
- custom ID targeting
- channel discovery
- percentage rollouts
- version ranges
- delta transport

Those are either redesigns or hard gaps.

## Capgo -> OtaKit Migration Model

### Config translation

Use a concrete example in the article:

```ts
plugins: {
  CapacitorUpdater: {
    appId: "com.example.app",
    autoUpdate: true,
    defaultChannel: "production",
    directUpdate: "onLaunch",
    periodCheckDelay: 600,
    appReadyTimeout: 10000,
    publicKey: "YOUR_PUBLIC_KEY"
  }
}
```

Target OtaKit example:

```ts
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    updateMode: "next-resume",
    checkInterval: 600000,
    appReadyTimeout: 10000
  }
}
```

Important article notes:

- `defaultChannel` -> `channel`
- `periodCheckDelay` seconds -> `checkInterval` milliseconds
- hosted OtaKit does not require user-supplied `publicKey`
- `directUpdate` has no perfect one-to-one mapping:
  - `false` is closest to `next-launch` or `next-resume`, depending on desired reload timing
  - `"always"` is closest to `immediate`
  - `"atInstall"` and `"onLaunch"` do not have exact OtaKit equivalents

### Runtime API translation

Must include a table:

- `notifyAppReady()` -> `notifyAppReady()` -> exact mapping
- `getLatest()` -> `check()` -> close mapping
- `download()` -> `download()` -> close mapping
- `next()` / `set()` / `reload()` -> `apply()` or `update()` -> similar outcome, different model
- `reset()` -> no public OtaKit equivalent -> workaround is server-side release rollback or new native build
- `setChannel()` / `unsetChannel()` / `listChannels()` -> no OtaKit equivalent
- `setCustomId()` -> no OtaKit equivalent

### Version targeting

Capgo supports:

- channel routing
- semver blocking
- minimum native version constraints
- device-level overrides

OtaKit only supports fixed `runtimeVersion` lanes.

Article rule:

- do not pretend `runtimeVersion` is equivalent to Capgo semver controls
- explain that users must move from range-based targeting to explicit runtime lanes

Concrete example to include:

```bash
# Capgo
npx @capgo/cli bundle upload --channel production --native-version "2.0.0"
```

```ts
// OtaKit
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    runtimeVersion: "2.0.0"
  }
}
```

Then:

```bash
otakit upload --release production
```

Important note:

- in OtaKit, the compatibility lane is selected in app config and inherited by the upload
- there is no upload-time native version range flag

### Feature gaps to call out plainly

- per-device routing: no current OtaKit equivalent
- public/self-assignable channels: no current OtaKit equivalent
- semver blocking: no current OtaKit equivalent
- delta delivery: no current OtaKit equivalent
- direct install timing matrix: only partial mapping via `updateMode`

## Capawesome -> OtaKit Migration Model

### Config translation

Use a concrete example in the article:

```ts
plugins: {
  LiveUpdate: {
    appId: "6e351b4f-69a7-415e-a057-4567df7ffe94",
    defaultChannel: "production",
    autoUpdateStrategy: "background",
    readyTimeout: 10000,
    publicKey: "YOUR_PUBLIC_KEY",
    serverDomain: "api.cloud.capawesome.io",
    autoDeleteBundles: true,
    autoBlockRolledBackBundles: true
  }
}
```

Target OtaKit example:

```ts
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    updateMode: "next-launch",
    appReadyTimeout: 10000
  }
}
```

Important article notes:

- `defaultChannel` -> `channel`
- `readyTimeout` -> `appReadyTimeout`
- `autoUpdateStrategy: "background"` is closest to OtaKit automatic modes, but not identical
- `publicKey` and `serverDomain` do not map in the hosted OtaKit default path
- `autoDeleteBundles` and `autoBlockRolledBackBundles` have no direct user-configurable equivalent in OtaKit's public config

### Runtime API translation

Must include a table:

- `ready()` -> `notifyAppReady()` -> exact purpose, different name
- `sync()` -> `check()` + `download()` + `apply()` or `update()` -> similar goal, different control model
- `setChannel()` -> no OtaKit equivalent
- `sync({ channel })` -> no OtaKit equivalent
- `setConfig()` / `resetConfig()` -> no OtaKit equivalent
- `reset()` -> no public OtaKit equivalent
- `setNextBundle()` -> no public OtaKit equivalent
- `setCustomId()` -> no OtaKit equivalent
- `downloadBundle()` -> partial manual equivalent via `download()` in OtaKit manual mode

### Versioning and rollout differences

Capawesome supports:

- versioned channels
- versioned bundles using min/max/eq version codes
- rollout percentages
- delta updates

OtaKit supports:

- fixed `channel`
- fixed `runtimeVersion`

Article rule:

- explain that Capawesome version ranges must be converted into explicit OtaKit runtime lanes
- explain that rollout percentages are a product gap, not a config rename

Concrete example to include:

```bash
# Capawesome versioned bundle
npx @capawesome/cli apps:liveupdates:upload \
  --channel production \
  --android-min 10 --android-max 12 --android-eq 11 \
  --ios-min 10 --ios-max 12 --ios-eq 11
```

```ts
// OtaKit equivalent model: explicit runtime lane
plugins: {
  OtaKit: {
    appId: "app_xxxxxxxx",
    channel: "production",
    runtimeVersion: "11"
  }
}
```

Then:

```bash
otakit upload --release production
```

Important note:

- if the current Capawesome setup uses ranges, the migration requires separate OtaKit binaries and uploads for each runtime line you intend to support

## Mandatory "What OtaKit Cannot Do Today" Section

The article must include a blunt gap table.

Recommended entries:

- runtime channel switching from app code
- per-sync channel override
- per-device cloud overrides or custom-ID targeting
- rollout percentages
- delta updates
- version min/max/eq targeting
- public reset-to-builtin API
- runtime config mutation

Each row must end with one of:

- workable redesign
- limited workaround
- no current workaround

## Recommended Production Cutover Section

The article should recommend this cutover sequence:

1. Freeze competitor-side routing changes unless required for active incidents.
2. Export or document every live channel, device override rule, rollout rule, and native version rule currently in use.
3. Decide the OtaKit lane model:
   - base channel only
   - named channels
   - runtime lanes
4. Remove old plugin code and config, add OtaKit, and ship a new native build.
5. Keep Capgo or Capawesome running for pre-migration binaries until store adoption is high enough.
6. Release the first OtaKit bundle to a non-production OtaKit lane.
7. Verify:
   - bundle download
   - activation timing
   - `notifyAppReady()`
   - rollback behavior
   - runtimeVersion isolation
8. Promote the tested bundle to the intended production lane.
9. Decommission old OTA lanes only after old binaries have mostly aged out.

## Copy Guardrails

Avoid:

- "most teams do not need this"
- "start simple" without naming what is lost
- vague claims about migration being easy
- implying OtaKit should mirror every dynamic routing control instead of collapsing them into simpler lanes

Prefer:

- exact config translations
- exact API translations
- explicit gaps
- explicit redesign costs
- explicit cutover sequencing

## Sources

Official sources used for the rewrite:

- OtaKit local docs and READMEs in this repo
- Capgo plugin API:
  - `https://capgo.app/docs/plugins/updater/api/`
- Capgo plugin settings:
  - `https://capgo.app/docs/plugins/updater/settings/`
- Capgo channels:
  - `https://capgo.app/docs/live-updates/channels/`
- Capgo version targeting:
  - `https://capgo.app/docs/live-updates/version-targeting/`
- Capgo delta updates:
  - `https://capgo.app/docs/live-updates/differentials/`
- Capawesome plugin:
  - `https://capawesome.io/plugins/live-update/`
- Capawesome channels:
  - `https://capawesome.io/cloud/live-updates/channels/`
- Capawesome bundles:
  - `https://capawesome.io/cloud/live-updates/bundles/`
- Capawesome rollouts:
  - `https://capawesome.io/cloud/live-updates/advanced/rollouts/`
- Capawesome delta updates:
  - `https://capawesome.io/cloud/live-updates/advanced/delta-updates/`
- Capawesome FAQ:
  - `https://capawesome.io/cloud/live-updates/faq/`
