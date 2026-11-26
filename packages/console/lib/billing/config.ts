import { PlanKey } from '@prisma/client';

import { isPolarConfigured } from '@/lib/polar';

import {
  CREDIT_PACKS,
  getCreditPackForPlan,
  type CreditPack,
  type CreditPackKey,
} from './credit-packs';

export type PlanLimits = {
  downloads: number;
  teamMembers: boolean;
};

// Enterprise has no metered cap — it's a custom, operator-provisioned contract.
// A finite-but-effectively-infinite ceiling keeps every `limit > 0` guard and
// percentage calc honest while never blocking an enterprise org.
export const ENTERPRISE_DOWNLOADS = Number.MAX_SAFE_INTEGER;
export const NEW_FREE_DOWNLOADS = 5_000;
export const LEGACY_FREE_DOWNLOADS = 100_000;

const PLAN_LIMITS: Record<Exclude<PlanKey, 'free'>, PlanLimits> = {
  starter: { downloads: 100_000, teamMembers: false },
  pro: { downloads: 1_000_000, teamMembers: true },
  enterprise: { downloads: ENTERPRISE_DOWNLOADS, teamMembers: true },
};

/**
 * Maps Polar product IDs (from env) to local plan keys.
 * Built once on first access, includes yearly IDs when configured.
 */
export type BillingInterval = 'month' | 'year';

let productToPlanMap: Map<string, PlanKey> | null = null;

function getProductToPlanMap(): Map<string, PlanKey> {
  if (productToPlanMap) return productToPlanMap;

  const map = new Map<string, PlanKey>();
  const entries: [string | undefined, PlanKey][] = [
    [process.env.POLAR_PRODUCT_STARTER_MONTHLY, 'starter'],
    [process.env.POLAR_PRODUCT_PRO_MONTHLY, 'pro'],
    [process.env.POLAR_PRODUCT_PRO_YEARLY, 'pro'],
  ];

  for (const [productId, planKey] of entries) {
    if (productId) map.set(productId, planKey);
  }

  productToPlanMap = map;
  return map;
}

export function productIdToPlanKey(productId: string | null | undefined): PlanKey {
  if (!productId) return 'free';
  const planKey = getProductToPlanMap().get(productId);
  if (!planKey) {
    throw new Error(`Unknown Polar product ID: ${productId}. Check POLAR_PRODUCT_* env vars.`);
  }
  return planKey;
}

// Starter is monthly-only. Pro supports both billing intervals. Free needs no
// checkout and Enterprise is a contact-sales contract.
export function planKeyToProductId(
  planKey: PlanKey,
  interval: BillingInterval = 'month',
): string | null {
  if (planKey === 'starter') {
    return interval === 'month' ? (process.env.POLAR_PRODUCT_STARTER_MONTHLY ?? null) : null;
  }
  if (planKey === 'pro') {
    return interval === 'year'
      ? (process.env.POLAR_PRODUCT_PRO_YEARLY ?? null)
      : (process.env.POLAR_PRODUCT_PRO_MONTHLY ?? null);
  }
  return null;
}

// ── Extra download packs ────────────────────────────────────────────
// One-time Polar products without benefits: the credits are written to our own
// database when the order is paid (see credits.ts).

const CREDIT_PACK_PRODUCT_ENV: Record<CreditPackKey, string> = {
  downloads_5k: 'POLAR_PRODUCT_CREDITS_5K',
  downloads_100k: 'POLAR_PRODUCT_CREDITS_100K',
  downloads_1m: 'POLAR_PRODUCT_CREDITS_1M',
};

export function creditPackProductId(key: CreditPackKey): string | null {
  return process.env[CREDIT_PACK_PRODUCT_ENV[key]]?.trim() || null;
}

export function creditPackForProductId(productId: string | null | undefined): CreditPack | null {
  if (!productId) return null;
  return CREDIT_PACKS.find((pack) => creditPackProductId(pack.key) === productId) ?? null;
}

export function configuredCreditPackProductIds(): string[] {
  return CREDIT_PACKS.map((pack) => creditPackProductId(pack.key)).filter(
    (productId): productId is string => productId !== null,
  );
}

/**
 * The pack this plan can buy right now: null for Enterprise, or when billing or
 * the pack's Polar product is not configured on this instance.
 */
export function getPurchasableCreditPack(planKey: PlanKey): CreditPack | null {
  if (!isPolarConfigured()) return null;
  const pack = getCreditPackForPlan(planKey);
  if (!pack || !creditPackProductId(pack.key)) return null;
  return pack;
}

export function getPlanLimits(
  planKey: PlanKey,
  freeDownloadsLimit: number = NEW_FREE_DOWNLOADS,
): PlanLimits {
  if (planKey === 'free') {
    return { downloads: freeDownloadsLimit, teamMembers: false };
  }
  return PLAN_LIMITS[planKey];
}

// Polar identifies a customer by this external id. Both helpers share one
// prefix constant so the build and parse halves can never drift out of sync.
const ORGANIZATION_EXTERNAL_ID_PREFIX = 'organization:';

export function getExternalCustomerId(organizationId: string): string {
  return `${ORGANIZATION_EXTERNAL_ID_PREFIX}${organizationId}`;
}

export function parseOrganizationIdFromExternalId(externalId: string): string | null {
  if (!externalId.startsWith(ORGANIZATION_EXTERNAL_ID_PREFIX)) return null;
  const organizationId = externalId.slice(ORGANIZATION_EXTERNAL_ID_PREFIX.length);
  return organizationId.length > 0 ? organizationId : null;
}
