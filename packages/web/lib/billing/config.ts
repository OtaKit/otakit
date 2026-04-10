import { PlanKey } from '@prisma/client';

export type PlanLimits = {
  downloads: number;
  teamMembers: boolean;
};

const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  starter: { downloads: 1_000, teamMembers: false },
  pro: { downloads: 100_000, teamMembers: true },
  scale: { downloads: 1_000_000, teamMembers: true },
};

/**
 * Maps Polar product IDs (from env) to local plan keys.
 * Built once on first access, includes yearly IDs when configured.
 */
let productToPlanMap: Map<string, PlanKey> | null = null;

function getProductToPlanMap(): Map<string, PlanKey> {
  if (productToPlanMap) return productToPlanMap;

  const map = new Map<string, PlanKey>();
  const entries: [string | undefined, PlanKey][] = [
    [process.env.POLAR_PRODUCT_PRO_MONTHLY, 'pro'],
    [process.env.POLAR_PRODUCT_SCALE_MONTHLY, 'scale'],
    [process.env.POLAR_PRODUCT_PRO_YEARLY, 'pro'],
    [process.env.POLAR_PRODUCT_SCALE_YEARLY, 'scale'],
  ];

  for (const [productId, planKey] of entries) {
    if (productId) map.set(productId, planKey);
  }

  productToPlanMap = map;
  return map;
}

export function productIdToPlanKey(productId: string | null | undefined): PlanKey {
  if (!productId) return 'starter';
  const planKey = getProductToPlanMap().get(productId);
  if (!planKey) {
    throw new Error(`Unknown Polar product ID: ${productId}. Check POLAR_PRODUCT_* env vars.`);
  }
  return planKey;
}

export function planKeyToProductId(planKey: PlanKey): string | null {
  switch (planKey) {
    case 'pro':
      return process.env.POLAR_PRODUCT_PRO_MONTHLY ?? null;
    case 'scale':
      return process.env.POLAR_PRODUCT_SCALE_MONTHLY ?? null;
    default:
      return null;
  }
}

export function getPlanLimits(planKey: PlanKey): PlanLimits {
  return PLAN_LIMITS[planKey];
}

export function getExternalCustomerId(organizationId: string): string {
  return `organization:${organizationId}`;
}

export function parseOrganizationIdFromExternalId(externalId: string): string | null {
  if (!externalId.startsWith('organization:')) return null;
  return externalId.slice(7);
}
