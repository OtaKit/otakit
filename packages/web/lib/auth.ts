import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { bearer, emailOTP } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';

import { db } from './db';
import { sendOtpEmail } from './email';

const isDev = process.env.NODE_ENV === 'development';
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const appleEnabled = Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET);
const githubEnabled = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
const trustedSocialProviders = [
  ...(googleEnabled ? ['google'] : []),
  ...(appleEnabled ? ['apple'] : []),
  ...(githubEnabled ? ['github'] : []),
];
const trustedOrigins = Array.from(
  new Set(
    [
      process.env.BETTER_AUTH_URL,
      process.env.NEXT_PUBLIC_APP_URL,
      appleEnabled ? 'https://appleid.apple.com' : null,
    ].filter((value): value is string => Boolean(value)),
  ),
);
const socialProviders = {
  ...(googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: 'select_account' as const,
        },
      }
    : {}),
  ...(appleEnabled
    ? {
        apple: {
          clientId: process.env.APPLE_CLIENT_ID!,
          clientSecret: process.env.APPLE_CLIENT_SECRET!,
        },
      }
    : {}),
  ...(githubEnabled
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID!,
          clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        },
      }
    : {}),
};

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  socialProviders,
  plugins: [
    bearer(),
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        if (isDev) {
          try {
            const { default: clipboardy } = await import('clipboardy');
            await clipboardy.write(otp);
            console.log(`[OTP] ${type} for ${email}: ${otp} (copied to clipboard)`);
          } catch (error) {
            console.warn('[OTP] Failed to copy OTP to clipboard in development', error);
          }
        }
        await sendOtpEmail(email, otp);
      },
      otpLength: 6,
      expiresIn: 300,
      disableSignUp: false,
    }),
    nextCookies(),
  ],
  trustedOrigins,
  account: {
    encryptOAuthTokens: true,
    updateAccountOnSignIn: true,
    accountLinking: {
      enabled: true,
      trustedProviders: trustedSocialProviders,
      allowDifferentEmails: false,
    },
  },
  emailAndPassword: { enabled: false },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh after 1 day
  },
  user: {
    additionalFields: {
      activeOrganizationId: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Provisioning: apply pending invites, or create personal organization.
          // This runs after better-auth inserts the user row.
          await provisionUser(user.id, user.email);
        },
      },
    },
  },
});

/**
 * Post-signup provisioning: apply pending invites or create a personal organization.
 * Also called on sign-in to pick up new invites (see after-auth hook).
 */
export async function provisionUser(userId: string, email: string) {
  await db.$transaction(async (tx) => {
    // 1. Apply pending invites for this email
    const pendingInvites = await tx.organizationInvite.findMany({
      where: { email: email.toLowerCase(), acceptedAt: null, revokedAt: null },
    });

    for (const invite of pendingInvites) {
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
        create: { organizationId: invite.organizationId, userId, role: invite.role },
        update: {},
      });
      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    }

    // 2. Check if user has any memberships
    const memberships = await tx.organizationMember.findMany({
      where: { userId },
      select: { organizationId: true },
    });

    // 3. If no memberships, create personal organization
    if (memberships.length === 0) {
      const organization = await tx.organization.create({
        data: { name: 'Personal account' },
      });
      await tx.organizationMember.create({
        data: { organizationId: organization.id, userId, role: 'owner' },
      });
      memberships.push({ organizationId: organization.id });
    }

    // 4. Ensure activeOrganizationId is set
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { activeOrganizationId: true },
    });

    const validDefault =
      user.activeOrganizationId &&
      memberships.some(
        (m: { organizationId: string }) => m.organizationId === user.activeOrganizationId,
      );

    if (!validDefault) {
      await tx.user.update({
        where: { id: userId },
        data: { activeOrganizationId: memberships[0].organizationId },
      });
    }
  });
}
