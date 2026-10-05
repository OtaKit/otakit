import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRemoteToolAuthorization, missingToolScopes } from './remote-adapter';
import { organizationKeyConnection, type RemoteMcpConnection } from './remote-auth';

describe('remote MCP tool registration policy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps organization-key operational parity without claiming billing or audit authority', () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'true');
    const authorization = createRemoteToolAuthorization(
      organizationKeyConnection({ organizationId: 'org-1', keyId: 'key-1' }),
    );

    expect(authorization.canRegister?.('list_apps')).toBe(true);
    expect(authorization.canRegister?.('create_app')).toBe(true);
    expect(authorization.canRegister?.('delete_bundle')).toBe(true);
    expect(authorization.canRegister?.('publish_release')).toBe(true);
    expect(authorization.canRegister?.('get_account_status')).toBe(false);
    expect(authorization.canRegister?.('list_audit_log')).toBe(false);
  });

  const readOnlyMember: RemoteMcpConnection = {
    access: {
      organizationId: 'org-1',
      actorType: 'user',
      actorId: 'user-1',
      role: 'member',
    },
    scopes: new Set(['otakit:read']),
    credentialType: 'oauth',
    clientId: 'client-1',
    clientName: 'Agent',
  };

  it('lists every tool the member role allows, whatever the delegated scopes', () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'true');
    const authorization = createRemoteToolAuthorization(readOnlyMember);

    expect(authorization.canRegister?.('list_apps')).toBe(true);
    expect(authorization.canRegister?.('get_account_status')).toBe(true);
    // Listed for step-up: calling them returns a 403 insufficient_scope challenge.
    expect(authorization.canRegister?.('create_app')).toBe(true);
    expect(authorization.canRegister?.('publish_release')).toBe(true);
    expect(authorization.canRegister?.('list_audit_log')).toBe(false);
  });

  it('still refuses a tool call the delegated scopes do not cover', async () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'true');
    const authorization = createRemoteToolAuthorization(readOnlyMember);

    // The remote adapter never reads the server context.
    const context = {} as Parameters<NonNullable<typeof authorization.authorize>>[1];
    await expect(authorization.authorize?.('list_apps', context)).resolves.toBeUndefined();
    await expect(authorization.authorize?.('create_app', context)).rejects.toMatchObject({
      code: 'INSUFFICIENT_SCOPE',
    });
  });

  it('names the scopes a step-up needs, skipping tools no scope would unlock', () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'true');

    expect(missingToolScopes(readOnlyMember, ['list_apps'])).toEqual([]);
    expect(missingToolScopes(readOnlyMember, ['create_app', 'list_apps'])).toEqual([
      'otakit:app:write',
    ]);
    expect(missingToolScopes(readOnlyMember, ['list_audit_log'])).toEqual([]);
    expect(
      missingToolScopes(organizationKeyConnection({ organizationId: 'org-1', keyId: 'key-1' }), [
        'create_app',
        'publish_release',
      ]),
    ).toEqual([]);
  });

  it('does not advertise agent release writes before the additive reliability rollout is enabled', () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'false');
    const authorization = createRemoteToolAuthorization(
      organizationKeyConnection({ organizationId: 'org-1', keyId: 'key-1' }),
    );

    expect(authorization.canRegister?.('prepare_release')).toBe(true);
    expect(authorization.canRegister?.('publish_release')).toBe(false);
    expect(authorization.canRegister?.('prepare_revert')).toBe(true);
    expect(authorization.canRegister?.('revert_release')).toBe(false);
  });
});
