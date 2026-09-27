import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  classifyApnsResponse,
  getApnsProviderToken,
  sendApnsBatch,
  signApnsProviderToken,
  type ApnsCredential,
} from './apns';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const credential: ApnsCredential = {
  id: 'cred-1',
  keyId: 'ABC123DEFG',
  teamId: 'TEAM123456',
  bundleId: 'com.example.app',
  privateKeyPem,
};

describe('APNs provider token', () => {
  it('is an ES256 JWT with kid, iss and iat that verifies with the public key', () => {
    const token = signApnsProviderToken(credential, 1_700_000_000);
    const [header, claims, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'ABC123DEFG',
    });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'TEAM123456',
      iat: 1_700_000_000,
    });
    const valid = crypto.verify(
      'sha256',
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
    expect(valid).toBe(true);
  });

  it('is reused for 50 minutes and then renewed', () => {
    const cred = { ...credential, id: 'cache-test' };
    const first = getApnsProviderToken(cred, 1_000_000);
    expect(getApnsProviderToken(cred, 1_000_000 + 49 * 60_000)).toBe(first);
    expect(getApnsProviderToken(cred, 1_000_000 + 51 * 60_000)).not.toBe(first);
  });
});

describe('classifyApnsResponse', () => {
  it.each([
    [200, undefined, 'ok'],
    [410, 'Unregistered', 'invalid'],
    [400, 'BadDeviceToken', 'invalid'],
    [400, 'DeviceTokenNotForTopic', 'invalid'],
    [403, 'ExpiredProviderToken', 'auth'],
    [403, 'InvalidProviderToken', 'auth'],
    [400, 'BadTopic', 'auth'],
    [429, 'TooManyRequests', 'retry'],
    [503, 'ServiceUnavailable', 'retry'],
    [400, 'PayloadTooLarge', 'rejected'],
  ] as const)('%s %s → %s', (status, reason, kind) => {
    expect(classifyApnsResponse(status, reason)).toBe(kind);
  });
});

describe('sendApnsBatch against a local HTTP/2 server', () => {
  let server: http2.Http2SecureServer;
  let origin: string;
  let ca: Buffer;
  const seen: Array<{ path: string; topic: string; auth: string; body: string }> = [];

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apns-test-'));
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ]);
    ca = readFileSync(join(dir, 'cert.pem'));
    server = http2.createSecureServer({ key: readFileSync(join(dir, 'key.pem')), cert: ca });
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
      let body = '';
      stream.on('data', (chunk) => (body += chunk));
      stream.on('end', () => {
        const path = String(headers[':path']);
        seen.push({
          path,
          topic: String(headers['apns-topic']),
          auth: String(headers.authorization),
          body,
        });
        const token = path.split('/').pop();
        const responses: Record<string, [number, string | null]> = {
          ok1: [200, null],
          gone: [410, 'Unregistered'],
          bad: [400, 'BadDeviceToken'],
          busy: [429, 'TooManyRequests'],
        };
        const [status, reason] = responses[token ?? ''] ?? [200, null];
        stream.respond({ ':status': status, 'apns-id': `id-${token}` });
        stream.end(reason ? JSON.stringify({ reason }) : undefined);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `https://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends every item and classifies each response', async () => {
    const results = await sendApnsBatch({
      credential: { ...credential, id: 'server-test' },
      environment: 'sandbox',
      items: [
        { deviceId: 'd1', token: 'ok1' },
        { deviceId: 'd2', token: 'gone' },
        { deviceId: 'd3', token: 'bad' },
        { deviceId: 'd4', token: 'busy' },
      ],
      payload: { aps: { alert: { title: 'Hi', body: 'There' } } },
      connectOptions: { origin, ca },
    });
    expect(results.map((r) => [r.deviceId, r.kind])).toEqual([
      ['d1', 'ok'],
      ['d2', 'invalid'],
      ['d3', 'invalid'],
      ['d4', 'retry'],
    ]);
    expect(results[0].apnsId).toBe('id-ok1');
    expect(seen.every((request) => request.topic === 'com.example.app')).toBe(true);
    expect(seen.every((request) => request.auth.startsWith('bearer '))).toBe(true);
    expect(JSON.parse(seen[0].body)).toEqual({ aps: { alert: { title: 'Hi', body: 'There' } } });
  });

  it('rejects payloads over 4 KB without connecting', async () => {
    const results = await sendApnsBatch({
      credential,
      environment: 'sandbox',
      items: [{ deviceId: 'd1', token: 'ok1' }],
      payload: { aps: { alert: 'x'.repeat(5000) } },
      connectOptions: { origin: 'https://127.0.0.1:1' },
    });
    expect(results[0]).toMatchObject({ kind: 'rejected', reason: 'PayloadTooLarge' });
  });

  it('marks everything for retry when the connection fails', async () => {
    const results = await sendApnsBatch({
      credential,
      environment: 'sandbox',
      items: [{ deviceId: 'd1', token: 'ok1' }],
      payload: { aps: { alert: 'hi' } },
      connectOptions: { origin: 'https://127.0.0.1:1', ca },
    });
    expect(results).toEqual([expect.objectContaining({ deviceId: 'd1', kind: 'retry' })]);
  });
});
