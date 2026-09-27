import crypto from 'node:crypto';

import { sendApnsBatch, type ApnsCredential } from './apns';
import { type PushProvider, pushDb } from './db';
import { invalidInput as invalid, PushError } from './errors';
import { parseServiceAccount, sendFcmBatch, type FcmCredential } from './fcm';
import { decryptSecret, encryptSecret } from './secret-box';

export type PushCredentialSummary = {
  provider: PushProvider;
  apnsKeyId: string | null;
  apnsTeamId: string | null;
  apnsBundleId: string | null;
  fcmProjectId: string | null;
  fcmClientEmail: string | null;
  lastTestAt: string | null;
  lastTestResult: string | null;
  updatedAt: string;
};

export type CredentialTestResult = { ok: boolean; result: string; message: string };

const APPLE_ID_PATTERN = /^[A-Z0-9]{10}$/;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9.-]{1,155}$/;
// A syntactically valid token that no device owns: APNs answers BadDeviceToken
// only after it has accepted our provider token, which is what we want to prove.
const APNS_PROBE_TOKEN = '0'.repeat(64);
const FCM_PROBE_TOKEN = 'otakit-credential-test';

function aad(appId: string, provider: PushProvider): string {
  return `push-credential:${appId}:${provider}`;
}

export function validateApnsInput(input: {
  p8Pem: unknown;
  keyId: unknown;
  teamId: unknown;
  bundleId: unknown;
}): { p8Pem: string; keyId: string; teamId: string; bundleId: string } {
  const p8Pem = typeof input.p8Pem === 'string' ? input.p8Pem.trim() : '';
  const keyId = typeof input.keyId === 'string' ? input.keyId.trim().toUpperCase() : '';
  const teamId = typeof input.teamId === 'string' ? input.teamId.trim().toUpperCase() : '';
  const bundleId = typeof input.bundleId === 'string' ? input.bundleId.trim() : '';

  if (!p8Pem.includes('BEGIN PRIVATE KEY')) {
    throw invalid(
      'Upload the .p8 key file from Apple (it starts with "-----BEGIN PRIVATE KEY-----").',
    );
  }
  let key: crypto.KeyObject;
  try {
    key = crypto.createPrivateKey(p8Pem);
  } catch {
    throw invalid('The .p8 key could not be read. Upload the file exactly as Apple provided it.');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw invalid('This is not an APNs key. APNs keys are P-256 elliptic-curve keys (.p8).');
  }
  if (!APPLE_ID_PATTERN.test(keyId))
    throw invalid('Key ID is 10 letters and digits, e.g. ABC123DEFG.');
  if (!APPLE_ID_PATTERN.test(teamId))
    throw invalid('Team ID is 10 letters and digits, e.g. A1B2C3D4E5.');
  if (!BUNDLE_ID_PATTERN.test(bundleId))
    throw invalid('Enter the iOS bundle ID, e.g. com.example.app.');
  return { p8Pem: `${p8Pem}\n`, keyId, teamId, bundleId };
}

export async function saveApnsCredential(input: {
  appId: string;
  actorLabel: string;
  body: Record<string, unknown>;
}): Promise<PushCredentialSummary> {
  const value = validateApnsInput({
    p8Pem: input.body.p8Pem,
    keyId: input.body.keyId,
    teamId: input.body.teamId,
    bundleId: input.body.bundleId,
  });
  const data = {
    sealedSecret: encryptSecret(value.p8Pem, aad(input.appId, 'apns')),
    apnsKeyId: value.keyId,
    apnsTeamId: value.teamId,
    apnsBundleId: value.bundleId,
    lastTestAt: null,
    lastTestResult: null,
    createdBy: input.actorLabel,
  };
  const row = await pushDb().pushCredential.upsert({
    where: { appId_provider: { appId: input.appId, provider: 'apns' } },
    create: { appId: input.appId, provider: 'apns', ...data },
    update: data,
  });
  return toSummary(row);
}

export async function saveFcmCredential(input: {
  appId: string;
  actorLabel: string;
  serviceAccountJson: unknown;
}): Promise<PushCredentialSummary> {
  if (typeof input.serviceAccountJson !== 'string' || input.serviceAccountJson.length > 20_000) {
    throw invalid('Upload the Firebase service account JSON file.');
  }
  let account;
  try {
    account = parseServiceAccount(input.serviceAccountJson);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : 'Invalid service account file.');
  }
  const data = {
    sealedSecret: encryptSecret(JSON.stringify(account), aad(input.appId, 'fcm')),
    fcmProjectId: account.project_id,
    fcmClientEmail: account.client_email,
    lastTestAt: null,
    lastTestResult: null,
    createdBy: input.actorLabel,
  };
  const row = await pushDb().pushCredential.upsert({
    where: { appId_provider: { appId: input.appId, provider: 'fcm' } },
    create: { appId: input.appId, provider: 'fcm', ...data },
    update: data,
  });
  return toSummary(row);
}

export async function listPushCredentials(appId: string): Promise<PushCredentialSummary[]> {
  const rows = await pushDb().pushCredential.findMany({
    where: { appId },
    orderBy: { provider: 'asc' },
  });
  return rows.map(toSummary);
}

/** Returns whether a credential was removed. */
export async function deletePushCredential(input: {
  appId: string;
  provider: PushProvider;
}): Promise<boolean> {
  const deleted = await pushDb().pushCredential.deleteMany({
    where: { appId: input.appId, provider: input.provider },
  });
  return deleted.count > 0;
}

export async function loadApnsCredential(appId: string): Promise<ApnsCredential | null> {
  const row = await pushDb().pushCredential.findUnique({
    where: { appId_provider: { appId, provider: 'apns' } },
  });
  if (!row || !row.apnsKeyId || !row.apnsTeamId || !row.apnsBundleId) return null;
  return {
    id: row.id,
    keyId: row.apnsKeyId,
    teamId: row.apnsTeamId,
    bundleId: row.apnsBundleId,
    privateKeyPem: decryptSecret(row.sealedSecret, aad(appId, 'apns')),
  };
}

export async function loadFcmCredential(appId: string): Promise<FcmCredential | null> {
  const row = await pushDb().pushCredential.findUnique({
    where: { appId_provider: { appId, provider: 'fcm' } },
  });
  if (!row) return null;
  return {
    id: row.id,
    serviceAccount: JSON.parse(decryptSecret(row.sealedSecret, aad(appId, 'fcm'))),
  };
}

/**
 * Proves the credential authenticates with Apple or Google without reaching any
 * device: a probe token that no device owns must be rejected as a bad token,
 * which the provider only says after it accepted our credentials.
 */
export async function testPushCredential(input: {
  appId: string;
  provider: PushProvider;
}): Promise<CredentialTestResult> {
  let result: CredentialTestResult;

  if (input.provider === 'apns') {
    const credential = await loadApnsCredential(input.appId);
    if (!credential) throw new PushError('NOT_FOUND', 'No APNs key uploaded.', 404);
    const [probe] = await sendApnsBatch({
      credential,
      environment: 'sandbox',
      items: [{ deviceId: 'probe', token: APNS_PROBE_TOKEN }],
      payload: { aps: { alert: 'OtaKit credential test' } },
    });
    if (probe.reason === 'BadDeviceToken') {
      result = { ok: true, result: 'ok', message: 'Apple accepted the key.' };
    } else if (probe.kind === 'auth') {
      result = {
        ok: false,
        result: probe.reason ?? 'auth',
        message:
          probe.reason === 'InvalidProviderToken'
            ? 'Apple rejected the key. Check the Key ID and Team ID, and that the key has APNs enabled.'
            : `Apple rejected the request (${probe.reason ?? probe.status}). Check the bundle ID and key.`,
      };
    } else {
      result = {
        ok: false,
        result: probe.reason ?? `status_${probe.status}`,
        message: `Could not confirm the key (${probe.reason ?? probe.status}). Try again in a minute.`,
      };
    }
  } else {
    const credential = await loadFcmCredential(input.appId);
    if (!credential) {
      throw new PushError('NOT_FOUND', 'No Firebase service account uploaded.', 404);
    }
    const [probe] = await sendFcmBatch({
      credential,
      items: [{ deviceId: 'probe', token: FCM_PROBE_TOKEN }],
      message: { notification: { title: 'OtaKit credential test' } },
      validateOnly: true,
    });
    if (probe.kind === 'invalid' || probe.kind === 'ok') {
      result = { ok: true, result: 'ok', message: 'Google accepted the service account.' };
    } else if (probe.kind === 'auth') {
      result = {
        ok: false,
        result: probe.reason ?? 'auth',
        message:
          probe.reason === 'PERMISSION_DENIED'
            ? 'Google rejected the service account (PERMISSION_DENIED). A key created in the last few minutes can take a moment to start working, so try again shortly. If it keeps failing, check that the Firebase Cloud Messaging API is enabled for this project.'
            : `Google rejected the service account (${probe.reason ?? probe.status}). Check that the Firebase Cloud Messaging API is enabled for this project.`,
      };
    } else {
      result = {
        ok: false,
        result: probe.reason ?? `status_${probe.status}`,
        message: `Could not confirm the service account (${probe.reason ?? probe.status}).`,
      };
    }
  }

  await pushDb().pushCredential.update({
    where: { appId_provider: { appId: input.appId, provider: input.provider } },
    data: { lastTestAt: new Date(), lastTestResult: result.result },
  });
  return result;
}

function toSummary(row: {
  provider: PushProvider;
  apnsKeyId: string | null;
  apnsTeamId: string | null;
  apnsBundleId: string | null;
  fcmProjectId: string | null;
  fcmClientEmail: string | null;
  lastTestAt: Date | null;
  lastTestResult: string | null;
  updatedAt: Date;
}): PushCredentialSummary {
  return {
    provider: row.provider,
    apnsKeyId: row.apnsKeyId,
    apnsTeamId: row.apnsTeamId,
    apnsBundleId: row.apnsBundleId,
    fcmProjectId: row.fcmProjectId,
    fcmClientEmail: row.fcmClientEmail,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastTestResult: row.lastTestResult,
    updatedAt: row.updatedAt.toISOString(),
  };
}
