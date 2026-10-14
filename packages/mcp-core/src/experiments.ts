/**
 * Summaries for the A/B test tools. They read the REST responses and the
 * console's service results, which have the same shape.
 */

type ExperimentLike = {
  key: string;
  name: string;
  status: 'draft' | 'running' | 'stopped' | 'shipped';
  channel: string | null;
  variants: Array<{ key: string; weight: number }>;
  goalEvent: string;
  overriddenKeys: string[];
  startedAt: string | null;
  shippedVariant: string | null;
};

type VariantResultLike = {
  key: string;
  exposed: number;
  converted: number;
  rate: number | null;
  probabilityBest: number;
  lift: { low: number; median: number; high: number } | null;
  errors: number;
  guardrail: 'ok' | 'worse';
};

type VerdictLike =
  | { kind: 'collecting'; daysLeft: number; conversionsNeeded: number }
  | { kind: 'leading'; variant: string; probability: number }
  | { kind: 'winner'; variant: string; probability: number }
  | { kind: 'no_difference' }
  | { kind: 'guardrail'; variant: string; probability: number };

type ResultsLike = {
  experiment: ExperimentLike;
  stats: {
    variants: VariantResultLike[];
    verdict: VerdictLike;
    plannedPerVariant: number | null;
  } | null;
  daysRunning: number;
  analyticsPausedUntil: string | null;
  analyticsAvailable: boolean;
};

function config(channel: string | null): string {
  return channel === null ? 'the base config' : `the ${channel} config`;
}

function percent(share: number | null): string {
  if (share === null) return '–';
  return `${Math.round(share * 1000) / 10}%`;
}

function signedPercent(share: number): string {
  const value = Math.round(share * 1000) / 10;
  return `${value > 0 ? '+' : ''}${value}%`;
}

function devices(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'device' : 'devices'}`;
}

export function experimentListSummary(experiments: ExperimentLike[]): string {
  if (experiments.length === 0) return 'The app has no A/B tests.';
  const running = experiments.filter((experiment) => experiment.status === 'running');
  const parts = experiments.slice(0, 10).map((experiment) => {
    const variants = experiment.variants
      .map((variant) => `${variant.key} ${variant.weight}%`)
      .join(' / ');
    const status =
      experiment.status === 'shipped'
        ? `shipped ${experiment.shippedVariant ?? ''}`.trim()
        : experiment.status;
    return `${experiment.key} (${status}, ${variants}, goal ${experiment.goalEvent}, on ${config(experiment.channel)})`;
  });
  const more = experiments.length > 10 ? `; ${experiments.length - 10} more` : '';
  return `${experiments.length} A/B ${experiments.length === 1 ? 'test' : 'tests'}, ${running.length} running: ${parts.join('; ')}${more}.`;
}

/** The verdict in one sentence, as the dashboard says it. */
export function experimentVerdictSentence(verdict: VerdictLike): string {
  switch (verdict.kind) {
    case 'collecting':
      return verdict.daysLeft > 0
        ? `Not enough data yet: a result needs ${verdict.daysLeft} more ${verdict.daysLeft === 1 ? 'day' : 'days'}${verdict.conversionsNeeded > 0 ? ` and ${verdict.conversionsNeeded} more conversions in the smallest variant` : ''}.`
        : `Not enough data yet: a result needs ${verdict.conversionsNeeded} more conversions in the smallest variant.`;
    case 'leading':
      return `No winner yet: ${verdict.variant} leads with ${percent(verdict.probability)} probability to be best.`;
    case 'winner':
      return `${verdict.variant} is better: ${percent(verdict.probability)} probability to be best.`;
    case 'no_difference':
      return 'No clear difference: the planned sample is reached and no variant is clearly better.';
    case 'guardrail':
      return `${verdict.variant} has more devices with errors than control (${percent(verdict.probability)} probability).`;
  }
}

export function experimentResultsParts(result: ResultsLike): {
  summary: string;
  warnings: string[];
} {
  const { experiment, stats } = result;
  const warnings: string[] = [];
  if (!result.analyticsAvailable) {
    warnings.push('Analytics are unavailable right now: the counts can be incomplete.');
  }
  if (result.analyticsPausedUntil) {
    warnings.push(
      `Custom events are paused by the plan limit until ${result.analyticsPausedUntil.slice(0, 10)}: new test reports are not recorded.`,
    );
  }
  if (!stats) {
    return {
      summary: `${experiment.key} has not started, so it has no results yet.`,
      warnings,
    };
  }
  const rows = stats.variants
    .map((variant) => {
      const lift = variant.lift
        ? `, lift ${signedPercent(variant.lift.median)} (${signedPercent(variant.lift.low)} to ${signedPercent(variant.lift.high)})`
        : '';
      return `${variant.key}: ${percent(variant.rate)} of ${devices(variant.exposed)} converted${lift}, ${percent(variant.probabilityBest)} to be best`;
    })
    .join('; ');
  return {
    summary: `${experiment.key} (${experiment.status}, ${result.daysRunning} days, goal ${experiment.goalEvent}): ${experimentVerdictSentence(stats.verdict)} ${rows}.`,
    warnings,
  };
}

export function experimentChangeSummary(
  action: 'stopped' | 'shipped',
  result: {
    experiment: ExperimentLike;
    publicationStatus: 'published' | 'pending';
    changedKeys?: string[];
  },
): { summary: string; warnings: string[] } {
  const { experiment } = result;
  const warnings =
    result.publicationStatus === 'pending'
      ? [
          'The change is saved, but writing the config file to the CDN failed; OtaKit retries within minutes. Do not repeat it.',
        ]
      : [];
  if (action === 'stopped') {
    return {
      summary: `Stopped ${experiment.key}. Devices get the normal values of ${config(experiment.channel)} on their next config fetch; the results stay readable.`,
      warnings,
    };
  }
  const variant = experiment.shippedVariant ?? 'the variant';
  const keys = result.changedKeys ?? [];
  return {
    summary:
      keys.length > 0
        ? `Shipped ${variant} of ${experiment.key}: ${keys.join(', ')} ${keys.length === 1 ? 'is' : 'are'} now part of ${config(experiment.channel)} for every device, from their next config fetch.`
        : `Shipped ${variant} of ${experiment.key}: ${config(experiment.channel)} keeps its values, and the test ended.`,
    warnings,
  };
}
