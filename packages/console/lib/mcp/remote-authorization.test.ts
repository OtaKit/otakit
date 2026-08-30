import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRemoteToolAuthorization } from './remote-adapter';
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

  it('exposes only tools covered by delegated scopes and current member role', () => {
    vi.stubEnv('OTAKIT_RELEASE_RELIABILITY_ENABLED', 'true');
    const connection: RemoteMcpConnection = {
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
    const authorization = createRemoteToolAuthorization(connection);

    expect(authorization.canRegister?.('list_apps')).toBe(true);
    expect(authorization.canRegister?.('get_account_status')).toBe(true);
    expect(authorization.canRegister?.('create_app')).toBe(false);
    expect(authorization.canRegister?.('publish_release')).toBe(false);
    expect(authorization.canRegister?.('list_audit_log')).toBe(false);
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
