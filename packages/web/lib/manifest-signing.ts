import crypto from 'node:crypto';

const LEGACY_MANIFEST_PAYLOAD_VERSION = 'MANIFEST_V1';
const MANIFEST_PAYLOAD_VERSION = 'MANIFEST_V2';
const DEFAULT_MANIFEST_TTL_SECONDS = 600; // 10 minutes

export interface ManifestSignatureInput {
  appId: string;
  channel: string | null;
  platform: string;
  version: string;
  sha256: string;
  size: number;
  runtimeVersion: string | null;
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
 * Build the deterministic canonical payload string.
 *
 * Format: fixed field order, newline-separated, explicit "null" for missing values.
 * Both server and native plugins must produce the identical string.
 */
export function buildCanonicalPayload(
  fields: ManifestSignatureInput,
  kid: string,
  iat: number,
  exp: number,
): string {
  return [
    MANIFEST_PAYLOAD_VERSION,
    `appId:${fields.appId}`,
    `channel:${fields.channel ?? 'null'}`,
    `platform:${fields.platform}`,
    `version:${fields.version}`,
    `sha256:${fields.sha256}`,
    `size:${fields.size}`,
    `runtimeVersion:${fields.runtimeVersion ?? 'null'}`,
    `kid:${kid}`,
    `iat:${iat}`,
    `exp:${exp}`,
  ].join('\n');
}

export function buildLegacyCanonicalPayload(
  fields: ManifestSignatureInput,
  kid: string,
  iat: number,
  exp: number,
): string {
  return [
    LEGACY_MANIFEST_PAYLOAD_VERSION,
    `appId:${fields.appId}`,
    `channel:${fields.channel ?? 'null'}`,
    `platform:${fields.platform}`,
    `version:${fields.version}`,
    `sha256:${fields.sha256}`,
    `size:${fields.size}`,
    'minNativeBuild:null',
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

export function signLegacyManifest(fields: ManifestSignatureInput): ManifestSignature | null {
  const key = getSigningKey();
  if (!key) return null;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + DEFAULT_MANIFEST_TTL_SECONDS;

  const payload = buildLegacyCanonicalPayload(fields, key.kid, iat, exp);
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
