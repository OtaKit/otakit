import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUser: vi.fn(),
  findMembership: vi.fn(),
  findMemberships: vi.fn(),
  verifySecretAuth: vi.fn(),
  isAppOwnedByOrganization: vi.fn(),
}));

vi.mock('./auth', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock('./db', () => ({
  db: {
    user: { findUnique: mocks.findUser },
    organizationMember: {
      findUnique: mocks.findMembership,
      findMany: mocks.findMemberships,
    },
  },
}));

vi.mock('./api-auth', () => ({
  verifySecretAuth: mocks.verifySecretAuth,
  isAppOwnedByOrganization: mocks.isAppOwnedByOrganization,
}));

import { ORGANIZATION_ID_HEADER, resolveOrganizationAccess } from './organization-access';

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://console.otakit.app/api/v1/apps', { headers });
}

describe('resolveOrganizationAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verifySecretAuth.mockResolvedValue({ success: false, error: 'Invalid secret key' });
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.findUser.mockResolvedValue({ activeOrganizationId: 'org-active' });
    mocks.findMembership.mockResolvedValue({ role: 'member' });
    mocks.findMemberships.mockResolvedValue([{ organizationId: 'org-active' }]);
    mocks.isAppOwnedByOrganization.mockResolvedValue(true);
  });

  it('binds a user request to an explicitly selected organization', async () => {
    const result = await resolveOrganizationAccess(
      request({ [ORGANIZATION_ID_HEADER]: 'org-selected' }),
      'app-1',
    );

    expect(result).toEqual({
      success: true,
      access: {
        organizationId: 'org-selected',
        actorType: 'user',
        actorId: 'user-1',
        role: 'member',
      },
    });
    expect(mocks.findMembership).toHaveBeenCalledWith({
      where: {
        organizationId_userId: { organizationId: 'org-selected', userId: 'user-1' },
      },
      select: { role: true },
    });
    expect(mocks.isAppOwnedByOrganization).toHaveBeenCalledWith('app-1', 'org-selected');
  });

  it('does not fall back to the active organization when explicit membership is absent', async () => {
    mocks.findMembership.mockResolvedValue(null);

    const result = await resolveOrganizationAccess(
      request({ [ORGANIZATION_ID_HEADER]: 'org-other' }),
    );

    expect(result).toEqual({ success: false, error: 'Organization not found', status: 404 });
  });

  it('rejects an invalid explicit organization header instead of falling back', async () => {
    const result = await resolveOrganizationAccess(
      request({ [ORGANIZATION_ID_HEADER]: ' '.repeat(4) }),
    );

    expect(result).toEqual({
      success: false,
      error: 'Invalid organization ID header',
      status: 400,
    });
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it('keeps an organization key fixed to its owning organization', async () => {
    mocks.verifySecretAuth.mockResolvedValue({
      success: true,
      organizationId: 'org-key',
      keyId: 'key-1',
    });

    const result = await resolveOrganizationAccess(
      request({
        authorization: 'Bearer otakit_sk_test',
        [ORGANIZATION_ID_HEADER]: 'org-other',
      }),
    );

    expect(result).toEqual({ success: false, error: 'Organization not found', status: 404 });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it('requires an explicit organization for a user with multiple memberships', async () => {
    mocks.findMemberships.mockResolvedValue([
      { organizationId: 'org-1' },
      { organizationId: 'org-2' },
    ]);

    const result = await resolveOrganizationAccess(request(), undefined, {
      requireExplicitOrganizationForMultipleMemberships: true,
    });

    expect(result).toMatchObject({
      success: false,
      status: 409,
      code: 'ORGANIZATION_SELECTION_REQUIRED',
      error: expect.stringContaining('org-2'),
    });
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.findMembership).not.toHaveBeenCalled();
  });

  it('selects the sole membership without consulting mutable dashboard state', async () => {
    mocks.findMemberships.mockResolvedValue([{ organizationId: 'org-only' }]);

    const result = await resolveOrganizationAccess(request(), undefined, {
      requireExplicitOrganizationForMultipleMemberships: true,
    });

    expect(result).toEqual({
      success: true,
      access: {
        organizationId: 'org-only',
        actorType: 'user',
        actorId: 'user-1',
        role: 'member',
      },
    });
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.findMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: { organizationId: 'org-only', userId: 'user-1' },
        },
      }),
    );
  });

  it('does not enumerate memberships for an organization key', async () => {
    mocks.verifySecretAuth.mockResolvedValue({
      success: true,
      organizationId: 'org-key',
      keyId: 'key-1',
    });

    await expect(
      resolveOrganizationAccess(request({ authorization: 'Bearer otakit_sk_test' }), undefined, {
        requireExplicitOrganizationForMultipleMemberships: true,
      }),
    ).resolves.toMatchObject({ success: true, access: { organizationId: 'org-key' } });
    expect(mocks.findMemberships).not.toHaveBeenCalled();
  });
});
