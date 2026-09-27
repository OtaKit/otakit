import crypto from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  classifyFcmResponse,
  parseServiceAccount,
  sendFcmBatch,
  signFcmAssertion,
  type FcmServiceAccount,
} from './fcm';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const account: FcmServiceAccount = {
  project_id: 'demo-project',
  client_email: 'push@demo-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  private_key_id: 'key-1',
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('parseServiceAccount', () => {
  it('accepts a service account key', () => {
    const parsed = parseServiceAccount(JSON.stringify({ type: 'service_account', ...account }));
    expect(parsed.project_id).toBe('demo-project');
  });

  it('explains what is wrong with other files', () => {
    expect(() => parseServiceAccount('nope')).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ project_id: 'x' }))).toThrow(
      /service_account/,
    );
    expect(() =>
      parseServiceAccount(JSON.stringify({ type: 'service_account', project_id: 'x' })),
    ).toThrow(/client_email/);
    expect(() =>
      parseServiceAccount(
        JSON.stringify({ ...account, type: 'service_account', private_key: 'garbage' }),
      ),
    ).toThrow(/could not be read/);
  });
});

describe('signFcmAssertion', () => {
  it('is an RS256 JWT for the FCM scope that verifies', () => {
    const jwt = signFcmAssertion(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'key-1',
    });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(
      crypto.verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });
});

describe('classifyFcmResponse', () => {
  const body = (status: string, errorCode?: string, message = '') => ({
    error: {
      status,
      message,
      details: errorCode
        ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }]
        : [],
    },
  });

  it.each([
    [200, undefined, 'ok'],
    [404, body('NOT_FOUND', 'UNREGISTERED'), 'invalid'],
    [
      400,
      body(
        'INVALID_ARGUMENT',
        'INVALID_ARGUMENT',
        'The registration token is not a valid FCM registration token',
      ),
      'invalid',
    ],
    [
      400,
      body('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Invalid value at message.data'),
      'rejected',
    ],
    [403, body('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), 'auth'],
    [401, body('UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR'), 'auth'],
    [429, body('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), 'retry'],
    [503, body('UNAVAILABLE', 'UNAVAILABLE'), 'retry'],
    [500, body('INTERNAL', 'INTERNAL'), 'retry'],
  ] as const)('%s → %s', (status, responseBody, kind) => {
    expect(classifyFcmResponse(status, responseBody).kind).toBe(kind);
  });
});

describe('sendFcmBatch', () => {
  it('mints one OAuth token and sends one request per device', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      if (target === 'https://oauth2.googleapis.com/token') {
        return jsonResponse(200, { access_token: 'ya29.test', expires_in: 3599 });
      }
      const payload = JSON.parse(String(init?.body));
      if (payload.message.token === 'gone') {
        return jsonResponse(404, {
          error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] },
        });
      }
      return jsonResponse(200, { name: 'projects/demo-project/messages/1' });
    });

    const results = await sendFcmBatch({
      credential: { id: 'fcm-1', serviceAccount: account },
      items: [
        { deviceId: 'a', token: 'ok' },
        { deviceId: 'b', token: 'gone' },
      ],
      message: { notification: { title: 'Hi', body: 'There' }, data: { url: '/inbox' } },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(results.map((r) => [r.deviceId, r.kind])).toEqual([
      ['a', 'ok'],
      ['b', 'invalid'],
    ]);
    const sends = fetchImpl.mock.calls.filter(([url]) => String(url).includes('messages:send'));
    expect(sends).toHaveLength(2);
    expect(String(sends[0][0])).toBe(
      'https://fcm.googleapis.com/v1/projects/demo-project/messages:send',
    );
    expect((sends[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer ya29.test');
  });

  it('fails every item as auth when Google rejects the service account', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
    );
    const results = await sendFcmBatch({
      credential: { id: 'fcm-bad', serviceAccount: account },
      items: [{ deviceId: 'a', token: 'ok' }],
      message: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(results).toEqual([
      expect.objectContaining({ deviceId: 'a', kind: 'auth', reason: 'Invalid JWT Signature.' }),
    ]);
  });
});
