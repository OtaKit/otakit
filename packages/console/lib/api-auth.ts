import crypto from 'node:crypto';

import { db } from './db';
import { hashOrganizationApiKey } from './organization-keys';

export type SecretAuthResult =
  | { success: true; organizationId: string; keyId: string }
  | { success: false; error: string };

export type GlobalAdminAuthResult = { success: true } | { success: false; error: string };

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function verifySecretAuth(authHeader: string | null): Promise<SecretAuthResult> {
  const bearerToken = getBearerToken(authHeader);
  if (!bearerToken) {
    return { success: false, error: 'Missing or invalid Authorization header' };
  }

  const keyHash = hashOrganizationApiKey(bearerToken);
  const apiKey = await db.organizationApiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      organizationId: true,
      revokedAt: true,
    },
  });

  if (!apiKey || apiKey.revokedAt !== null) {
    return { success: false, error: 'Invalid secret key' };
  }

  // Keep this lightweight metadata for admin visibility and operational debugging.
  await db.organizationApiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);

  return { success: true, organizationId: apiKey.organizationId, keyId: apiKey.id };
}

export function verifyGlobalAdminAuth(authHeader: string | null): GlobalAdminAuthResult {
  const configuredSecret = process.env.ADMIN_SECRET_KEY ?? process.env.SECRET_KEY;
  if (!configuredSecret) {
    return {
      success: false,
      error: 'Server is missing ADMIN_SECRET_KEY (or SECRET_KEY) configuration',
    };
  }

  const bearerToken = getBearerToken(authHeader);
  if (!bearerToken) {
    return { success: false, error: 'Missing or invalid Authorization header' };
  }

  const providedBuffer = Buffer.from(bearerToken);
  const configuredBuffer = Buffer.from(configuredSecret);
  if (providedBuffer.length !== configuredBuffer.length) {
    return { success: false, error: 'Invalid admin key' };
  }

  if (!crypto.timingSafeEqual(providedBuffer, configuredBuffer)) {
    return { success: false, error: 'Invalid admin key' };
  }

  return { success: true };
}

export async function isAppOwnedByOrganization(
  appId: string,
  organizationId: string,
): Promise<boolean> {
  const app = await db.app.findFirst({
    where: { id: appId, organizationId },
    select: { id: true },
  });
  return app !== null;
}
