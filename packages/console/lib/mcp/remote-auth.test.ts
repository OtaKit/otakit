import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  organizationKeyConnection,
  RemoteMcpAuthError,
  resolveOAuthConnection,
  scopesFromClaims,
} from './remote-auth';

function database(options?: {
  membership?: { role: 'owner' | 'admin' | 'member' } | null;
  consent?: {
    scopes: string[];
    resources: string[];
    client: { name: string | null; disabled: boolean | null };
  } | null;
}) {
  return {
    organizationMember: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options && 'membership' in options ? options.membership : { role: 'admin' },
        ),
    },
    oauthConsent: {
      findFirst: vi.fn().mockResolvedValue(
        options && 'consent' in options
          ? options.consent
          : {
              scopes: ['otakit:read', 'otakit:release:write'],
              resources: ['https://console.example/mcp'],
              client: { name: 'Example Agent', disabled: false },
            },
      ),
    },
  };
}

const claims = {
  sub: 'user-1',
  client_id: 'client-1',
  scope: 'otakit:read otakit:release:write',
  otakit_user_id: 'user-1',
  otakit_organization_id: 'org-1',
};

describe('remote MCP authentication context', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('binds OAuth access to the consented organization, current member role, and client', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'https://console.example/mcp');
    const mockDatabase = database();

    const connection = await resolveOAuthConnection(claims, mockDatabase as never);

    expect(connection).toMatchObject({
      access: {
        organizationId: 'org-1',
        actorType: 'user',
        actorId: 'user-1',
        role: 'admin',
      },
      credentialType: 'oauth',
      clientId: 'client-1',
      clientName: 'Example Agent',
    });
    expect(connection.scopes).toEqual(new Set(['otakit:read', 'otakit:release:write']));
    expect(mockDatabase.oauthConsent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-1', userId: 'user-1', referenceId: 'org-1' },
      }),
    );
  });

  it('rejects a token after consent is revoked', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'https://console.example/mcp');
    await expect(
      resolveOAuthConnection(claims, database({ consent: null }) as never),
    ).rejects.toMatchObject({ code: 'CONSENT_REVOKED' } satisfies Partial<RemoteMcpAuthError>);
  });

  it('rejects a token after organization membership is removed', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'https://console.example/mcp');
    await expect(
      resolveOAuthConnection(claims, database({ membership: null }) as never),
    ).rejects.toMatchObject({ code: 'MEMBERSHIP_REVOKED' } satisfies Partial<RemoteMcpAuthError>);
  });

  it('rejects scopes or resources no longer present in consent', async () => {
    vi.stubEnv('OTAKIT_REMOTE_MCP_RESOURCE_URL', 'https://console.example/mcp');
    await expect(
      resolveOAuthConnection(
        claims,
        database({
          consent: {
            scopes: ['otakit:read'],
            resources: ['https://console.example/mcp'],
            client: { name: null, disabled: false },
          },
        }) as never,
      ),
    ).rejects.toMatchObject({ code: 'CONSENT_REVOKED' } satisfies Partial<RemoteMcpAuthError>);

    await expect(
      resolveOAuthConnection(
        { ...claims, scope: 'otakit:read' },
        database({
          consent: {
            scopes: ['otakit:read'],
            resources: ['https://wrong.example/mcp'],
            client: { name: null, disabled: false },
          },
        }) as never,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' } satisfies Partial<RemoteMcpAuthError>);
  });

  it('normalizes OAuth scopes and preserves existing organization-key authority', () => {
    expect(scopesFromClaims({ scope: ['otakit:read', 'otakit:app:write'] })).toEqual(
      new Set(['otakit:read', 'otakit:app:write']),
    );
    expect(organizationKeyConnection({ organizationId: 'org-1', keyId: 'key-1' })).toMatchObject({
      access: { organizationId: 'org-1', actorType: 'key', actorId: 'key-1' },
      credentialType: 'organization_key',
      clientId: null,
    });
  });
});
