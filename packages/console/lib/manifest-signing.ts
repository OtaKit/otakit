import crypto from 'node:crypto';

const MANIFEST_PAYLOAD_HEADER = 'MANIFEST';
const DEFAULT_MANIFEST_TTL_SECONDS = 31_536_000; // 1 year

export type ManifestStrategy = 'zip' | 'deltas';

export interface ManifestEncryptionInput {
  alg: string;
  kid: string;
  wrapNonce: string;
  wrappedDek: string;
  nonce: string;
}

export interface ManifestSignatureInput {
  appId: string;
  channel: string | null;
  version: string;
  sha256: string;
  size: number;
  runtimeVersion: string | null;
  /** Update strategy baked into the manifest. Defaults to 'zip'. */
  strategy?: ManifestStrategy;
  /** Per-release emergency escalation flag. Defaults to false. */
  forceImmediate?: boolean;
  /** Bundle encryption parameters, or null when the bundle is not encrypted. */
  encryption?: ManifestEncryptionInput | null;
}

export interface ManifestSignature {
  kid: string;
  sig: string;
  iat: number;
  exp: number;
}

let cachedKey: { privateKey: crypto.KeyObject; kid: string } | null = null;
let keyChecked = false;

function isManifestSigningDisabled(): boolean {
  const raw = process.env.MANIFEST_SIGNING_DISABLED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function getSigningKey(): { privateKey: crypto.KeyObject; kid: string } | null {
  if (keyChecked) return cachedKey;
  keyChecked = true;

  if (isManifestSigningDisabled()) {
    return null;
  }

  const pem = process.env.MANIFEST_SIGNING_KEY;
  const kid = process.env.MANIFEST_SIGNING_KID;
  if (!pem || !kid) {
    throw new Error(
      'Manifest signing is enabled by default. Set MANIFEST_SIGNING_KID and MANIFEST_SIGNING_KEY, or explicitly set MANIFEST_SIGNING_DISABLED=true.',
    );
  }

  cachedKey = {
    privateKey: crypto.createPrivateKey(pem),
    kid,
  };
  return cachedKey;
}

/**
 * Encode the encryption block for the canonical payload.
 *
 * "null" when the bundle is not encrypted; otherwise a fixed-order
 * pipe-joined string covering every encryption parameter, so tampering any
 * of them invalidates the signature.
 */
function encodeEncryptionForPayload(
  encryption: ManifestEncryptionInput | null | undefined,
): string {
  if (!encryption) {
    return 'null';
  }
  return [
    encryption.alg,
    encryption.kid,
    encryption.wrapNonce,
    encryption.wrappedDek,
    encryption.nonce,
  ].join('|');
}

/**
 * Build the deterministic canonical payload string (payload v2).
 *
 * Format: fixed field order, newline-separated, explicit "null" for missing values.
 * Both server and native plugins must produce the identical string
 * (see ManifestVerifier.swift / ManifestVerifier.java).
 *
 * v2 adds `strategy`, `forceImmediate`, and `encryption` between
 * `runtimeVersion` and `kid`. All three are always present with explicit
 * defaults (`zip` / `false` / `null`) so future features populate existing
 * fields instead of changing the format again.
 */
export function buildCanonicalPayload(
  fields: ManifestSignatureInput,
  kid: string,
  iat: number,
  exp: number,
): string {
  return [
    MANIFEST_PAYLOAD_HEADER,
    `appId:${fields.appId}`,
    `channel:${fields.channel ?? 'null'}`,
    `version:${fields.version}`,
    `sha256:${fields.sha256}`,
    `size:${fields.size}`,
    `runtimeVersion:${fields.runtimeVersion ?? 'null'}`,
    `strategy:${fields.strategy ?? 'zip'}`,
    `forceImmediate:${fields.forceImmediate ? 'true' : 'false'}`,
    `encryption:${encodeEncryptionForPayload(fields.encryption)}`,
    `kid:${kid}`,
    `iat:${iat}`,
    `exp:${exp}`,
  ].join('\n');
}

/**
 * Sign manifest fields with ES256 (ECDSA P-256 + SHA-256).
 *
 * Returns null only when manifest signing is explicitly disabled.
 */
export function signManifest(fields: ManifestSignatureInput): ManifestSignature | null {
  const key = getSigningKey();
  if (!key) return null;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + DEFAULT_MANIFEST_TTL_SECONDS;

  const payload = buildCanonicalPayload(fields, key.kid, iat, exp);
  const payloadBuffer = Buffer.from(payload, 'utf-8');

  const signature = crypto.sign('sha256', payloadBuffer, key.privateKey);
  const sig = signature
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return {
    kid: key.kid,
    sig,
    iat,
    exp,
  };
}
