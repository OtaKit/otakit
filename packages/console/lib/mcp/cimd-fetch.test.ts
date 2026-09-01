import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));

import { fetchCimdMetadataResource } from './cimd-fetch';

describe('CIMD metadata fetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  });

  it('pins the validated address while preserving the HTTPS identity', async () => {
    mocks.request.mockImplementation((options, callback) => {
      const outgoing = Object.assign(new EventEmitter(), { end: vi.fn() });
      const incoming = Readable.from([
        Buffer.from('{"client_id":"https://client.example/client.json"}'),
      ]);
      Object.assign(incoming, {
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': 'application/json' },
      });
      queueMicrotask(() => callback(incoming));
      return outgoing;
    });

    const response = await fetchCimdMetadataResource('https://client.example/client.json', {
      headers: { Accept: 'application/json' },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      client_id: 'https://client.example/client.json',
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '93.184.216.34',
        servername: 'client.example',
        path: '/client.json',
        headers: expect.objectContaining({ host: 'client.example' }),
      }),
      expect.any(Function),
    );
  });

  it('rejects the hostname when any DNS result is not publicly routable', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(fetchCimdMetadataResource('https://client.example/client.json')).rejects.toThrow(
      'must resolve only to public addresses',
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
