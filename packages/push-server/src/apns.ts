import crypto from 'node:crypto';
import http2 from 'node:http2';

/**
 * Apple Push Notification service client (HTTP/2, token-based auth).
 *
 * APNs only speaks HTTP/2, so this uses node:http2 instead of fetch. Every
 * request's stream is awaited to `end` before the session closes: returning
 * early lets a serverless function exit before the push is actually sent.
 */

export type ApnsEnvironment = 'production' | 'sandbox';

export type ApnsCredential = {
  /** Cache key for the signed provider token (the PushCredential ID). */
  id: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPem: string;
};

export type ApnsSendItem = { deviceId: string; token: string };

export type ApnsResultKind = 'ok' | 'invalid' | 'retry' | 'auth' | 'rejected';

export type ApnsResult = {
  deviceId: string;
  kind: ApnsResultKind;
  status: number;
  reason?: string;
  apnsId?: string;
};

export type ApnsSendOptions = {
  credential: ApnsCredential;
  environment: ApnsEnvironment;
  items: ApnsSendItem[];
  payload: Record<string, unknown>;
  pushType?: 'alert' | 'background';
  priority?: 5 | 10;
  expirationUnix?: number;
  collapseId?: string;
  /** Test hook: override the origin and TLS options. */
  connectOptions?: { origin: string; ca?: string | Buffer };
  maxConcurrentStreams?: number;
};

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

export const APNS_MAX_PAYLOAD_BYTES = 4096;

// Apple: refresh the provider token no more than once every 20 minutes and no
// less than once every 60. 50 minutes sits safely inside that window.
const TOKEN_TTL_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const tokenCache = new Map<string, { token: string; createdAt: number }>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signApnsProviderToken(
  credential: Pick<ApnsCredential, 'keyId' | 'teamId' | 'privateKeyPem'>,
  issuedAtSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: credential.keyId }));
  const claims = base64url(JSON.stringify({ iss: credential.teamId, iat: issuedAtSeconds }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: credential.privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

export function getApnsProviderToken(credential: ApnsCredential, now: number = Date.now()): string {
  const cached = tokenCache.get(credential.id);
  if (cached && now - cached.createdAt < TOKEN_TTL_MS) {
    return cached.token;
  }
  const token = signApnsProviderToken(credential, Math.floor(now / 1000));
  tokenCache.set(credential.id, { token, createdAt: now });
  return token;
}

/** Drop a cached token, e.g. after APNs says it expired or is invalid. */
export function forgetApnsProviderToken(credentialId: string): void {
  tokenCache.delete(credentialId);
}

export function classifyApnsResponse(status: number, reason: string | undefined): ApnsResultKind {
  if (status === 200) return 'ok';
  if (status === 410) return 'invalid';
  if (status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic')) {
    return 'invalid';
  }
  if (
    status === 403 &&
    (reason === 'ExpiredProviderToken' ||
      reason === 'InvalidProviderToken' ||
      reason === 'MissingProviderToken')
  ) {
    return 'auth';
  }
  if (status === 400 && (reason === 'BadTopic' || reason === 'TopicDisallowed')) {
    return 'auth';
  }
  if (status === 403) return 'auth';
  if (status === 429 || status >= 500) return 'retry';
  return 'rejected';
}

export async function sendApnsBatch(options: ApnsSendOptions): Promise<ApnsResult[]> {
  const {
    credential,
    environment,
    items,
    payload,
    pushType = 'alert',
    priority = pushType === 'background' ? 5 : 10,
    expirationUnix,
    collapseId,
    connectOptions,
    maxConcurrentStreams = 100,
  } = options;
  if (items.length === 0) return [];

  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > APNS_MAX_PAYLOAD_BYTES) {
    return items.map((item) => ({
      deviceId: item.deviceId,
      kind: 'rejected',
      status: 413,
      reason: 'PayloadTooLarge',
    }));
  }

  const origin = connectOptions?.origin ?? APNS_HOSTS[environment];
  const session = http2.connect(origin, connectOptions?.ca ? { ca: connectOptions.ca } : {});
  const sessionError = new Promise<Error>((resolve) => session.once('error', resolve));
  const authorization = `bearer ${getApnsProviderToken(credential)}`;

  const sendOne = (item: ApnsSendItem): Promise<ApnsResult> =>
    new Promise((resolve) => {
      const headers: http2.OutgoingHttpHeaders = {
        ':method': 'POST',
        ':path': `/3/device/${item.token}`,
        authorization,
        'apns-topic': credential.bundleId,
        'apns-push-type': pushType,
        'apns-priority': String(priority),
        'content-type': 'application/json',
      };
      if (expirationUnix !== undefined) headers['apns-expiration'] = String(expirationUnix);
      if (collapseId) headers['apns-collapse-id'] = collapseId.slice(0, 64);

      let settled = false;
      const finish = (result: Omit<ApnsResult, 'deviceId'>) => {
        if (settled) return;
        settled = true;
        resolve({ deviceId: item.deviceId, ...result });
      };

      let request: http2.ClientHttp2Stream;
      try {
        request = session.request(headers);
      } catch (error) {
        finish({ kind: 'retry', status: 0, reason: errorMessage(error) });
        return;
      }
      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.close(http2.constants.NGHTTP2_CANCEL);
        finish({ kind: 'retry', status: 0, reason: 'Timeout' });
      });

      let status = 0;
      let apnsId: string | undefined;
      const chunks: Buffer[] = [];
      request.on('response', (responseHeaders) => {
        status = Number(responseHeaders[':status'] ?? 0);
        const id = responseHeaders['apns-id'];
        apnsId = typeof id === 'string' ? id : undefined;
      });
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        let reason: string | undefined;
        if (chunks.length > 0) {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              reason?: string;
            };
            reason = parsed.reason;
          } catch {
            reason = undefined;
          }
        }
        finish({ kind: classifyApnsResponse(status, reason), status, reason, apnsId });
      });
      request.on('error', (error) =>
        finish({ kind: 'retry', status: 0, reason: errorMessage(error) }),
      );
      request.end(body);
    });

  const results: ApnsResult[] = [];
  try {
    for (let i = 0; i < items.length; i += maxConcurrentStreams) {
      const chunk = items.slice(i, i + maxConcurrentStreams);
      const settled = await Promise.race([
        Promise.all(chunk.map(sendOne)),
        sessionError.then((error) => {
          throw error;
        }),
      ]);
      results.push(...settled);
    }
  } catch (error) {
    // The connection failed mid-batch: whatever has no result yet is retried.
    const answered = new Set(results.map((result) => result.deviceId));
    for (const item of items) {
      if (!answered.has(item.deviceId)) {
        results.push({
          deviceId: item.deviceId,
          kind: 'retry',
          status: 0,
          reason: errorMessage(error),
        });
      }
    }
  } finally {
    await new Promise<void>((resolve) => {
      if (session.closed || session.destroyed) {
        resolve();
        return;
      }
      session.close(() => resolve());
    });
  }

  if (results.some((result) => result.kind === 'auth')) {
    forgetApnsProviderToken(credential.id);
  }
  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'Unknown error';
}
