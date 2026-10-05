import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The consent hook reads next/headers, which needs a Next.js request scope.
vi.mock('next/headers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/headers')>()),
  headers: async () => new Headers(),
}));

// lib/auth reads these flags when it is imported.
vi.hoisted(() => {
  process.env.OTAKIT_REVIEWER_LOGIN = 'true';
  process.env.OTAKIT_REMOTE_MCP_ENABLED = 'true';
  process.env.OTAKIT_REMOTE_MCP_OAUTH_ENABLED = 'true';
  process.env.OTAKIT_REMOTE_MCP_LEGACY_DCR_ENABLED = 'true';
});

import { GET as authGET, POST as authPOST } from '@/app/api/auth/[...all]/route';
import { db } from '@/lib/db';

import { createReviewerAccount } from './reviewer-account';

const ORIGIN = 'https://console.example';
const REDIRECT = 'http://127.0.0.1:33418/callback';
const databaseDescribe = process.env.RUN_DATABASE_TESTS === '1' ? describe : describe.skip;

const postJson = (path: string, body: unknown) =>
  authPOST(
    new NextRequest(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

databaseDescribe('app-directory reviewer login (PostgreSQL integration)', () => {
  const emails: string[] = [];
  const clientIds: string[] = [];

  afterAll(async () => {
    const users = await db.user.findMany({
      where: { email: { in: emails } },
      select: { memberships: { select: { organizationId: true } } },
    });
    await db.oauthClient.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.organization.deleteMany({
      where: { id: { in: users.flatMap((user) => user.memberships.map((m) => m.organizationId)) } },
    });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  it('creates a provisioned account once, and signs it in with its password only', async () => {
    const email = `Reviewer-${randomUUID()}@Example.com`;
    emails.push(email.toLowerCase());

    const created = await createReviewerAccount(email);
    expect(created.email).toBe(email.toLowerCase());
    expect(created.password).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const user = await db.user.findUniqueOrThrow({
      where: { email: created.email },
      select: { emailVerified: true, memberships: { select: { role: true } } },
    });
    expect(user).toMatchObject({ emailVerified: true, memberships: [{ role: 'owner' }] });

    const again = await createReviewerAccount(email);
    expect(again).toEqual({ email: created.email, userId: created.userId, password: null });

    const signIn = await postJson('/api/auth/sign-in/email', {
      email: created.email,
      password: created.password,
    });
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get('set-auth-token')).toBeTruthy();

    const wrong = await postJson('/api/auth/sign-in/email', {
      email: created.email,
      password: 'not-the-password',
    });
    expect(wrong.status).toBe(401);

    const signUpEmail = `someone-${randomUUID()}@example.com`;
    emails.push(signUpEmail);
    const signUp = await postJson('/api/auth/sign-up/email', {
      email: signUpEmail,
      password: 'a-long-enough-password',
      name: 'Someone',
    });
    expect(signUp.status).toBeGreaterThanOrEqual(400);
    expect(await db.user.count({ where: { email: signUpEmail } })).toBe(0);
  });

  it('continues an MCP authorization after a reviewer signs in', async () => {
    const email = `reviewer-${randomUUID()}@example.com`;
    emails.push(email);
    const { password } = await createReviewerAccount(email);

    const registration = await postJson('/api/auth/oauth2/register', {
      client_name: 'Reviewer agent',
      redirect_uris: [REDIRECT],
    });
    const clientId = String(((await registration.json()) as { client_id: string }).client_id);
    clientIds.push(clientId);
    const verifier = randomBytes(32).toString('base64url');
    const authorize = await authGET(
      new NextRequest(
        `${ORIGIN}/api/auth/oauth2/authorize?${new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT,
          scope: 'otakit:read',
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        })}`,
        { headers: { accept: 'application/json' } },
      ),
    );
    const login = new URL(((await authorize.json()) as { url: string }).url, ORIGIN);
    expect(login.pathname).toBe('/login');

    // What the reviewer form sends from that page: the auth client adds the
    // signed request as oauth_query.
    const signIn = await postJson('/api/auth/sign-in/email', {
      email,
      password,
      oauth_query: login.search.slice(1),
    });
    expect(signIn.status).toBe(200);
    const next = new URL(((await signIn.json()) as { url: string }).url, ORIGIN);
    expect(next.pathname).toBe('/oauth/consent');
  });
});
