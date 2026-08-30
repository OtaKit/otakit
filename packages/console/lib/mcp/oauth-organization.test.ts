import { describe, expect, it, vi } from 'vitest';

import { activeOAuthOrganizationId, shouldSelectOAuthOrganization } from './oauth-organization';

function database(activeOrganizationId: string | null, membershipIds: string[]) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        activeOrganizationId,
        memberships: membershipIds.map((organizationId) => ({ organizationId })),
      }),
    },
  };
}

describe('OAuth organization selection', () => {
  it('continues once the active organization is a current membership', async () => {
    const mockDatabase = database('org-1', ['org-1', 'org-2']);

    await expect(
      shouldSelectOAuthOrganization('user-1', ['otakit:read'], mockDatabase as never),
    ).resolves.toBe(false);
    await expect(activeOAuthOrganizationId('user-1', mockDatabase as never)).resolves.toBe('org-1');
  });

  it('requires selection when the active organization is missing or no longer authorized', async () => {
    await expect(
      shouldSelectOAuthOrganization('user-1', ['otakit:read'], database(null, ['org-1']) as never),
    ).resolves.toBe(true);
    await expect(
      shouldSelectOAuthOrganization(
        'user-1',
        ['otakit:read'],
        database('org-2', ['org-1']) as never,
      ),
    ).resolves.toBe(true);
  });

  it('does not involve organization selection for unrelated scopes', async () => {
    const mockDatabase = database(null, []);

    await expect(
      shouldSelectOAuthOrganization('user-1', ['openid'], mockDatabase as never),
    ).resolves.toBe(false);
    expect(mockDatabase.user.findUnique).not.toHaveBeenCalled();
  });
});
