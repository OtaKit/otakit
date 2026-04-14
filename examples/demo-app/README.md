# OtaKit Demo App

This demo app is a native-capable Next.js diagnostics console for the
`@otakit/capacitor-updater` plugin.

## Plugin API

```ts
OtaKit.getState()        // current, fallback, staged, builtinVersion
OtaKit.check()           // check for a newer version
OtaKit.download()        // download and stage the latest bundle
OtaKit.apply()           // activate the staged bundle and reload
OtaKit.update()          // one-shot: download + apply
OtaKit.notifyAppReady()  // confirm the current bundle is healthy
OtaKit.getLastFailure()  // last rollback info (if any)
```

## What this app is for

Use it to verify the plugin works end-to-end:

- is the plugin registered on iOS or Android?
- which bundle is current, staged, or fallback?
- is an update available on the server?
- what was the last failed update?

## Startup flow

On screen load, `app/page.tsx`:

1. checks plugin availability with `Capacitor.isPluginAvailable("OtaKit")`
2. registers listeners for updater events
3. calls `OtaKit.getState()` and `OtaKit.getLastFailure()`
4. calls `OtaKit.notifyAppReady()`
5. sets status to `Ready`

## Main controls

- **Refresh** — reload runtime state and last failure
- **Check** — inspect the latest manifest without downloading
- **Download** — ensure the latest update is staged
- **Apply** — activate the staged bundle and reload
- **Update Now** — download the latest and apply it
- **Notify Ready** — confirm the current bundle is healthy

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

## Files you will touch most

- `app/page.tsx` - diagnostics console
- `capacitor.config.ts` - plugin config
