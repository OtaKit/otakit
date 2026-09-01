import { afterAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db';

import { OTAKIT_OAUTH_SCOPES } from './features';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

describe('Better Auth OAuth Prisma schema', () => {
  it('exposes every delegate under the model name used by Better Auth', () => {
    expect(db).toMatchObject({
      oauthClient: expect.any(Object),
      oauthResource: expect.any(Object),
      oauthClientResource: expect.any(Object),
      oauthRefreshToken: expect.any(Object),
      oauthAccessToken: expect.any(Object),
      oauthConsent: expect.any(Object),
      oauthClientAssertion: expect.any(Object),
    });
  });
});

databaseDescribe('Better Auth OAuth initialization', () => {
  const resourceUrl = 'https://console.example/mcp';

  afterAll(async () => {
    await db.oauthResource.deleteMany({ where: { identifier: resourceUrl } });
    await db.$disconnect();
  });

  it('seeds the MCP resource with every OtaKit scope', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_ENABLED', 'true');
    vi.stubEnv('OTAKIT_REMOTE_MCP_OAUTH_ENABLED', 'true');
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', resourceUrl);
    const { auth } = await import('@/lib/auth');

    await auth.handler(
      new Request('https://console.example/.well-known/oauth-protected-resource/mcp'),
    );

    await expect(
      db.oauthResource.findUnique({
        where: { identifier: resourceUrl },
        select: { allowedScopes: true },
      }),
    ).resolves.toEqual({ allowedScopes: [...OTAKIT_OAUTH_SCOPES] });
  });
});
