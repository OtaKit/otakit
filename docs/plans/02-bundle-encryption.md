# Implementation Plan: End-to-End Bundle Encryption

Status: ready to implement
Owner: —
Related: [01-partial-delta-updates.md](./01-partial-delta-updates.md),
[CAPGO_IMPROVEMENT_PLAN.md](../../CAPGO_IMPROVEMENT_PLAN.md)

> **v1 targets the zip bundle** (the default strategy). So encryption = encrypt the
> single zip with one key. No backward compatibility required; ships together.
> Encryption is opt-in per app; when on, the zip is stored encrypted only (no
> plaintext object). For apps using the opt-in `'deltas'` strategy (Plan 01), the
> same envelope applies per file (a short note at the end).

## 1. Goal

Make bundle contents unreadable at rest in object storage and in transit, so a
leaked CDN URL or compromised bucket doesn't expose app code. Checkbox for
enterprise/regulated buyers; parity with Capgo.

**Confidentiality, not DRM.** The decryption key ships in the app, so a determined
attacker who reverse-engineers the binary can extract it — true of every
client-side scheme including Capgo's. Protection is against leaked/guessed CDN
URLs, bucket misconfig, network interception, casual inspection. Document this
honestly. (Forgery is independently blocked by the ES256 manifest signature.)

## 2. How Capgo does it (verified from `../capgo` source: `cli/src/api/crypto.ts`, `bundle/upload.ts`, `bundle/partial.ts`, `key.ts`)

RSA-2048 per app (dev holds private in `.capgo_key_v2`, app ships public via
`plugins.CapacitorUpdater.publicKey` in capacitor.config — written by
`key create`/`key save`); AES-128-CBC body with a random per-upload session
key + IV; session key RSA-wrapped via `privateEncrypt` so the app's public key
can `publicDecrypt` it (carried as `ivSessionKey = "iv:encryptedKey"`, stored
server-side but opaque to the server); checksum RSA-signed for integrity
(`encryptChecksumV3`); `key_id` = first 20 chars of the public key. Fully
opt-in (`encryptionMethod: 'none'` default). Their own code comments flag
AES-128-CBC as legacy-compat only.

**Capgo also encrypts partial (delta) updates** — same session key, each file
encrypted individually — and pays exactly the cost we predicted: file reuse is
explicitly skipped when encrypting (`partial.ts:278-280`: "Skip reuse when
encryption is enabled because the session key changes per upload"). That
validates deferring encrypted deltas; if we ever need it fast, Capgo's
accept-the-dedup-loss approach is the known fallback.

We improve on this: AES-128-**CBC** is unauthenticated and `privateEncrypt`/
`publicDecrypt` of a raw key is awkward natively. We use **AES-256-GCM** with a
**symmetric envelope**, which is standard and first-class on iOS/Android, and we
already have ES256 signing for integrity (so we skip the RSA-checksum dance).

## 3. OtaKit today

ES256 manifest signing (`lib/manifest-signing.ts`, native `ManifestVerifier`).
A bundle is a single zip: CLI zips → presigned PUT → finalize; plugin downloads
the zip, verifies SHA-256, extracts. No encryption step yet. CLI already has
`commands/generate-signing-key.ts` (a sibling for the encryption-key command).

## 4. Design — symmetric envelope (AES-256-GCM) over the zip

One key per app, shipped in the app; standard primitives. v1 encrypts the single
zip — simple: one key, one file.

### 4.1 Keys

- **KEK** — a 256-bit app secret. `otakit generate-encryption-key` emits
  `{ kid, key }` (`kid` = first 16 hex of `sha256(key)`). Held by CI for upload;
  shipped in the app via `plugins.OtaKit.bundleKeys` (array, to allow rotation).
  **Inject via env at build, not committed** to `capacitor.config.ts`.
- Confidentiality note: the KEK both encrypts (CLI) and decrypts (app). That's
  fine — it's the same guarantee as Capgo (the app-side key is extractable either
  way), and forgery is still blocked by the *separate* ES256 signing key.

### 4.2 Encrypting the bundle (the zip)

- Generate a random 256-bit **DEK** per bundle.
- Encrypt the zip with AES-256-GCM(DEK, random nonce). Store the ciphertext
  (tag appended) as the bundle object (`.enc`).
- Wrap the DEK once: `wrappedDek = AES-256-GCM(KEK, wrapNonce, DEK)`.
- **`sha256`/`size` refer to the uploaded object — i.e. the ciphertext.**
  (Correction from the earlier draft, which kept them as plaintext values.
  Verified against source: `finalize` HEAD-checks the stored object's size
  against `initiate`'s `size` (`bundles/finalize`: `uploadInfo.size !==
  session.expectedSize`), the presigned PUT pins `ContentLength`
  (`storage.ts:97`), and the plugin hash-verifies the *downloaded file* before
  anything else (`downloadAndStage` → `HashUtils.verify`). Plaintext values
  would break all three. With ciphertext addressing, **none of those checks
  change**, and plaintext integrity is already authenticated by the GCM tag —
  no separate plaintext hash needed. Bundle identity comparison on device
  (`doesBundleMatchLatest` matches `releaseId`, falling back to `sha256`) also
  keeps working unchanged.)

### 4.3 Manifest

Add an `encryption` block:

```jsonc
{
  "version": "1.2.3", "runtimeVersion": null, "releaseId": "…",
  "strategy": "zip",
  "url": "https://cdn/.../bundle.enc",
  "sha256": "<ciphertext hash>", "size": <ciphertext size>,
  "encryption": {
    "alg": "AES-256-GCM", "kid": "…",
    "wrapNonce": "b64", "wrappedDek": "b64", "nonce": "b64"
  },
  "signature": { … }
}
```

The signed canonical payload (extended directly — no users to break) gains
`encKid` + a hash of the encryption block, so tampering the wrapping fails native
verification. (`sha256`/`size` stay in the payload as today — now denoting the
ciphertext when encryption is on.) All three canonical-payload builders
(`manifest-signing.ts:59-77`, `ManifestVerifier.swift:81-104`, Android mirror)
change **in lockstep** — coordinate with the `forceImmediateUpdate` payload
change (plan 06) so the break happens once.

**Signing must be on when encryption is on.** Verified: when `manifestKeys` is
empty the plugin skips signature verification entirely
(`ManifestClient.swift:120-139`) — the encryption block would then be
unauthenticated. The CLI should fail `--encrypt` unless manifest signing is
configured (it is by default on hosted; `HostedManifestKeys` auto-applies).

### 4.4 Device flow

In `downloadAndStage`, the existing download and hash-verify steps run
**unchanged** (they now check the ciphertext); decrypt slots in between verify
and extract:
1. Download; verify SHA-256 of the downloaded file == `manifest.sha256`
   (existing `HashUtils.verify` — no change).
2. If `encryption` present: find the matching `kid` in `bundleKeys` (else fail
   clearly: "no matching bundle key" → surfaces via `getLastFailure`). Unwrap the
   DEK (AES-GCM with KEK), then AES-256-GCM-decrypt with DEK + `nonce`; the GCM
   tag authenticates the plaintext zip.
3. Extract (existing `ZipUtils.extractSecurely` — no change).

Native primitives: iOS **CryptoKit** `AES.GCM`; Android **javax.crypto**
`AES/GCM/NoPadding`. No third-party crypto dependency.

> **When `'deltas'` lands (Plan 01):** the same envelope applies per file — one
> DEK per bundle, a random nonce per file (carried in each file entry), dedup off
> while encrypting. Device-side reuse still works since the content cache is keyed
> on *plaintext* hash. Out of scope until deltas exist.

## 5. File-by-file change list

CLI (`packages/cli`):
- `commands/generate-encryption-key.ts` — new (mirror `generate-signing-key.ts`).
- `lib/crypto.ts` — new: `wrapDek`, `encryptFile` (AES-256-GCM, `node:crypto`).
- `lib/upload-workflow.ts` — when `bundleKeys`/`--encrypt`: gen DEK, **encrypt
  the zip** after `createZip`, then hash/measure the **ciphertext** for
  `initiate` (`sha256`, `size`), upload the `.enc`, pass the `encryption` block
  to finalize.
- `commands/upload.ts` — `--encrypt` (auto-on when `bundleKeys` present).
- `lib/capacitor-config.ts` — read `plugins.OtaKit.bundleKeys`.

Console (`packages/console`):
- `prisma/schema.prisma` — `Bundle.encryption Json?`. Migration.
- `bundles/initiate`/`finalize` — accept/validate/persist the encryption block;
  the encrypted zip is the bundle object.
- `lib/manifest-files.ts` — emit the `encryption` block.
- `lib/manifest-signing.ts` — canonical payload covers `encKid` + enc-block hash.

Plugin (`packages/capacitor-plugin`):
- `src/definitions.ts` — `bundleKeys?` config; `encryption?` on the manifest type.
- iOS: **`ManifestClient.swift`** — parse the `encryption` block into
  `LatestManifest` and pass the enc params into `ManifestVerifier.verify`
  (omitted from the earlier draft; the struct/parse live here, not in the
  verifier); read `bundleKeys` (`UpdaterPlugin.swift`); new `BundleCrypto.swift`
  (CryptoKit unwrap+decrypt); wire into `downloadAndStage`;
  `ManifestVerifier.swift` covers enc params in the canonical payload.
- Android mirror (`ManifestClient.java`, `BundleCrypto.java`, javax.crypto).

## 6. Security checklist

- [ ] AES-256-GCM; verify tags before use.
- [ ] Manifest signature covers `encKid` + enc-block hash; both natives verify.
- [ ] Ciphertext SHA-256 (= signed `manifest.sha256`) verified before decrypt;
      GCM tag authenticates the plaintext (no separate plaintext hash).
- [ ] `--encrypt` refuses to run without manifest signing configured.
- [ ] Random nonce (CSPRNG); never reuse a (DEK, nonce) pair.
- [ ] KEK never logged / never in the manifest; injected via env, not committed.
- [ ] Rotation tested: two `kid`s configured, old + new bundles both decrypt.
- [ ] Threat model documented in the plugin README.

## 7. Testing

- CLI: encrypt→decrypt round-trip; wrapped DEK unwraps.
- Native↔CLI cross-impl test vectors (checked into the repo) so CryptoKit /
  javax.crypto match `node:crypto`.
- Signing: enc-param tamper fails native verify; wrong `kid` aborts; rotation
  works.
- E2E (`examples/demo-app`): encrypted release downloads, decrypts, applies, rolls
  back; the R2 object is unreadable without the key.

## 8. Rollout / phasing

1. **Phase 1 (v1)** — encrypt the zip: random DEK wrapped under the app KEK; CLI
   `--encrypt`; signed enc params; native decrypt-then-extract.
2. **Phase 2** — rotation UX (`key list` / `key add`).
3. **Later** — per-file encryption when `'deltas'` lands (see §4.4 note).

## 9. Open questions

- Config key name `bundleKeys` (encrypt/decrypt) vs `manifestKeys` (verify only) —
  keep distinct names to avoid confusion.
- Asymmetric "upload side can't decrypt" variant — out of scope; symmetric matches
  the one-key-per-app model and is simplest.
