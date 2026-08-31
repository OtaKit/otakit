import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveOrganizationAccess: vi.fn(),
  getConnectionContext: vi.fn(),
  serviceErrorResponse: vi.fn(),
}));

vi.mock('@/lib/organization-access', () => ({
  resolveOrganizationAccess: mocks.resolveOrganizationAccess,
}));
vi.mock('@/lib/services/context', () => ({
  getConnectionContext: mocks.getConnectionContext,
}));
vi.mock('@/lib/services/http', () => ({
  serviceErrorResponse: mocks.serviceErrorResponse,
}));

import { GET } from './route';

describe('local MCP context route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveOrganizationAccess.mockResolvedValue({
      success: true,
      access: {
        organizationId: 'org-project',
        actorType: 'user',
        actorId: 'user-1',
        role: 'member',
      },
    });
    mocks.getConnectionContext.mockResolvedValue({ organization: { id: 'org-project' } });
  });

  it('uses the configured app to infer and validate the startup organization', async () => {
    const request = new NextRequest('https://console.otakit.app/api/v1/context?appId=app-project');

    await expect(GET(request)).resolves.toMatchObject({ status: 200 });
    expect(mocks.resolveOrganizationAccess).toHaveBeenCalledWith(request, 'app-project', {
      inferOrganizationFromAppId: true,
      requireExplicitOrganizationForMultipleMemberships: true,
    });
  });

  it('preserves app-less startup for unconfigured projects', async () => {
    const request = new NextRequest('https://console.otakit.app/api/v1/context');

    await GET(request);

    expect(mocks.resolveOrganizationAccess).toHaveBeenCalledWith(request, undefined, {
      inferOrganizationFromAppId: true,
      requireExplicitOrganizationForMultipleMemberships: true,
    });
  });

  it('rejects ambiguous app identifiers', async () => {
    const request = new NextRequest(
      'https://console.otakit.app/api/v1/context?appId=app-1&appId=app-2',
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid app ID' });
    expect(mocks.resolveOrganizationAccess).not.toHaveBeenCalled();
  });
});
