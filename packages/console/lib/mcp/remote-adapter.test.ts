import { afterEach, describe, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ getAccountStatus: vi.fn() }));
vi.mock('@/lib/services/account', () => account);

import { RemoteOtaKitToolAdapter } from './remote-adapter';
import { organizationKeyConnection } from './remote-auth';

describe('remote get_account_status', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('links to public pricing, never to the upgrade dialog', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://site.example/');
    account.getAccountStatus.mockResolvedValue({
      organization: { id: 'org-1', name: 'Acme' },
      plan: { key: 'free', active: true },
      usage: { downloadsCount: 10 },
      links: {
        billing: 'https://console.example/dashboard/settings?pricing=1',
        usage: 'https://console.example/dashboard/settings',
      },
    });
    const adapter = new RemoteOtaKitToolAdapter(
      organizationKeyConnection({ organizationId: 'org-1', keyId: 'key-1' }),
    );

    const envelope = await adapter.invoke('get_account_status', {});

    expect(JSON.stringify(envelope)).not.toContain('pricing=1');
    expect(envelope.links).toEqual([
      { label: 'Plans and pricing', url: 'https://site.example/#pricing' },
      { label: 'Usage', url: 'https://console.example/dashboard/settings' },
    ]);
    expect(envelope.data).toMatchObject({
      plan: { key: 'free' },
      links: {
        pricing: 'https://site.example/#pricing',
        usage: 'https://console.example/dashboard/settings',
      },
    });
  });
});
