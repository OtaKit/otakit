/**
 * Experiment statistics: Bayesian conversion analysis of devices per variant.
 *
 * Each device reports its exposure once, and each goal or error once after
 * that, so `exposed` and `converted` count devices. A variant's conversion
 * rate has the posterior Beta(1 + converted, 1 + exposed - converted); the
 * probabilities and lift intervals come from seeded draws, so the same counts
 * always give the same numbers. Safe to import from client components.
 *
 * The result is decided once, at a fixed horizon: on the data of the first
 * full day when the test ran 7 days, every variant has 100 conversions and
 * every variant reached the planned sample. Deciding on whatever the data
 * shows whenever someone looks would find a winner in about a third of tests
 * without any real difference; a fixed horizon keeps that near 5%.
 */

export const CONTROL_VARIANT = 'control';
/** A result needs this many days since the start... */
export const MIN_DAYS = 7;
/** ...and this many converted devices in every variant. */
export const MIN_CONVERSIONS = 100;
/**
 * Probability to be best that decides the result: for control as is, for a
 * variant divided among the variants (0.95 with one variant, 0.983 with three).
 */
export const DECISION_PROBABILITY = 0.95;
/** Probability of more devices with errors that flags a variant, divided among the variants. */
export const GUARDRAIL_PROBABILITY = 0.995;
/** A guardrail flag needs at least this many devices with errors in the variant... */
export const MIN_GUARDRAIL_ERRORS = 10;
/** ...and this many days since the start. */
export const MIN_GUARDRAIL_DAYS = 3;
/** The planned sample detects a relative change of this size... */
export const PLANNED_RELATIVE_CHANGE = 0.2;
const Z_ALPHA = 1.959964; // two-sided 0.05
const Z_POWER = 0.841621; // power 0.8
const DEFAULT_DRAWS = 20_000;

export type VariantCounts = {
  key: string;
  /** Devices that used the experiment. */
  exposed: number;
  /** Devices that tracked the primary goal after their exposure. */
  converted: number;
  /** Devices whose error tracking sent an error after their exposure. */
  errors: number;
  /** Devices that tracked each secondary goal after their exposure. */
  secondary?: Record<string, number>;
};

export type Interval = { low: number; median: number; high: number };

export type GoalResult = {
  converted: number;
  /** converted / exposed, or null without exposed devices. */
  rate: number | null;
  /** Null for the control variant. */
  probabilityBetterThanControl: number | null;
  /** Relative change of the rate against control (0.12 = +12%); null for control. */
  lift: Interval | null;
};

export type VariantResult = GoalResult & {
  key: string;
  exposed: number;
  probabilityBest: number;
  errors: number;
  errorRate: number | null;
  /** Probability that the variant's error share is higher than control's; null for control. */
  probabilityMoreErrors: number | null;
  guardrail: 'ok' | 'worse';
  secondary: Record<string, GoalResult>;
};

export type ExperimentVerdict =
  /** Under the minimum days or conversions. */
  | { kind: 'collecting'; daysLeft: number; conversionsNeeded: number }
  /** Enough days and conversions, the planned sample not reached yet: no result. */
  | { kind: 'leading'; variant: string; probability: number; devicesNeeded: number | null }
  /** Decided on `decidedOn` (UTC day) at the planned sample. */
  | { kind: 'winner'; variant: string; probability: number; decidedOn: string }
  /** Decided at the planned sample without a variant clearly best. */
  | { kind: 'no_difference'; decidedOn: string }
  /** A variant has clearly more devices with errors than control. */
  | { kind: 'guardrail'; variant: string; probability: number };

/** Cumulative devices per variant through the end of a UTC day. */
export type DailyCounts = {
  day: string;
  variants: Array<{ key: string; exposed: number; converted: number }>;
};

/** The data a result is decided on: the first full day that met every condition. */
export type ExperimentDecision = DailyCounts & { daysRunning: number; plannedPerVariant: number };

export type ExperimentStats = {
  /**
   * Every variant has devices. Without that, probabilities and lifts only
   * restate the prior: show them as unknown.
   */
  comparable: boolean;
  variants: VariantResult[];
  verdict: ExperimentVerdict;
  /** Devices per variant to detect a 20% change at control's rate; null before control converts. */
  plannedPerVariant: number | null;
};

/** FNV-1a: a 32-bit seed from text. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** mulberry32: small, fast and good enough for Monte Carlo. Returns (0, 1). */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

function normal(random: () => number): number {
  // Box-Muller; random() is never 0.
  return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}

/** Marsaglia-Tsang for shape >= 1 (every shape here is 1 + a count). */
function gamma(shape: number, random: () => number): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function betaDraws(successes: number, trials: number, draws: number, random: () => number) {
  const values = new Float64Array(draws);
  const a = 1 + successes;
  const b = 1 + Math.max(0, trials - successes);
  for (let index = 0; index < draws; index += 1) {
    const x = gamma(a, random);
    values[index] = x / (x + gamma(b, random));
  }
  return values;
}

function quantile(sorted: Float64Array, share: number): number {
  const position = (sorted.length - 1) * share;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Share of draws where `left` is above `right`. */
function probabilityAbove(left: Float64Array, right: Float64Array): number {
  let above = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] > right[index]) above += 1;
  return above / left.length;
}

function liftInterval(variant: Float64Array, control: Float64Array): Interval {
  const lifts = new Float64Array(variant.length);
  for (let index = 0; index < variant.length; index += 1) {
    lifts[index] = (variant[index] - control[index]) / control[index];
  }
  lifts.sort();
  return {
    low: round(quantile(lifts, 0.025), 4),
    median: round(quantile(lifts, 0.5), 4),
    high: round(quantile(lifts, 0.975), 4),
  };
}

/**
 * Devices per variant to detect a relative change of `change` from `rate`
 * (two proportions, two-sided α 0.05, power 0.8), or null when it cannot be
 * estimated.
 */
export function plannedSamplePerVariant(
  rate: number | null,
  change = PLANNED_RELATIVE_CHANGE,
): number | null {
  if (rate === null || !(rate > 0)) return null;
  const p1 = rate;
  const p2 = rate * (1 + change);
  if (p2 >= 1) return null;
  const mean = (p1 + p2) / 2;
  const numerator =
    Z_ALPHA * Math.sqrt(2 * mean * (1 - mean)) + Z_POWER * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((numerator * numerator) / ((p2 - p1) * (p2 - p1)));
}

function clampCounts(counts: VariantCounts): VariantCounts {
  const exposed = Math.max(0, Math.floor(counts.exposed));
  const cap = (value: number) => Math.min(exposed, Math.max(0, Math.floor(value)));
  return {
    key: counts.key,
    exposed,
    converted: cap(counts.converted),
    errors: cap(counts.errors),
    secondary: Object.fromEntries(
      Object.entries(counts.secondary ?? {}).map(([goal, value]) => [goal, cap(value)]),
    ),
  };
}

/**
 * Analyse an experiment. `variants` must start with control. `daysRunning`
 * counts whole and partial days since the start (until the stop when stopped).
 */
/** The probability to be best a variant needs to win, for `variants` variants with control. */
export function decisionThreshold(variant: string, variants: number): number {
  return variant === CONTROL_VARIANT
    ? DECISION_PROBABILITY
    : 1 - (1 - DECISION_PROBABILITY) / Math.max(1, variants - 1);
}

/**
 * The first day of `series` (ascending) that ended by `cutoffMs` and on which
 * the test had run 7 days, every variant had 100 conversions, and every
 * variant had the planned sample for control's rate on that day.
 */
export function findDecision(
  series: DailyCounts[],
  startedAtMs: number,
  cutoffMs: number,
): ExperimentDecision | null {
  for (const point of series) {
    const dayEnd = Date.parse(`${point.day}T00:00:00.000Z`) + 86_400_000;
    if (dayEnd > cutoffMs) break;
    const daysRunning = (dayEnd - startedAtMs) / 86_400_000;
    if (daysRunning < MIN_DAYS || point.variants.length < 2) continue;
    if (point.variants.some((variant) => variant.converted < MIN_CONVERSIONS)) continue;
    const control = point.variants[0];
    const planned = plannedSamplePerVariant(
      control.exposed > 0 ? control.converted / control.exposed : null,
    );
    if (planned === null || point.variants.some((variant) => variant.exposed < planned)) continue;
    return { ...point, daysRunning, plannedPerVariant: planned };
  }
  return null;
}

export function analyzeExperiment(input: {
  variants: VariantCounts[];
  daysRunning: number;
  seed: string;
  draws?: number;
  /** The decision point (findDecision), or null while there is none. */
  decision?: ExperimentDecision | null;
}): ExperimentStats {
  const variants = input.variants.map(clampCounts);
  const draws = input.draws ?? DEFAULT_DRAWS;
  const seedText = `${input.seed}|${variants
    .map((variant) => `${variant.key}:${variant.exposed}:${variant.converted}:${variant.errors}`)
    .join('|')}`;
  const random = generator(hash(seedText));

  const conversion = variants.map((variant) =>
    betaDraws(variant.converted, variant.exposed, draws, random),
  );
  const errors = variants.map((variant) =>
    betaDraws(variant.errors, variant.exposed, draws, random),
  );

  const best = new Array<number>(variants.length).fill(0);
  for (let draw = 0; draw < draws; draw += 1) {
    let top = 0;
    for (let index = 1; index < variants.length; index += 1) {
      if (conversion[index][draw] > conversion[top][draw]) top = index;
    }
    best[top] += 1;
  }

  const goals = Array.from(
    new Set(variants.flatMap((variant) => Object.keys(variant.secondary ?? {}))),
  ).sort();
  const secondaryDraws = new Map(
    goals.map((goal) => [
      goal,
      variants.map((variant) =>
        betaDraws(variant.secondary?.[goal] ?? 0, variant.exposed, draws, random),
      ),
    ]),
  );

  const guardrailThreshold = 1 - (1 - GUARDRAIL_PROBABILITY) / Math.max(1, variants.length - 1);
  const results: VariantResult[] = variants.map((variant, index) => {
    const isControl = index === 0;
    const rate = (value: number) =>
      variant.exposed > 0 ? round(value / variant.exposed, 6) : null;
    const probabilityMoreErrors = isControl
      ? null
      : round(probabilityAbove(errors[index], errors[0]), 4);
    return {
      key: variant.key,
      exposed: variant.exposed,
      converted: variant.converted,
      rate: rate(variant.converted),
      probabilityBest: round(best[index] / draws, 4),
      probabilityBetterThanControl: isControl
        ? null
        : round(probabilityAbove(conversion[index], conversion[0]), 4),
      lift: isControl ? null : liftInterval(conversion[index], conversion[0]),
      errors: variant.errors,
      errorRate: rate(variant.errors),
      probabilityMoreErrors,
      guardrail:
        probabilityMoreErrors !== null &&
        probabilityMoreErrors >= guardrailThreshold &&
        variant.errors >= MIN_GUARDRAIL_ERRORS &&
        input.daysRunning >= MIN_GUARDRAIL_DAYS
          ? 'worse'
          : 'ok',
      secondary: Object.fromEntries(
        goals.map((goal) => {
          const goalDraws = secondaryDraws.get(goal)!;
          const converted = variant.secondary?.[goal] ?? 0;
          return [
            goal,
            {
              converted,
              rate: rate(converted),
              probabilityBetterThanControl: isControl
                ? null
                : round(probabilityAbove(goalDraws[index], goalDraws[0]), 4),
              lift: isControl ? null : liftInterval(goalDraws[index], goalDraws[0]),
            },
          ];
        }),
      ),
    };
  });

  const control = results[0];
  const plannedPerVariant = plannedSamplePerVariant(control?.rate ?? null);
  const decided = input.decision ? decide(input.decision, input.seed, draws) : null;
  return {
    comparable: variants.every((variant) => variant.exposed > 0),
    variants: results,
    verdict: verdictOf(results, input.daysRunning, plannedPerVariant, decided),
    plannedPerVariant,
  };
}

/** The result on the decision day's data: a winner past its threshold, else no difference. */
function decide(
  decision: ExperimentDecision,
  seed: string,
  draws: number,
): Extract<ExperimentVerdict, { kind: 'winner' | 'no_difference' }> {
  const snapshot = analyzeExperiment({
    variants: decision.variants.map((variant) => ({ ...variant, errors: 0 })),
    daysRunning: decision.daysRunning,
    seed: `${seed}|${decision.day}`,
    draws,
  });
  const leader = [...snapshot.variants].sort(
    (left, right) => right.probabilityBest - left.probabilityBest,
  )[0];
  return leader.probabilityBest >= decisionThreshold(leader.key, snapshot.variants.length)
    ? {
        kind: 'winner',
        variant: leader.key,
        probability: leader.probabilityBest,
        decidedOn: decision.day,
      }
    : { kind: 'no_difference', decidedOn: decision.day };
}

function verdictOf(
  results: VariantResult[],
  daysRunning: number,
  plannedPerVariant: number | null,
  decided: Extract<ExperimentVerdict, { kind: 'winner' | 'no_difference' }> | null,
): ExperimentVerdict {
  const harmful = results
    .filter((variant) => variant.guardrail === 'worse')
    .sort(
      (left, right) => (right.probabilityMoreErrors ?? 0) - (left.probabilityMoreErrors ?? 0),
    )[0];
  if (harmful) {
    return {
      kind: 'guardrail',
      variant: harmful.key,
      probability: harmful.probabilityMoreErrors ?? 0,
    };
  }
  if (decided) return decided;
  const conversionsNeeded = Math.max(
    0,
    ...results.map((variant) => MIN_CONVERSIONS - variant.converted),
  );
  const daysLeft = Math.max(0, Math.ceil(MIN_DAYS - daysRunning));
  if (daysLeft > 0 || conversionsNeeded > 0) {
    return { kind: 'collecting', daysLeft, conversionsNeeded };
  }
  const leader = [...results].sort(
    (left, right) => right.probabilityBest - left.probabilityBest,
  )[0];
  const smallest = Math.min(...results.map((variant) => variant.exposed));
  return {
    kind: 'leading',
    variant: leader.key,
    probability: leader.probabilityBest,
    devicesNeeded: plannedPerVariant === null ? null : Math.max(0, plannedPerVariant - smallest),
  };
}
