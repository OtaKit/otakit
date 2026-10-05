# OtaKit setup

## Confirm the target

Resolve the console origin and organization before creating or changing anything.
Hosted OtaKit uses `https://console.otakit.app`. A self-hosted installation must
use its configured origin consistently; never silently fall back to hosted OtaKit.

Inspect the Capacitor configuration and identify:

- `webDir`
- `plugins.OtaKit.appId`
- `plugins.OtaKit.channel`, if any
- `plugins.OtaKit.serverUrl`, if self-hosted
- the runtime version and native package evidence

## Install and configure

Install the Capacitor plugin and CLI using the versions documented by the
project. Create or select the OtaKit app, then put its public app ID in
`plugins.OtaKit.appId`. Keep user and organization tokens outside project files.

The app must call `notifyAppReady()` after the launched web bundle is genuinely
ready. If it does not, OtaKit's native fallback mechanism can treat a healthy
update as failed and restore the previous bundle.

Build the web assets and validate that `webDir` contains `index.html` before an
upload. A web-only OTA update is appropriate for JavaScript, CSS, HTML, and other
packaged web assets. Native dependencies, native configuration, entitlements,
permissions, and native source changes normally require a store build.

## Verify without releasing

Inspect the project, resolve account context, and list apps. If the app is not
registered, create it only after confirming the organization and slug. Run a
compatibility check when a current release and local native-package evidence are
available. Prefer an upload-only first run so the bundle can be reviewed before
publication.
