import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { isBlockedAddress, postJson, validateDestinationUrl } from './safe-fetch';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fd00::1',
    'fe80::1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '151.101.1.69',
    '172.32.0.1',
    '::ffff:8.8.8.8',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4001::200e',
  ])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('validateDestinationUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts public https URLs and normalizes them', () => {
    expect(validateDestinationUrl('webhook', ' https://example.com/hooks/otakit ')).toEqual({
      url: 'https://example.com/hooks/otakit',
    });
  });

  it.each([
    ['', 'URL is required'],
    ['not a url', 'Enter a valid URL'],
    ['http://example.com/hook', 'https://'],
    ['ftp://example.com/hook', 'https://'],
    ['https://user:pass@example.com/hook', 'username or password'],
    ['https://localhost/hook', 'public address'],
    ['https://api.localhost/hook', 'public address'],
    ['https://127.0.0.1/hook', 'public address'],
    ['https://169.254.169.254/latest/meta-data', 'public address'],
    ['https://[::1]/hook', 'public address'],
    ['https://[::ffff:10.0.0.1]/hook', 'public address'],
  ])('rejects %j', (url, message) => {
    const result = validateDestinationUrl('webhook', url);
    expect('error' in result && result.error).toContain(message);
  });

  it('accepts only Slack incoming webhook URLs for Slack', () => {
    expect(
      validateDestinationUrl('slack', 'https://hooks.slack.com/services/T000/B000/XXXX'),
    ).toEqual({ url: 'https://hooks.slack.com/services/T000/B000/XXXX' });
    expect(validateDestinationUrl('slack', 'https://example.com/services/T000')).toHaveProperty(
      'error',
    );
    expect(
      validateDestinationUrl('slack', 'https://hooks.slack.com/triggers/T000/1/abc'),
    ).toHaveProperty('error');
  });

  it('accepts only Discord webhook URLs for Discord', () => {
    for (const url of [
      'https://discord.com/api/webhooks/1/abc',
      'https://discordapp.com/api/webhooks/1/abc',
    ]) {
      expect(validateDestinationUrl('discord', url)).toEqual({ url });
    }
    expect(validateDestinationUrl('discord', 'https://discord.com/channels/1/2')).toHaveProperty(
      'error',
    );
    expect(
      validateDestinationUrl('discord', 'https://evil.example/api/webhooks/1/abc'),
    ).toHaveProperty('error');
  });

  it('allows http and private addresses when self-hosting opts in', () => {
    vi.stubEnv('NOTIFICATIONS_ALLOW_PRIVATE_URLS', 'true');
    expect(validateDestinationUrl('webhook', 'http://10.0.0.5:8080/hook')).toEqual({
      url: 'http://10.0.0.5:8080/hook',
    });
  });
});

describe('postJson', () => {
  let server: http.Server;
  let base: string;
  const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body });
        if (request.url === '/redirect') {
          response.writeHead(302, { location: 'https://elsewhere.example/hook' }).end();
        } else if (request.url === '/large') {
          response.writeHead(500).end('x'.repeat(100_000));
        } else if (request.url === '/hang') {
          // never answers
        } else {
          response.writeHead(200).end('ok');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  afterEach(() => vi.unstubAllEnvs());

  it('refuses private addresses unless self-hosting opts in', async () => {
    await expect(postJson(`${base}/ok`, '{}', {})).rejects.toThrow(/https/);
    await expect(postJson('https://127.0.0.1:1/ok', '{}', {})).rejects.toThrow(
      /private or reserved/,
    );
    // Hostnames are resolved and checked before connecting.
    await expect(postJson('https://localhost:1/ok', '{}', {})).rejects.toThrow(
      /private or reserved/,
    );
  });

  it('posts JSON and returns the status and start of the body', async () => {
    vi.stubEnv('NOTIFICATIONS_ALLOW_PRIVATE_URLS', 'true');
    const result = await postJson(`${base}/ok`, '{"a":1}', { 'user-agent': 'test' });
    expect(result).toEqual({ statusCode: 200, body: 'ok', location: null });
    const request = received.at(-1)!;
    expect(request.body).toBe('{"a":1}');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['user-agent']).toBe('test');
  });

  it('does not follow redirects', async () => {
    vi.stubEnv('NOTIFICATIONS_ALLOW_PRIVATE_URLS', 'true');
    await expect(postJson(`${base}/redirect`, '{}', {})).resolves.toMatchObject({
      statusCode: 302,
      location: 'https://elsewhere.example/hook',
    });
  });

  it('keeps at most 2 KB of the response', async () => {
    vi.stubEnv('NOTIFICATIONS_ALLOW_PRIVATE_URLS', 'true');
    const result = await postJson(`${base}/large`, '{}', {});
    expect(result.statusCode).toBe(500);
    expect(result.body).toHaveLength(2048);
  });

  it('gives up when no response arrives in time', async () => {
    vi.stubEnv('NOTIFICATIONS_ALLOW_PRIVATE_URLS', 'true');
    await expect(postJson(`${base}/hang`, '{}', {}, 200)).rejects.toThrow('No response within 0 s');
  });
});
