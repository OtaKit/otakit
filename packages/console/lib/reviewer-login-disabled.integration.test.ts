import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  delete process.env.OTAKIT_REVIEWER_LOGIN;
});

import { POST as authPOST } from '@/app/api/auth/[...all]/route';
import { db } from '@/lib/db';

import { createReviewerAccount } from './reviewer-account';

const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

databaseDescribe('reviewer login switched off (PostgreSQL integration)', () => {
  const email = `reviewer-${randomUUID()}@example.com`;

  afterAll(async () => {
    const user = await db.user.findUnique({
      where: { email },
      select: { memberships: { select: { organizationId: true } } },
    });
    await db.organization.deleteMany({
      where: { id: { in: user?.memberships.map((m) => m.organizationId) ?? [] } },
    });
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it('refuses password sign-in even for an account that has a password', async () => {
    const { password } = await createReviewerAccount(email);
    const signIn = await authPOST(
      new NextRequest('https://console.example/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin: 'https://console.example', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }),
    );
    expect(signIn.status).toBeGreaterThanOrEqual(400);
    expect(signIn.headers.get('set-auth-token')).toBeNull();
  });
});
