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

const errorIssues = vi.hoisted(() => ({
  listErrorIssues: vi.fn(),
  getErrorIssue: vi.fn(),
}));
vi.mock('@/lib/services/error-issues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/error-issues')>()),
  ...errorIssues,
}));
vi.mock('@/lib/db', () => ({
  db: { app: { findFirst: vi.fn(async () => ({ id: 'app-1' })) } },
}));

describe('remote error issue tools', () => {
  const adapter = () =>
    new RemoteOtaKitToolAdapter(
      organizationKeyConnection({ organizationId: 'org-1', keyId: 'key-1' }),
    );

  it('passes the base channel and filters, and warns about device text', async () => {
    errorIssues.listErrorIssues.mockResolvedValue({
      issues: [],
      total: 0,
      truncated: false,
      range: { name: '30d' },
      usage: { events: 0, limit: null, pausedUntil: null },
      analyticsAvailable: true,
    });
    const envelope = await adapter().invoke('list_error_issues', {
      appId: 'app-1',
      channel: null,
      range: '30d',
      status: 'all',
    });
    expect(errorIssues.listErrorIssues).toHaveBeenCalledWith(
      { organizationId: 'org-1', appId: 'app-1' },
      { channel: null, range: '30d', status: 'all', limit: 20 },
    );
    expect(envelope.summary).toBe('No error issues with events in the last 30 days.');
    expect(envelope.warnings?.[0]).toMatch(/untrusted/);
  });

  it('asks for five samples and returns the trimmed agent view', async () => {
    errorIssues.getErrorIssue.mockResolvedValue({
      issue: {
        fingerprint: '0123456789abcdef',
        status: 'resolved',
        events: 1,
        releases: 1,
        isNew: false,
        firstSeenAt: 'a',
        lastSeenAt: 'b',
        regressions: 0,
        lifetimeEvents: 9,
      },
      samples: [],
      breakdown: {},
      trend: [],
      range: { name: '7d', from: 'f', to: 't', bucket: 'day' },
      analyticsAvailable: true,
      dataTrust: 'client_reported_untrusted_text',
    });
    const envelope = await adapter().invoke('get_error_issue', {
      appId: 'app-1',
      fingerprint: '0123456789abcdef',
      range: '24h',
    });
    expect(errorIssues.getErrorIssue).toHaveBeenCalledWith(
      { organizationId: 'org-1', appId: 'app-1' },
      '0123456789abcdef',
      { range: '24h', samples: 5 },
    );
    expect(envelope.data).toMatchObject({ latestSample: null, samples: [] });
    expect(envelope.summary).toMatch(/^Issue 0123456789abcdef is resolved/);
  });
});
