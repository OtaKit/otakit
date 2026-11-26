// Pure monthly usage math shared by the usage refresh, the month close and
// the read-only snapshot. Kept free of I/O so every rule is unit-tested.
//
// Every plan works the same way: the plan's included downloads first, then
// extra download credits (prepaid packs), then updates pause until the next
// month or a new pack.

export type UsageStateInput = {
  downloads: number;
  includedLimit: number;
  // Credits left before this month's use: pooled grants minus closed months.
  creditsAvailable: number;
  // False when billing is not configured: usage is never blocked.
  enforceLimits: boolean;
};

export type UsageState = {
  creditsUsed: number;
  creditsRemaining: number;
  // Where updates pause: included downloads plus the credits available.
  effectiveLimit: number;
  percentage: number;
  usageBlocked: boolean;
};

function nonNegativeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function computeUsageState(input: UsageStateInput): UsageState {
  const downloads = nonNegativeInt(input.downloads);
  const included = nonNegativeInt(input.includedLimit);
  const available = nonNegativeInt(input.creditsAvailable);

  const creditsUsed = Math.min(Math.max(0, downloads - included), available);
  const effectiveLimit = Math.min(Number.MAX_SAFE_INTEGER, included + available);

  return {
    creditsUsed,
    creditsRemaining: available - creditsUsed,
    effectiveLimit,
    percentage: effectiveLimit > 0 ? Math.round((downloads / effectiveLimit) * 100) : 0,
    usageBlocked: input.enforceLimits && downloads >= effectiveLimit,
  };
}
