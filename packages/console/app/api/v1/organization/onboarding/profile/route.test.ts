import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { OtaKitServiceError } from '@/lib/services/errors';

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  getOnboardingProfile: vi.fn(),
  updateOnboardingProfile: vi.fn(),
}));
vi.mock('@/lib/session', () => ({ getSessionContext: mocks.getSessionContext }));
vi.mock('@/lib/services/onboarding-profile', () => ({
  getOnboardingProfile: mocks.getOnboardingProfile,
  updateOnboardingProfile: mocks.updateOnboardingProfile,
}));
import { GET, POST } from './route';

const ctx = {
  userId: 'user-1',
  email: 'test@example.test',
  organizationId: 'org-1',
  role: 'owner',
};
function request(body: unknown, organizationId = 'org-1') {
  return new NextRequest('https://console.example/api/v1/organization/onboarding/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
    body: JSON.stringify(body),
  });
}

describe('onboarding profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionContext.mockResolvedValue(ctx);
    mocks.getOnboardingProfile.mockResolvedValue(null);
    mocks.updateOnboardingProfile.mockResolvedValue({ step: 'app' });
  });
  it('requires a valid session for reads and writes', async () => {
    mocks.getSessionContext.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(request({ action: 'skip' }))).status).toBe(401);
    expect(mocks.getOnboardingProfile).not.toHaveBeenCalled();
    expect(mocks.updateOnboardingProfile).not.toHaveBeenCalled();
  });
  it('reads only the active workspace and passes the resolved identity to writes', async () => {
    await GET();
    expect(mocks.getOnboardingProfile).toHaveBeenCalledWith('org-1');
    await POST(request({ action: 'save', step: 'app', answers: { technology: 'capacitor' } }));
    expect(mocks.updateOnboardingProfile).toHaveBeenCalledWith(ctx, {
      action: 'save',
      step: 'app',
      answers: { technology: 'capacitor' },
    });
  });
  it('rejects a stale workspace instead of connecting the app to a different organization', async () => {
    expect((await POST(request({ action: 'skip' }, 'org-2'))).status).toBe(409);
    expect(mocks.updateOnboardingProfile).not.toHaveBeenCalled();
  });
  it('rejects malformed answers and caller-supplied organization IDs', async () => {
    for (const body of [
      null,
      { action: 'save', step: 'connect', answers: { activeUsers: -1 } },
      { action: 'skip', organizationId: 'org-2' },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.updateOnboardingProfile).not.toHaveBeenCalled();
  });
  it('returns service authorization and validation failures without hiding their status', async () => {
    mocks.updateOnboardingProfile.mockRejectedValue(
      new OtaKitServiceError('INSUFFICIENT_ROLE', 'Owners and admins only.', 403),
    );
    const response = await POST(request({ action: 'skip' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'Owners and admins only.' });
  });
});
