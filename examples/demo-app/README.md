# OtaKit Demo App

This demo app is a native-capable Next.js diagnostics console for the
`@otakit/capacitor-updater` plugin.

The native config in `capacitor.config.ts` is set up to exercise the simplified
policy model:

- `launchPolicy: "apply-staged"`
- `resumePolicy: "shadow"`
- `runtimePolicy: "immediate"`

That demo config makes runtime catch-up eager while keeping normal resume checks
in the background.

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

1. shows a fullscreen startup loading screen
2. checks plugin availability with `Capacitor.isPluginAvailable("OtaKit")`
3. calls `OtaKit.notifyAppReady()`
4. refreshes `getState()` and `getLastFailure()`
5. hides the loading screen and sets status to `Ready`

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
pnpm build:cap          # rebuild exported web assets and sync native projects
pnpm exec otakit upload --release
```

## Files you will touch most

- `app/page.tsx` - diagnostics console
- `capacitor.config.ts` - plugin config
