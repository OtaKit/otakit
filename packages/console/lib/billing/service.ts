import { PlanKey } from '@prisma/client';
import { db } from '@/lib/db';
import { getPolar, isPolarConfigured, warnPolarNotConfigured } from '@/lib/polar';
import {
  productIdToPlanKey,
  getExternalCustomerId,
  getPlanLimits,
  type PlanLimits,
} from './config';

// ── Types ───────────────────────────────────────────────────────────

export type OrganizationEntitlements = {
  planKey: PlanKey;
  isActive: boolean;
  limits: PlanLimits;
};

export type BillingState = {
  planKey: PlanKey;
  isActive: boolean;
  downloadsLimit: number;
  polarSubscriptionId: string | null;
  polarCustomerId: string | null;
};

// ── Entitlements ────────────────────────────────────────────────────

export async function getOrganizationEntitlements(
  organizationId: string,
): Promise<OrganizationEntitlements> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { planKey: true, isActive: true, freeDownloadsLimit: true },
  });

  const planKey = organization?.planKey ?? 'free';
  const isActive = organization?.isActive ?? false;

  return {
    planKey,
    isActive,
    limits: getPlanLimits(planKey, organization?.freeDownloadsLimit),
  };
}

// ── Billing state read ──────────────────────────────────────────────

export async function getBillingState(organizationId: string): Promise<BillingState> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      planKey: true,
      isActive: true,
      freeDownloadsLimit: true,
      polarSubscriptionId: true,
      polarCustomerId: true,
    },
  });

  if (!organization) {
    return {
      planKey: 'free',
      isActive: false,
      downloadsLimit: getPlanLimits('free').downloads,
      polarSubscriptionId: null,
      polarCustomerId: null,
    };
  }

  return {
    planKey: organization.planKey,
    isActive: organization.isActive,
    downloadsLimit: getPlanLimits(organization.planKey, organization.freeDownloadsLimit).downloads,
    polarSubscriptionId: organization.polarSubscriptionId,
    polarCustomerId: organization.polarCustomerId,
  };
}

// ── Refresh via Customer State API ──────────────────────────────────

export async function refreshBillingState(organizationId: string): Promise<BillingState> {
  if (!isPolarConfigured()) {
    warnPolarNotConfigured('billing state refresh');
    return getBillingState(organizationId);
  }

  const externalId = getExternalCustomerId(organizationId);

  let planKey: PlanKey = 'free';
  let isActive = false;
  let polarCustomerId: string | null = null;
  let polarSubscriptionId: string | null = null;

  try {
    const polar = getPolar();
    const state = await polar.customers.getStateExternal({ externalId });

    polarCustomerId = state.id ?? null;

    const activeSub = state.activeSubscriptions?.find(
      (s) => s.status === 'active' || s.status === 'trialing',
    );

    if (activeSub) {
      polarSubscriptionId = activeSub.id ?? null;
      planKey = productIdToPlanKey(activeSub.productId);
      isActive = true;
    }
  } catch (err: unknown) {
    // 404 = customer doesn't exist in Polar yet — stay on free
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? (err as { statusCode: number }).statusCode
        : null;
    if (statusCode !== 404) throw err;
  }

  const organization = await db.organization.update({
    where: { id: organizationId },
    data: {
      planKey,
      isActive,
      polarCustomerId,
      polarSubscriptionId,
      // Overage is a Pro-only opt-in. Clear it on cancellation or a move to
      // Starter/Free so a stale toggle can never bypass those hard caps.
      ...(planKey === 'pro' ? {} : { overageEnabled: false }),
    },
    select: {
      planKey: true,
      isActive: true,
      freeDownloadsLimit: true,
      polarSubscriptionId: true,
      polarCustomerId: true,
    },
  });

  return {
    planKey: organization.planKey,
    isActive: organization.isActive,
    downloadsLimit: getPlanLimits(organization.planKey, organization.freeDownloadsLimit).downloads,
    polarSubscriptionId: organization.polarSubscriptionId,
    polarCustomerId: organization.polarCustomerId,
  };
}
