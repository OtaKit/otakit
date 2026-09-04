import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryTinybirdPipe } from './client';

describe('Tinybird client', () => {
  beforeEach(() => {
    vi.stubEnv('TINYBIRD_READ_TOKEN', 'test-read-token');
    vi.stubEnv('TINYBIRD_API_HOST', 'https://api.tinybird.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('serializes boolean template parameters as Tinybird UInt8 values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await queryTinybirdPipe('app_events_recent', {
      app_id: 'app-1',
      channel_is_null: false,
      runtime_version_is_null: true,
      limit: 100,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get('channel_is_null')).toBe('0');
    expect(requestUrl.searchParams.get('runtime_version_is_null')).toBe('1');
    expect(requestUrl.searchParams.get('limit')).toBe('100');
    expect(requestUrl.searchParams.get('app_id')).toBe('app-1');
  });
});
