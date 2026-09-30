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

  it('sends rollout options only when they are set', async () => {
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse(publishedResult()));
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse(publishedResult()));
    const api = new ApiClient(config);

    await api.release('production', 'f32627ca-9e8c-4358-90d8-bde732400081');
    await api.release('production', 'f32627ca-9e8c-4358-90d8-bde732400081', {
      rolloutPercent: 10,
      replaceRollout: true,
    });

    const [plain, rollout] = mocks.fetchCli.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(plain).not.toHaveProperty('rolloutPercent');
    expect(plain).not.toHaveProperty('replaceRollout');
    expect(rollout).toMatchObject({ rolloutPercent: 10, replaceRollout: true });
  });

  it('changes a rollout with its reviewed percentage and an idempotency key', async () => {
    mocks.fetchCli.mockResolvedValueOnce(
      jsonResponse({ ...publishedResult(), previousPercent: 10 }),
    );
    const api = new ApiClient(config);

    await api.updateRollout('0ee77672-f7de-4291-bcd2-fac9bda4b92b', {
      percent: 25,
      expectedPercent: 10,
    });

    const [url, options] = mocks.fetchCli.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://console.example.test/api/v1/apps/${config.appId}/releases/0ee77672-f7de-4291-bcd2-fac9bda4b92b/rollout`,
    );
    expect(options.method).toBe('PATCH');
    expect(new Headers(options.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(options.body))).toEqual({ percent: 25, expectedPercent: 10 });
  });

  it('cancels a rollout only at the reviewed share', async () => {
    mocks.fetchCli.mockResolvedValueOnce(
      jsonResponse({ ...publishedResult(), currentRelease: null }),
    );
    const api = new ApiClient(config);

    await api.revertRelease('0ee77672-f7de-4291-bcd2-fac9bda4b92b', {
      expectedCurrentReleaseId: '0ee77672-f7de-4291-bcd2-fac9bda4b92b',
      expectedRolloutPercent: 10,
    });

    const [url, options] = mocks.fetchCli.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/releases\/0ee77672-f7de-4291-bcd2-fac9bda4b92b\/revert$/);
    expect(JSON.parse(String(options.body))).toEqual({
      expectedCurrentReleaseId: '0ee77672-f7de-4291-bcd2-fac9bda4b92b',
      expectedRolloutPercent: 10,
    });
  });

  it('reads whether the server accepts rollouts, and says so when it cannot tell', async () => {
    const api = new ApiClient(config);
    mocks.fetchCli.mockResolvedValueOnce(
      jsonResponse({ capabilities: { releaseReliability: true } }),
    );
    await expect(api.supportsRollouts()).resolves.toBe(true);
    mocks.fetchCli.mockResolvedValueOnce(
      jsonResponse({ capabilities: { releaseReliability: false } }),
    );
    await expect(api.supportsRollouts()).resolves.toBe(false);
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404));
    await expect(api.supportsRollouts()).resolves.toBeNull();
    expect(String(mocks.fetchCli.mock.calls[0][0])).toContain(
      `/api/v1/context?appId=${config.appId}`,
    );
  });

  it('creates, lists, and revokes preview links', async () => {
    const api = new ApiClient(config);
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse({ preview: { id: 'preview-1' } }, 201));
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse({ previews: [], urlScheme: null }));
    mocks.fetchCli.mockResolvedValueOnce(jsonResponse({ status: 'revoked', previewId: 'p-1' }));

    await api.createPreview('f32627ca-9e8c-4358-90d8-bde732400081', {
      expiresIn: '24h',
      urlScheme: 'myapp',
    });
    await api.listPreviews('f32627ca-9e8c-4358-90d8-bde732400081');
    await api.revokePreview('p-1');

    const calls = mocks.fetchCli.mock.calls as Array<[string, RequestInit]>;
    const base = `https://console.example.test/api/v1/apps/${config.appId}`;
    expect(calls[0][0]).toBe(`${base}/bundles/f32627ca-9e8c-4358-90d8-bde732400081/previews`);
    expect(calls[0][1].method).toBe('POST');
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ expiresIn: '24h', urlScheme: 'myapp' });
    expect(calls[1][0]).toBe(`${base}/previews?bundleId=f32627ca-9e8c-4358-90d8-bde732400081`);
    expect(calls[2][0]).toBe(`${base}/previews/p-1`);
    expect(calls[2][1].method).toBe('DELETE');
  });
});
