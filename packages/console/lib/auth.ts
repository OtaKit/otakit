import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { bearer, emailOTP, jwt } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { cimd } from '@better-auth/cimd';
import { mcp } from '@better-auth/mcp';
import { headers } from 'next/headers';

import { db } from './db';
import { sendOtpEmail } from './email';
import { recordAuditLog } from './audit-log';
import { isReviewerLoginEnabled } from './reviewer-login';
import { fetchCimdMetadataResource } from './mcp/cimd-fetch';
import { withMcpRegistrationDefaults } from './mcp/client-registration';
import { normalizeRequestedScope, normalizeResourceIndicator } from './mcp/oauth-request';
import {
  selectedOAuthOrganizationId,
  shouldSelectOAuthOrganization,
} from './mcp/oauth-organization';
import {
  OTAKIT_OAUTH_SCOPES,
  isOtaKitOAuthScope,
  isLegacyMcpDcrEnabled,
  isRemoteMcpOAuthEnabled,
  remoteMcpResourceUrl,
} from './mcp/features';

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
      // Vercel PR deployments use per-deployment hosts. Keep the wildcard
      // scoped to this project instead of trusting every vercel.app tenant.
      'https://otakit-console-*.vercel.app',
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

const remoteMcpOAuthPlugins = isRemoteMcpOAuthEnabled()
  ? [
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: '/login',
        consentPage: '/oauth/consent',
        resource: remoteMcpResourceUrl(),
        // Config is the only source of truth for this resource, so apply its
        // fields to the stored row on startup. The default, insertOnly, never
        // updates an existing row and would leave a deployed policy stale.
        resourceSeedMode: 'merge',
        resources: [
          {
            identifier: remoteMcpResourceUrl(),
            // offline_access must be allowed here too: Better Auth stores refresh
            // tokens with the scopes this list permits, and a stored refresh token
            // without offline_access is never rotated on use.
            allowedScopes: [...OTAKIT_OAUTH_SCOPES, 'offline_access'],
          },
        ],
        scopes: [...OTAKIT_OAUTH_SCOPES, 'offline_access'],
        clientRegistrationDefaultScopes: ['otakit:read'],
        clientRegistrationAllowedScopes: [
          'otakit:app:write',
          'otakit:bundle:write',
          'otakit:release:write',
          'offline_access',
        ],
        grantTypes: ['authorization_code', 'refresh_token'],
        allowDynamicClientRegistration: isLegacyMcpDcrEnabled(),
        allowUnauthenticatedClientRegistration: isLegacyMcpDcrEnabled(),
        postLogin: {
          page: '/oauth/select-organization',
          shouldRedirect: async ({ headers: requestHeaders, user, scopes }) =>
            shouldSelectOAuthOrganization(user.id, scopes, requestHeaders),
          consentReferenceId: async ({ user, scopes }) => {
            if (!scopes.some(isOtaKitOAuthScope)) {
              return undefined;
            }
            const organizationId = await selectedOAuthOrganizationId(user.id, await headers());
            if (!organizationId) {
              throw new APIError('BAD_REQUEST', {
                message: 'Select an organization before authorizing OtaKit MCP',
              });
            }
            return organizationId;
          },
        },
        customAccessTokenClaims: async ({ user, referenceId }) => {
          if (!user?.id || !referenceId) {
            throw new APIError('UNAUTHORIZED', {
              message: 'OtaKit MCP access must be bound to a user and organization',
            });
          }
          const membership = await db.organizationMember.findUnique({
            where: {
              organizationId_userId: { organizationId: referenceId, userId: user.id },
            },
            select: { id: true },
          });
          if (!membership) {
            throw new APIError('FORBIDDEN', {
              message: 'The user is no longer a member of this organization',
            });
          }
          return {
            otakit_organization_id: referenceId,
            otakit_user_id: user.id,
          };
        },
      }),
      cimd({
        fetchClientMetadataResource: fetchCimdMetadataResource,
        metadataProfile: 'mcp-2026-07-28',
      }),
    ]
  : [];

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  ...(isRemoteMcpOAuthEnabled() ? { disabledPaths: ['/token'] } : {}),
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
    ...remoteMcpOAuthPlugins,
    nextCookies(),
  ],
  trustedOrigins,
  hooks: {
    // MCP clients vary in how closely they follow RFC 7591/8707 and which
    // scopes they ask for. Normalize the requests before Better Auth validates
    // them; each rule is documented next to its function in lib/mcp.
    before: createAuthMiddleware(async (ctx) => {
      if (!isRemoteMcpOAuthEnabled()) return;
      if (ctx.path === '/oauth2/register') {
        const body = withMcpRegistrationDefaults(ctx.body);
        if (body !== ctx.body) return { context: { body } };
        return;
      }
      if (ctx.path === '/oauth2/authorize' && ctx.query) {
        const clientId = typeof ctx.query.client_id === 'string' ? ctx.query.client_id : undefined;
        const client = clientId
          ? await db.oauthClient.findUnique({
              where: { clientId },
              select: { grantTypes: true },
            })
          : null;
        const query: Record<string, unknown> = { ...ctx.query };
        const scope = normalizeRequestedScope(query.scope, {
          addOfflineAccess: client?.grantTypes.includes('refresh_token') ?? false,
        });
        if (scope !== undefined) query.scope = scope;
        // /mcp is the only protected resource. A client that omits the RFC 8707
        // indicator would otherwise get a consent bound to no resource, which
        // the MCP endpoint refuses on every call.
        query.resource =
          query.resource === undefined
            ? remoteMcpResourceUrl()
            : normalizeResourceIndicator(query.resource, remoteMcpResourceUrl());
        return { context: { query } };
      }
      if (ctx.path === '/oauth2/token' && ctx.body && typeof ctx.body === 'object') {
        const body = ctx.body as Record<string, unknown>;
        if (body.resource === undefined) return;
        return {
          context: {
            body: {
              ...body,
              resource: normalizeResourceIndicator(body.resource, remoteMcpResourceUrl()),
            },
          },
        };
      }
    }),
    // Granting an agent access is recorded next to its revocation.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/oauth2/consent' || !isRemoteMcpOAuthEnabled()) return;
      const body = (ctx.body ?? {}) as { accept?: unknown; oauth_query?: unknown };
      if (body.accept !== true) return;
      const returned = ctx.context.returned as { url?: unknown } | undefined;
      if (typeof returned?.url !== 'string' || !URL.canParse(returned.url)) return;
      if (!new URL(returned.url).searchParams.has('code')) return;
      const clientId = new URLSearchParams(
        typeof body.oauth_query === 'string' ? body.oauth_query : '',
      ).get('client_id');
      const session = await getSessionFromCtx(ctx);
      if (!clientId || !session) return;
      const consent = await db.oauthConsent.findFirst({
        where: { clientId, userId: session.user.id },
        orderBy: { updatedAt: 'desc' },
        select: { referenceId: true, scopes: true, client: { select: { name: true } } },
      });
      if (!consent?.referenceId) return;
      await recordAuditLog({
        organizationId: consent.referenceId,
        actor: { actorType: 'user', actorId: session.user.id, actorLabel: session.user.email },
        action: 'oauth.connection_granted',
        targetType: 'oauth_client',
        targetId: clientId,
        metadata: { client: consent.client.name, scopes: consent.scopes.join(' ') },
      });
    }),
  },
  /**
   * A failed social callback used to end up at Better Auth's own /error, which
   * redirects to the site root, which redirects to /login — dropping the error
   * code on the way. Clicking "Continue with Google" and landing back on the
   * sign-in page with nothing said is indistinguishable from the button being
   * dead. Send those failures to /login instead, which now reads the code.
   *
   * The client's errorCallbackURL only covers failures where the state still
   * parses; this covers the ones where it does not, which is most of them.
   */
  onAPIError: { errorURL: '/login' },
  account: {
    encryptOAuthTokens: true,
    updateAccountOnSignIn: true,
    accountLinking: {
      enabled: true,
      trustedProviders: trustedSocialProviders,
      allowDifferentEmails: false,
    },
  },
  // Only pre-created app-directory reviewer accounts sign in with a password;
  // it is off unless OTAKIT_REVIEWER_LOGIN is set, and sign-up is never allowed.
  emailAndPassword: { enabled: isReviewerLoginEnabled(), disableSignUp: true },
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
 * Post-signup provisioning: apply pending invites or create a personal
 * organization. Runs once from the user.create hook above. Invites for users
 * who already exist are applied inline by the invite route, so there is no
 * sign-in hook.
 */
export async function provisionUser(userId: string, email: string) {
  const appliedInvites = await db.$transaction(async (tx) => {
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

    return pendingInvites;
  });

  // Signup flow — there is no acting session; attribute to the joining user.
  for (const invite of appliedInvites) {
    await recordAuditLog({
      organizationId: invite.organizationId,
      actor: { actorType: 'system', actorId: userId, actorLabel: email },
      action: 'member.joined',
      targetType: 'member',
      targetId: userId,
      metadata: { email, role: invite.role },
    });
  }
}
