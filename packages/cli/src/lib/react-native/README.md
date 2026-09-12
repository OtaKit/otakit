# React Native build and export workflow

Export and build-sealing commands operate locally without server credentials. Upload commands authenticate to the selected server; publication is a separate action. RN creation remains gated. Opt-in [Android APK](../../../../react-native-plugin/README.md#android-apk-build-hook) and [iOS Xcode](../../../../react-native-plugin/README.md#ios-xcode-build-hook) hooks wire export, staging and completed-package sealing into native builds. Complete resolved-input collection and distribution acceptance are still required before release acceptance.

## Embedded export

The native build supplies a `NativeBuildInputs` JSON file after resolving dependencies. It declares the app ID, platform, native application ID, variant, installed Hermes compiler and bytecode version, native file inputs and evaluated native configuration. `nativeConfiguration.otakitResourceDirectory` names one folder, such as `OtaKit`, that the host actually loads. Include native dependencies, lockfiles, generated configuration and hooks in the build evidence. A manually abbreviated file list is not a substitute for that collection.

Fingerprinting excludes generated Android `.kotlin` compiler caches alongside the existing Gradle/CMake build-output exclusions. Kotlin session markers can exist during compilation and disappear at Gradle exit; they must not change compatibility between package sealing and a later OTA export. Native source and configuration files remain included.

```sh
otakit rn export-embedded --project "$OTAKIT_PROJECT" \
  --native-inputs "$OTAKIT_NATIVE_INPUTS" --version embedded-42 \
  --output "$OTAKIT_EMBEDDED_OUTPUT"
```

The command creates one `platform-runtime` directory. Preserve it with the build. `export.json` has `purpose: "embedded"`, the exact payload inventory and transport hash, an `embeddedReceipt`, and `nativeBuildId`. `private/native-build.json` records compatibility evidence; `private/native-inputs.json` preserves the supplied inputs. The composed source map stays private.

Projects that declare Expo use the adapter for Expo 57.0.17 / CLI 57.0.19's embed exporter. Supply the original entry explicitly with `--entry`, including `expo-router/entry` for Router projects. The adapter preserves Expo's native initializer, config snapshot and DOM output, validates asset destinations before copying, and keeps all source maps private. Known native directories skipped by CNG/pnpm fingerprint rules receive supplemental content hashes; other missing evidence still fails. See the [Expo fixture](../../../../../examples/expo-app/README.md) for verified export coverage and the upstream Router icon collision currently blocking its full acceptance.

Expo capture and export initialize production mode and load the installed Expo CLI's production `.env` files before evaluating native evidence, Metro or public config. Leave `NODE_ENV` and `BABEL_ENV` unset or set them to `production`; conflicting modes fail before export. Environment files contribute file hashes to the native build record, so changes currently require a matching new binary. Their contents are not stored as dotenv values in receipts. Release export resets Metro's transform cache because SDK 57 can otherwise reuse JavaScript with stale inlined `EXPO_PUBLIC_*` values while exporting a newer config snapshot. Bare RN and Capacitor do not use this Expo setup.

For verified resource staging, create a host settings JSON file before exporting. Include its path in `nativeFiles` and set `nativeConfiguration.otakitHostConfigurationFile` to that same path. Capture records its file hash and a canonical settings hash; settings changes therefore require a new native build. The settings contain `cdnURL`, `publicKeys` (key IDs to base64 P-256 SPKI DER), `bundleKeys` (key IDs to base64 32-byte encryption keys, or `{}`), and optional `channel`, `ingestURL`, and `allowLocalhost`. Local HTTP requires explicit `allowLocalhost: true`; otherwise URLs must use HTTPS. Omit build-specific receipt/version fields: staging generates them from the verified export. These are native host settings, not CLI authentication credentials.

After export and before the platform resource-copy task, run:

```sh
otakit rn stage-embedded --embedded-export "$OTAKIT_BASELINE_DIR" \
  --configuration "$OTAKIT_HOST_SETTINGS" \
  --output "$OTAKIT_GENERATED_RESOURCES/OtaKit"
```

The output folder name must match `otakitResourceDirectory`. Staging verifies the archived ZIP and payload, checks the host settings against the recorded inputs, and creates the complete resource folder: `payload/`, `otakit-embedded.json`, `configuration.json`, and the exporter's Unicode `case-folding.json`. Private export files are excluded. It prepares a temporary sibling folder and renames it into place only when complete. An identical rerun verifies and reuses the output; differing, incomplete, linked or extra files cause an error without replacing it. Use a new generated output path for each build, and have Gradle/Xcode copy that folder into the package. Avoid concurrent builds consuming the same generated path. The Android hook registers a generated asset task. The iOS wrapper stages inside the app’s RN build phase and seals only after Xcode succeeds, including signing. Full resolved-input collection remains outstanding.

Earlier exports without a recorded host settings file still support manual resource preparation and package sealing, but cannot use `stage-embedded`. Re-export with recorded settings to adopt the staging workflow. Manual preparation must copy only the public resources listed above and populate the build-specific configuration from the embedded receipt; never copy `private/` into the app.

On iOS the resource folder is directly inside the built `.app`. On Android it is inside APK `assets/`. The host must load that same folder. Build the native application using this exact payload, with one owner of Hermes compilation.

## Completed build receipt

Run only after the native build has succeeded, with no concurrent build modifying the selected output:

```sh
otakit rn seal-build --project "$OTAKIT_PROJECT" \
  --native-inputs "$OTAKIT_NATIVE_INPUTS" \
  --embedded-export "$OTAKIT_BASELINE_DIR" --binary "$OTAKIT_NATIVE_BINARY" \
  --receipt "$OTAKIT_COMPLETED_BUILD" --aapt2 "$OTAKIT_AAPT2"
```

Omit `--aapt2` for iOS. Android currently accepts APKs; iOS accepts built `.app` directories, including apps inside an Xcode archive. AAB/IPA inspection and signing/distribution acceptance remain outstanding.

Sealing rechecks the native inputs, verifies the archived payload and ZIP, reads the actual package identity, and compares every packaged payload file, embedded receipt and generated configuration field. It requires the matching Unicode table, and compares all host settings when their hash is recorded. Older build records without that hash retain their existing configuration checks. It rejects missing, additional, changed or linked payload files and private files in the resource folder. Android identity comes from the installed [AAPT2 manifest parser](https://developer.android.com/tools/aapt2); iOS identity comes from the built `Info.plist` and its [executable entry](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleexecutable).

The completed receipt pins the entire APK hash, or a canonical path/size/hash inventory of the iOS app's regular files. It is local CI provenance, not signature verification, store attestation or evidence of device installation. Archive the exact native output and baseline alongside it. An identical retry verifies again and returns the existing receipt. A different binary or baseline cannot overwrite it. Receipt output must be outside the native package, including through symlinks.

## OTA export

```sh
otakit rn export --project "$OTAKIT_PROJECT" \
  --native-inputs "$OTAKIT_NATIVE_INPUTS" --native-build "$OTAKIT_COMPLETED_BUILD" \
  --baseline-export "$OTAKIT_BASELINE_DIR" --version 1.4.2 \
  --output "$OTAKIT_OTA_OUTPUT"
```

An OTA export requires a completed build receipt and its intact archived baseline. Prepared input records are rejected before Metro runs. Current native inputs must match the recorded native environment before and after export.

The resulting receipt has `purpose: "ota"`; it does not declare the new version as embedded. The original baseline archive, export receipt and completed build receipt are preserved under `private/`, with a reference hash in the OTA receipt. The new public payload contains only the OTA descriptor, Hermes bundle and assets. Missing or changed baseline files stop export. Output cannot be placed inside the archived baseline.

## Durable ZIP upload

Prepare one platform/runtime OTA export for the selected account. `OTAKIT_OTA_DIR` below is the generated `platform-runtime` directory containing `export.json`, rather than its parent output directory.

```sh
otakit rn prepare-upload "$OTAKIT_OTA_DIR" \
  --receipt-dir "$OTAKIT_UPLOAD_DIR" --server "$OTAKIT_SERVER"
otakit rn upload "$OTAKIT_UPLOAD_DIR" --server "$OTAKIT_SERVER"
```

Preparation verifies both archives, their inventories and the completed baseline provenance. It saves the exact baseline and OTA transport files plus `upload.json` in a new private directory outside the export. Setting `OTAKIT_ENCRYPTION_KEY` enables encryption; `--encrypt` additionally requires the key to be present. Each transport is encrypted once. Keep the original key available for retries; keys, authentication tokens and signed URLs are not saved in receipts.

Upload finalizes the baseline first, then binds the OTA to its bundle ID. Repeat the same upload command after a network failure. It verifies saved bytes, server, organization, actor and encryption policy; resumes known session IDs; and retries uncertain finalization without uploading again. The RN-only resume endpoint refreshes a URL without extending the original session lifetime. Expired sessions and conflicting declarations stop for reconciliation. A lost initiation response may leave an unused pending session, but no bytes are sent until its ID has been saved.

Keep the entire upload directory. Do not regenerate ciphertext, change an uncertain receipt or replace its account. A process crash can leave an exclusive `.lock` file; confirm the original process has ended and reconcile its saved state before removing that lock. An incomplete preparation directory has sent no uploads and cannot be silently reused. Already finalized uploads are returned from the saved receipt; publication preparation rechecks server state.

## Explicit baseline adoption

An existing baseline may have the same embedded content but a different ZIP or encryption nonce. Ordinary upload reports a conflict. Before starting the OTA, explicitly adopt the stored representation:

```sh
otakit rn adopt-baseline "$OTAKIT_UPLOAD_DIR" --server "$OTAKIT_SERVER"
otakit rn upload "$OTAKIT_UPLOAD_DIR" --server "$OTAKIT_SERVER"
```

Adoption checks the exact embedded receipt, complete inventory, transport strategy and key identity. It downloads the stored ZIP, verifies its size and hash, authenticates/decrypts it when encrypted, and verifies every archived file before saving `adoption.json`. A corrupt object or changed encryption policy cannot be adopted. URL rotation does not change artifact identity. The unused local baseline transport remains available for audit; the OTA binds to the verified stored bundle. Adoption cannot replace a baseline after OTA upload has begun.

These commands handle one ZIP variant and do not publish. Use the returned OTA bundle ID with `rn prepare-publication`, then `rn publish` with that reviewed receipt. Delta and collection upload orchestration remain outstanding.

## Grouped publication

After uploading every selected variant and its baseline, prepare all target lanes under one display version:

```sh
otakit rn prepare-collection "$OTAKIT_IOS_BUNDLE_ID" "$OTAKIT_ANDROID_BUNDLE_ID" \
  --app-id "$OTAKIT_APP_ID" --receipt "$OTAKIT_COLLECTION_RECEIPT" \
  --server "$OTAKIT_SERVER"
otakit rn publish-collection "$OTAKIT_COLLECTION_RECEIPT" --server "$OTAKIT_SERVER"
```

Preparation verifies server targeting, common version, distinct lanes and the authenticated actor before saving any collection receipt. It publishes nothing. The saved receipt contains the original expected release and operation key for each target. All local replay checks run before the first publication, and each uncertain request is saved before being sent.

Lane publication is independent, so a collection can partially succeed. A failure stops later targets and reports how many other targets committed. Repeat `publish-collection` with the same file to retry the uncertain target and continue; committed targets are not sent again and preparation is never silently repeated. Server/account changes, expired retry windows and conflicts require reconciliation. Preserve a `manifest_sync_pending` result as a committed publication awaiting manifest repair; it is not a failed publication to replace. Grouped publication does not promise simultaneous device visibility.
