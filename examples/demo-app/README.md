# OtaKit Demo App

This demo app is a native-capable Next.js diagnostics console for the
`@otakit/capacitor-updater` plugin.

It reflects the simplified plugin shape:

- normal app code can use `OtaKit.getState()`, `OtaKit.check()`,
  `OtaKit.download()`, `OtaKit.update()`, `OtaKit.apply()`, and
  `OtaKit.notifyAppReady()`
- support and inspection tools live under `OtaKit.debug`

## What this app is for

Use it when you need to answer questions like:

- is the plugin registered on iOS or Android?
- which bundle is current or staged?
- did the app call `notifyAppReady()`?
- is an update available on the server?
- what was the last failed update?

The screen is built around explicit debug controls so you can inspect and test
the updater step by step.

The intended manual flow is:

1. `OtaKit.getState()` to see whether something is already staged
2. `OtaKit.check()` to see whether a newer update exists
3. `OtaKit.update()` for the easy one-shot path
4. or `OtaKit.download()` now and `OtaKit.apply()` later for a split flow

## Startup flow

On screen load, `app/page.tsx` does this:

1. checks plugin availability with `Capacitor.isPluginAvailable("OtaKit")`
2. registers listeners for updater events
3. calls:
   - `OtaKit.getState()`
   - `OtaKit.debug.listBundles()`
   - `OtaKit.debug.getLastFailure()`
4. calls `OtaKit.notifyAppReady()`
5. sets status to `Ready`

## Main controls

- `Refresh`
  reload runtime state, downloaded bundles, and last failure
- `Check`
  inspect the latest manifest without downloading
- `Download`
  ensure the latest update is staged
- `Apply`
  activate the staged bundle immediately and reload
- `Update Now`
  apply the staged bundle, or download the latest one and apply it
- `Notify Ready`
  confirm the current bundle is healthy
- `Reset to Builtin`
  reset to the bundled app-store web assets and reload

## Bundle list

The bundle list only shows downloaded OTA bundles. Current/staged state is shown
separately above.

Each listed bundle can be deleted if it is not currently protected by runtime
state.

## Useful commands

From `examples/demo-app`:

```bash
pnpm build:cap          # build web + sync native projects
pnpm ios                # open Xcode
pnpm ios:run            # run on iOS simulator/device
pnpm android:run        # run on Android emulator/device
pnpm exec otakit login  # sign in to the hosted server
```

## Local OTA flow

From `examples/demo-app`:

```bash
pnpm build:cap
pnpm ios:run
```

Then, after a code change:

```bash
pnpm build              # rebuild exported web assets into ./out
pnpm exec otakit upload --release
```

If this is the first native run after cloning, use `pnpm build:cap` so the iOS
and Android projects are synced before opening or running them.

## Files you will touch most

- `app/page.tsx` - diagnostics console
- `capacitor.config.ts` - plugin config

Hosted defaults point to `https://otakit.app/api/v1`. Change `serverUrl` only
when you are testing a custom or self-hosted server.
