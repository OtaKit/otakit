import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchCli: vi.fn() }));

vi.mock('./http.js', () => ({ fetchCli: mocks.fetchCli }));

import { ApiClient } from './api.js';

const config = {
  appId: '7bb828f1-797c-4d07-8254-068cac664f69',
  serverUrl: 'https://console.example.test',
  authToken: 'secret-test-token',
  authSource: 'env_token' as const,
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function publishedResult() {
  return {
    operationId: 'operation-1',
    idempotencyKey: 'attempt-1',
    publicationStatus: 'published',
    release: {
      id: '0ee77672-f7de-4291-bcd2-fac9bda4b92b',
      channel: null,
      bundleId: 'f32627ca-9e8c-4358-90d8-bde732400081',
      promotedAt: '2026-08-30T00:00:00.000Z',
    },
    previousRelease: null,
  };
}

describe('ApiClient release reliability contract', () => {
  beforeEach(() => vi.resetAllMocks());

  it('preserves the one-request release path for older self-hosted consoles', async () => {
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse(publishedResult()));
    const api = new ApiClient(config, 'test', { organizationId: 'org-fixed' });

    await api.release(null, 'f32627ca-9e8c-4358-90d8-bde732400081', {
      forceImmediate: true,
      autoRevert: true,
      autoRevertRatePercent: 25,
      autoRevertMinSample: 80,
    });

    expect(mocks.fetchCli).toHaveBeenCalledTimes(1);
    const publishOptions = mocks.fetchCli.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(publishOptions.headers);
    expect(headers.get('X-OtaKit-Organization-Id')).toBe('org-fixed');
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(String(publishOptions.body));
    expect(body).toMatchObject({
      forceImmediate: true,
      autoRevert: true,
      autoRevertRatePercent: 25,
      autoRevertMinSample: 80,
    });
    expect(body).not.toHaveProperty('expectedCurrentReleaseId');
  });

  it('uses the reviewed state and idempotency key supplied by MCP without preparing again', async () => {
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse(publishedResult()));
    const api = new ApiClient(config);

    await api.release('staging', 'f32627ca-9e8c-4358-90d8-bde732400081', {
      expectedCurrentReleaseId: null,
      idempotencyKey: 'mcp-attempt-7',
    });

    expect(mocks.fetchCli).toHaveBeenCalledTimes(1);
    const options = mocks.fetchCli.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('mcp-attempt-7');
    expect(JSON.parse(String(options.body))).toMatchObject({
      channel: 'staging',
      expectedCurrentReleaseId: null,
    });
  });
});
