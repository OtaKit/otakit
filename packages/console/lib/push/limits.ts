import type { PlanKey } from '@prisma/client';

export type PushLimits = {
  /** Registered devices across all apps of the organization. */
  devices: number;
  /** Notifications accepted by Apple/Google per billing month. */
  sendsPerMonth: number;
};

// Founder-approved proposal (plans/roadmap-2026-q4/03): generous free tier as a
// marketing hook; Apple and Google charge nothing to send.
const PUSH_LIMITS: Record<PlanKey, PushLimits> = {
  free: { devices: 10_000, sendsPerMonth: 100_000 },
  starter: { devices: 50_000, sendsPerMonth: 1_000_000 },
  pro: { devices: 250_000, sendsPerMonth: 5_000_000 },
  enterprise: { devices: Number.MAX_SAFE_INTEGER, sendsPerMonth: Number.MAX_SAFE_INTEGER },
};

export function getPushLimits(planKey: PlanKey): PushLimits {
  return PUSH_LIMITS[planKey];
}

/** Start of the push usage period: the billing period if known, else the calendar month (UTC). */
export function pushPeriodStart(usagePeriodStart: Date | null, now: Date = new Date()): Date {
  if (usagePeriodStart && usagePeriodStart <= now) return usagePeriodStart;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
