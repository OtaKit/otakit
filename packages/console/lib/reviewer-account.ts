import { randomBytes } from 'node:crypto';

import { auth } from './auth';

/**
 * Create an app-directory reviewer account with a generated password, through
 * Better Auth so its password hashing and user hooks (personal organization)
 * apply. Returns the password once; an existing account is left unchanged.
 */
export async function createReviewerAccount(
  rawEmail: string,
): Promise<{ email: string; userId: string; password: string | null }> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`Not an email address: ${rawEmail}`);
  }
  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(email, {
    includeAccounts: false,
  });
  if (existing) return { email, userId: existing.user.id, password: null };

  const password = randomBytes(18).toString('base64url');
  // An operator creates this account, as Better Auth's admin plugin does.
  const user = await context.internalAdapter.createUser(
    { email, name: 'App directory reviewer', emailVerified: true },
    { method: 'admin' },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await context.password.hash(password),
  });
  return { email, userId: user.id, password };
}
