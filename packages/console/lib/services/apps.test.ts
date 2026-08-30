import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  accessActor: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { app: { findMany: mocks.findMany, create: mocks.create } },
}));
vi.mock('@/lib/audit-log', () => ({
  accessActor: mocks.accessActor,
  recordAuditLog: mocks.recordAuditLog,
}));

import { createApp, listOrganizationApps } from './apps';

describe('app services', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.accessActor.mockResolvedValue({
      actorType: 'user',
      actorId: 'user-1',
      actorLabel: 'user@example.com',
    });
  });

  it('returns deterministic cursor pagination', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'app-3', slug: 'com.example.three', createdAt: new Date('2026-01-03') },
      { id: 'app-2', slug: 'com.example.two', createdAt: new Date('2026-01-02') },
    ]);

    const result = await listOrganizationApps({ organizationId: 'org-1', limit: 1 });

    expect(result).toEqual({
      apps: [
        {
          id: 'app-3',
          slug: 'com.example.three',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      ],
      nextCursor: 'app-3',
    });
  });

  it('creates an app under the resolved organization and audits it', async () => {
    mocks.create.mockResolvedValue({
      id: 'app-1',
      slug: 'com.example.app',
      createdAt: new Date('2026-01-01'),
    });

    const result = await createApp({
      access: {
        organizationId: 'org-1',
        actorType: 'user',
        actorId: 'user-1',
        role: 'member',
      },
      slug: ' com.example.app ',
      auditMetadata: { client: 'mcp' },
    });

    expect(result.slug).toBe('com.example.app');
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { organizationId: 'org-1', slug: 'com.example.app' } }),
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'app.created',
        metadata: { slug: 'com.example.app', client: 'mcp' },
      }),
    );
  });
});
