// Pure monthly usage math shared by the usage refresh, the month close and
// the read-only snapshot. Kept free of I/O so every rule is unit-tested.
//
// Order of use within a month: the plan's included downloads first, then Pro
// overage that was already reported to Polar (it is billed, so credits never
// cover it a second time), then extra download credits, then (Pro with
// additional usage on) new overage.

export type UsageStateInput = {
  downloads: number;
  includedLimit: number;
  // Credits left before this month's use: pooled grants minus closed months.
  creditsAvailable: number;
  // Downloads already sent to the Polar meter this month (Pro only).
  polarReportedCount: number;
  overageEnabled: boolean;
  // False when billing is not configured: usage is never blocked.
  enforceLimits: boolean;
};

export type UsageState = {
  creditsUsed: number;
  creditsRemaining: number;
  // Included downloads plus the credits available this month.
  effectiveLimit: number;
  percentage: number;
  usageBlocked: boolean;
  // Downloads the Polar meter should hold (credit-covered ones excluded).
  polarTarget: number;
};

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function computeUsageState(input: UsageStateInput): UsageState {
  const downloads = nonNegativeInt(input.downloads);
  const included = nonNegativeInt(input.includedLimit);
  const available = nonNegativeInt(input.creditsAvailable);
  const paidOverage = Math.max(0, nonNegativeInt(input.polarReportedCount) - included);

  const overflow = Math.max(0, downloads - included);
  const creditsUsed = Math.min(Math.max(0, overflow - paidOverage), available);
  const effectiveLimit = Math.min(Number.MAX_SAFE_INTEGER, included + available);
  const blockAt = Math.min(Number.MAX_SAFE_INTEGER, included + paidOverage + available);

  return {
    creditsUsed,
    creditsRemaining: available - creditsUsed,
    effectiveLimit,
    percentage: effectiveLimit > 0 ? Math.round((downloads / effectiveLimit) * 100) : 0,
    usageBlocked: input.enforceLimits && !input.overageEnabled && downloads >= blockAt,
    polarTarget: downloads - creditsUsed,
  };
}
