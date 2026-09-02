import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  getOnboardingSnapshot: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock('@/lib/services/onboarding', () => ({
  getOnboardingSnapshot: mocks.getOnboardingSnapshot,
}));

import { GET } from './route';

// The route reads `nextUrl`, so this has to be a real NextRequest.
function request(url = 'https://console.example/api/v1/organization/onboarding') {
  return new NextRequest(url);
}

describe('onboarding route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionContext.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.test',
      organizationId: 'org-1',
      role: 'owner',
    });
    mocks.getOnboardingSnapshot.mockResolvedValue({ complete: false });
  });

  it('refuses an unauthenticated caller before reading any state', async () => {
    mocks.getSessionContext.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.getOnboardingSnapshot).not.toHaveBeenCalled();
  });

  it('scopes the snapshot to the session organization, never to a supplied one', async () => {
    await GET(
      request(
        'https://console.example/api/v1/organization/onboarding?appId=app-1&organizationId=org-2',
      ),
    );

    expect(mocks.getOnboardingSnapshot).toHaveBeenCalledWith({
      organizationId: 'org-1',
      appId: 'app-1',
    });
  });

  it('treats a blank appId as no app filter', async () => {
    await GET(request('https://console.example/api/v1/organization/onboarding?appId=%20%20'));

    expect(mocks.getOnboardingSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ appId: undefined }),
    );
  });
});
