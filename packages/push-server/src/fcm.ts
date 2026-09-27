import crypto from 'node:crypto';

/**
 * Firebase Cloud Messaging HTTP v1 client. One message per request (FCM removed
 * batch sending), authenticated with an OAuth token minted from the customer's
 * service account.
 */

export type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
};

export type FcmCredential = {
  /** Cache key for the OAuth token (the PushCredential ID). */
  id: string;
  serviceAccount: FcmServiceAccount;
};

export type FcmSendItem = { deviceId: string; token: string };

export type FcmResultKind = 'ok' | 'invalid' | 'retry' | 'auth' | 'rejected';

export type FcmResult = {
  deviceId: string;
  kind: FcmResultKind;
  status: number;
  reason?: string;
  retryAfterSeconds?: number;
};

export type FcmMessage = {
  notification?: { title?: string; body?: string };
  data?: Record<string, string>;
  android?: { priority?: 'HIGH' | 'NORMAL'; ttl?: string; collapse_key?: string };
};

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_REUSE_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const tokenCache = new Map<string, { token: string; createdAt: number }>();

type FetchLike = typeof fetch;

export function parseServiceAccount(json: string): FcmServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The service account file is not valid JSON.');
  }
  const value = parsed as Record<string, unknown>;
  if (value?.type !== 'service_account') {
    throw new Error('This is not a service account key (expected "type": "service_account").');
  }
  for (const field of ['project_id', 'client_email', 'private_key'] as const) {
    if (typeof value[field] !== 'string' || !(value[field] as string).trim()) {
      throw new Error(`The service account key is missing "${field}".`);
    }
  }
  try {
    crypto.createPrivateKey(value.private_key as string);
  } catch {
    throw new Error('The service account private key could not be read.');
  }
  return {
    project_id: value.project_id as string,
    client_email: value.client_email as string,
    private_key: value.private_key as string,
    private_key_id: typeof value.private_key_id === 'string' ? value.private_key_id : undefined,
  };
}

export function signFcmAssertion(
  account: FcmServiceAccount,
  issuedAtSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (account.private_key_id) header.kid = account.private_key_id;
  const claims = {
    iss: account.client_email,
    scope: OAUTH_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + 3600,
  };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(
    JSON.stringify(claims),
  ).toString('base64url')}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), account.private_key);
  return `${signingInput}.${signature.toString('base64url')}`;
}

export async function getFcmAccessToken(
  credential: FcmCredential,
  fetchImpl: FetchLike = fetch,
  now: number = Date.now(),
): Promise<string> {
  const cached = tokenCache.get(credential.id);
  if (cached && now - cached.createdAt < TOKEN_REUSE_MS) return cached.token;

  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signFcmAssertion(credential.serviceAccount, Math.floor(now / 1000)),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new FcmAuthError(
      payload.error_description ||
        payload.error ||
        `Google token request failed (${response.status})`,
    );
  }
  tokenCache.set(credential.id, { token: payload.access_token, createdAt: now });
  return payload.access_token;
}

export class FcmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FcmAuthError';
  }
}

export function forgetFcmAccessToken(credentialId: string): void {
  tokenCache.delete(credentialId);
}

type FcmErrorBody = {
  error?: {
    status?: string;
    message?: string;
    details?: Array<{ '@type'?: string; errorCode?: string }>;
  };
};

export function classifyFcmResponse(
  status: number,
  body: FcmErrorBody | undefined,
): { kind: FcmResultKind; reason?: string } {
  if (status >= 200 && status < 300) return { kind: 'ok' };
  const fcmCode = body?.error?.details?.find((detail) => detail.errorCode)?.errorCode;
  const reason = fcmCode ?? body?.error?.status;
  const message = body?.error?.message ?? '';

  if (reason === 'UNREGISTERED' || status === 404)
    return { kind: 'invalid', reason: reason ?? 'NOT_FOUND' };
  if (reason === 'SENDER_ID_MISMATCH' || reason === 'THIRD_PARTY_AUTH_ERROR') {
    return { kind: 'auth', reason };
  }
  if (status === 401 || status === 403) return { kind: 'auth', reason: reason ?? String(status) };
  if (reason === 'QUOTA_EXCEEDED' || status === 429)
    return { kind: 'retry', reason: reason ?? '429' };
  if (reason === 'UNAVAILABLE' || reason === 'INTERNAL' || status >= 500) {
    return { kind: 'retry', reason: reason ?? String(status) };
  }
  if (reason === 'INVALID_ARGUMENT' && /registration token|token/i.test(message)) {
    return { kind: 'invalid', reason };
  }
  return { kind: 'rejected', reason: reason ?? String(status) };
}

export async function sendFcmBatch(options: {
  credential: FcmCredential;
  items: FcmSendItem[];
  message: FcmMessage;
  validateOnly?: boolean;
  concurrency?: number;
  fetchImpl?: FetchLike;
}): Promise<FcmResult[]> {
  const { credential, items, message, validateOnly = false, concurrency = 50 } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (items.length === 0) return [];

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken(credential, fetchImpl);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : 'OAuth failed';
    const kind: FcmResultKind = error instanceof FcmAuthError ? 'auth' : 'retry';
    return items.map((item) => ({ deviceId: item.deviceId, kind, status: 0, reason }));
  }

  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
    credential.serviceAccount.project_id,
  )}/messages:send`;

  const sendOne = async (item: FcmSendItem): Promise<FcmResult> => {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          validate_only: validateOnly,
          message: { ...message, token: item.token },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = response.ok
        ? undefined
        : ((await response.json().catch(() => undefined)) as FcmErrorBody | undefined);
      const { kind, reason } = classifyFcmResponse(response.status, body);
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        deviceId: item.deviceId,
        kind,
        status: response.status,
        reason,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      };
    } catch (error) {
      return {
        deviceId: item.deviceId,
        kind: 'retry',
        status: 0,
        reason: error instanceof Error ? error.message.slice(0, 200) : 'Network error',
      };
    }
  };

  const results: FcmResult[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    results.push(...(await Promise.all(items.slice(i, i + concurrency).map(sendOne))));
  }
  if (results.some((result) => result.kind === 'auth')) forgetFcmAccessToken(credential.id);
  return results;
}
