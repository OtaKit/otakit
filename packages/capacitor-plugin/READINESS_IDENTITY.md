# Readiness belongs to the activated document

The native plugin installs a document-start script immediately before activating a
trial. The script captures that activation's UUID and adds it to the existing
Capacitor `notifyAppReady()` bridge message. A readiness call from the previous
document keeps its previous UUID, even after the native current pointer changes.
Untagged and stale calls cannot confirm a trial, cancel its timer, or authorize cleanup.

Application code continues to call `OtaKit.notifyAppReady()` with no arguments. The
hook runs before application JavaScript and supports the existing Capacitor bridge;
previously published web bundles do not need a new readiness argument. This is a
correctness guard against stale calls, not a security boundary against app JavaScript.

Activation state preparation, WebView activation, readiness, and timeout handling run on the
main thread. Downloads and extraction remain on their existing background paths.
On iOS, replacing our user script preserves other plugins' scripts and their order.

Android requires `WebViewFeature.DOCUMENT_START_SCRIPT`. Devices without it retain
their current app and staged update: activation fails before changing pointers with
a message to update Android System WebView. Already confirmed installed bundles can
still launch. A legacy pending startup that cannot install the guard rolls back.
This feature requirement deliberately avoids an unsafe delayed-injection fallback.

Tests exercise the actual Capacitor JavaScript bridge inside Android WebView and
iOS WKWebView. They keep the old document alive while preparing B, send a late
readiness call from A, then load B and confirm its new identity. Coordinator tests
verify stale and missing identities cannot change state.

Run `pnpm --filter @otakit/capacitor-updater verify:android:device` with an Android
emulator/device connected. The iOS WebView test runs with `verify:ios`. CI runs both.
CI tests the native bridge with Capacitor 7.0.0 and 8.0.2, covering both supported majors.

Script timing and ordering rely on
[Android's document-start API](<https://developer.android.com/reference/androidx/webkit/WebViewCompat#addDocumentStartJavaScript(android.webkit.WebView,java.lang.String,java.util.Set)>)
and [WKUserScript](https://developer.apple.com/documentation/webkit/wkuserscript).
