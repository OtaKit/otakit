import { describe, expect, it, vi } from 'vitest';

import { selectedOAuthOrganizationId, shouldSelectOAuthOrganization } from './oauth-organization';
import { OTAKIT_OAUTH_ORGANIZATION_HEADER } from './oauth-organization-shared';

function database(membershipIds: string[]) {
  return {
    organizationMember: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const organizationId = where.organizationId_userId.organizationId;
        return Promise.resolve(membershipIds.includes(organizationId) ? { organizationId } : null);
      }),
    },
  };
}

function headers(organizationId?: string): Headers {
  return new Headers(
    organizationId ? { [OTAKIT_OAUTH_ORGANIZATION_HEADER]: organizationId } : undefined,
  );
}

describe('OAuth organization selection', () => {
  it('requires an explicit selection when the authorization request has none', async () => {
    const mockDatabase = database(['org-1', 'org-2']);

    await expect(
      shouldSelectOAuthOrganization('user-1', ['otakit:read'], headers(), mockDatabase as never),
    ).resolves.toBe(true);
    expect(mockDatabase.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('continues with the membership selected for this authorization request', async () => {
    const mockDatabase = database(['org-1', 'org-2']);
    const requestHeaders = headers('org-2');

    await expect(
      shouldSelectOAuthOrganization(
        'user-1',
        ['otakit:read'],
        requestHeaders,
        mockDatabase as never,
      ),
    ).resolves.toBe(false);
    await expect(
      selectedOAuthOrganizationId('user-1', requestHeaders, mockDatabase as never),
    ).resolves.toBe('org-2');
  });

  it('rejects a selected organization that is not a current membership', async () => {
    const mockDatabase = database(['org-1']);
    const requestHeaders = headers('org-2');

    await expect(
      shouldSelectOAuthOrganization(
        'user-1',
        ['otakit:read'],
        requestHeaders,
        mockDatabase as never,
      ),
    ).resolves.toBe(true);
    await expect(
      selectedOAuthOrganizationId('user-1', requestHeaders, mockDatabase as never),
    ).resolves.toBeUndefined();
  });

  it('does not involve organization selection for unrelated scopes', async () => {
    const mockDatabase = database([]);

    await expect(
      shouldSelectOAuthOrganization('user-1', ['openid'], headers(), mockDatabase as never),
    ).resolves.toBe(false);
    expect(mockDatabase.organizationMember.findUnique).not.toHaveBeenCalled();
  });
});
