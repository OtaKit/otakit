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
  // Share of effectiveLimit used, rounded down: 100 only once the limit is
  // actually reached, so the 100% email never says paused too early.
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
    percentage: effectiveLimit > 0 ? Math.floor((downloads / effectiveLimit) * 100) : 0,
    usageBlocked: input.enforceLimits && downloads >= effectiveLimit,
  };
}

export type UsageWarning = 'none' | 'at90' | 'at100';

/**
 * Which usage emails are due. Warnings follow the current ceiling: when more
 * downloads become available (a pack, a bigger plan), the ones already sent are
 * re-armed, so running out again is announced again. The 90% email is not
 * repeated right after a purchase that still leaves usage at 90% or more.
 */
export function nextUsageWarning(args: {
  previous: UsageWarning;
  percentage: number;
  sendWarnings: boolean;
}): { warningSent: UsageWarning; threshold: 90 | 100 | null } {
  let warningSent = args.previous;
  if (args.percentage < 90) {
    warningSent = 'none';
  } else if (args.percentage < 100 && warningSent === 'at100') {
    warningSent = 'at90';
  }

  if (!args.sendWarnings) return { warningSent, threshold: null };
  if (args.percentage >= 100 && warningSent !== 'at100') {
    return { warningSent: 'at100', threshold: 100 };
  }
  if (args.percentage >= 90 && warningSent === 'none') {
    return { warningSent: 'at90', threshold: 90 };
  }
  return { warningSent, threshold: null };
}
