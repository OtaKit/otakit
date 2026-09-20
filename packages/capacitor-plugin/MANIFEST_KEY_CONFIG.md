# Manifest signing key configuration

Only an omitted `manifestKeys` setting or an empty array is unconfigured. Managed endpoints continue to use the built-in hosted keys in that case; self-hosted endpoints retain the existing unsigned mode.

An explicit string, object, number, boolean, or null is a configuration error. Both native clients preserve a nonempty invalid-key sentinel, so a malformed setting cannot silently turn signature verification off. Existing malformed nonempty-array behavior remains fail-closed. Correct the setting to an array of `{kid, key}` entries, where `key` contains the base64 DER public key, and rebuild the native app.

Previously, Android's `optJSONArray` and iOS's `getArray` erased the distinction between an absent setting and the wrong JSON type. Both parser regressions failed before the fix. The tests cover wrong types, malformed entries, absent/empty defaults, a real hosted public key, and real HTTP manifests: unsigned self-hosted mode still works when intentionally unconfigured, while malformed explicit keys reject the same unsigned manifest.

This protects newly checked manifests. It does not alter an already installed healthy bundle or claim the configuration error caused the production download-error cohort.
