'use client';

import { FlaskConical, ShieldAlert, Sparkles, Trophy } from 'lucide-react';

import type { ExperimentVerdict } from '@/lib/experiment-stats';
import type { ExperimentStatusValue } from '@/lib/experiments';
import type { ExperimentResults } from '@/lib/services/experiments';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Shared pieces of the A/B test section and dialogs. */

export type ApiError = Error & { status?: number; code?: string };

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!response.ok || !body) {
    const error = new Error(body?.error ?? 'Request failed') as ApiError;
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}

export function configName(channel: string | null): string {
  return channel === null ? 'Base config' : `${channel} config`;
}

/** "13.0%", or "–" without a rate. */
export function formatShare(share: number | null, digits = 1): string {
  if (share === null) return '–';
  const value = share * 100;
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${value.toFixed(digits)}%`;
}

/** "+12%" from 0.12: whole percents, as the interval is wide anyway. */
export function formatLift(share: number): string {
  const value = Math.round(share * 100);
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`;
}

export function formatProbability(probability: number): string {
  const value = probability * 100;
  if (value > 99.9) return '>99.9%';
  if (value < 0.1) return '<0.1%';
  return `${Math.round(value * 10) / 10}%`;
}

export function formatDay(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(iso));
}

const STATUS_STYLE: Record<ExperimentStatusValue, string> = {
  draft: 'border-border text-muted-foreground',
  running: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  stopped: 'border-border text-muted-foreground',
  shipped: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

export function ExperimentStatusBadge({ status }: { status: ExperimentStatusValue }) {
  return (
    <Badge
      variant="outline"
      className={cn('h-5 px-1.5 text-[10px] font-medium', STATUS_STYLE[status])}
    >
      {status === 'draft'
        ? 'Draft'
        : status === 'running'
          ? 'Running'
          : status === 'stopped'
            ? 'Stopped'
            : 'Shipped'}
    </Badge>
  );
}

export type VerdictView = {
  title: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning';
  icon: typeof FlaskConical;
};

/** The verdict as the dashboard says it. */
export function verdictView(results: ExperimentResults): VerdictView | null {
  const stats = results.stats;
  if (!stats) return null;
  const verdict: ExperimentVerdict = stats.verdict;
  const ended = results.experiment.status !== 'running';
  const changesConfig = (key: string) =>
    Object.keys(results.experiment.variants.find((variant) => variant.key === key)?.overrides ?? {})
      .length > 0;
  switch (verdict.kind) {
    case 'collecting': {
      const needs = [
        verdict.daysLeft > 0
          ? `${verdict.daysLeft} more ${verdict.daysLeft === 1 ? 'day' : 'days'}`
          : null,
        verdict.conversionsNeeded > 0
          ? `${verdict.conversionsNeeded.toLocaleString('en-US')} more conversions in the smallest variant`
          : null,
      ].filter(Boolean);
      return ended
        ? {
            title: 'Stopped before a result',
            detail:
              'A result needs at least 7 days, 100 conversions per variant and the planned sample.',
            tone: 'neutral',
            icon: FlaskConical,
          }
        : {
            title: 'Not enough data yet',
            detail: `A result needs at least 7 days and 100 conversions per variant: ${needs.join(' and ')}, then the planned sample.`,
            tone: 'neutral',
            icon: FlaskConical,
          };
    }
    case 'leading': {
      const sample =
        verdict.devicesNeeded !== null && stats.plannedPerVariant !== null
          ? `about ${stats.plannedPerVariant.toLocaleString('en-US')} devices per variant (${verdict.devicesNeeded.toLocaleString('en-US')} more in the smallest)`
          : 'the planned sample';
      return ended
        ? {
            title: `Stopped without a result: ${verdict.variant} led`,
            detail: `${formatProbability(verdict.probability)} probability that ${verdict.variant} was the best variant, before ${sample}.`,
            tone: 'neutral',
            icon: FlaskConical,
          }
        : {
            title: `No result yet: ${verdict.variant} leads`,
            detail: `${formatProbability(verdict.probability)} probability that ${verdict.variant} is the best variant so far. The result is decided once, at ${sample}, so that checking early cannot pick a false winner.`,
            tone: 'neutral',
            icon: FlaskConical,
          };
    }
    case 'winner': {
      const next =
        verdict.variant === 'control'
          ? ended
            ? ''
            : ' Stop the test to keep the current values.'
          : ended
            ? ''
            : changesConfig(verdict.variant)
              ? ` Ship ${verdict.variant} to give every device its values.`
              : ` Make ${verdict.variant}'s code path the default in your app, then stop the test.`;
      return {
        title: verdict.variant === 'control' ? 'Control is better' : `${verdict.variant} is better`,
        detail: `${formatProbability(verdict.probability)} probability that ${verdict.variant} is the best variant for ${results.experiment.goalEvent}, at the planned sample on ${formatDay(`${verdict.decidedOn}T12:00:00.000Z`)}.${next}`,
        tone: 'success',
        icon: Trophy,
      };
    }
    case 'no_difference':
      return {
        title: 'No clear difference',
        detail: `At the planned sample on ${formatDay(`${verdict.decidedOn}T12:00:00.000Z`)}, no variant was clearly better.${ended ? '' : ' Keep control, or ship the variant you prefer.'}`,
        tone: 'neutral',
        icon: Sparkles,
      };
    case 'guardrail':
      return {
        title: `${verdict.variant} has more errors`,
        detail: `${formatProbability(verdict.probability)} probability that more devices hit an error on ${verdict.variant} than on control.${ended ? '' : ' Consider stopping the test.'}`,
        tone: 'warning',
        icon: ShieldAlert,
      };
  }
}

/** A short result for the list. */
export function verdictShort(results: ExperimentResults | undefined): string | null {
  const verdict = results?.stats?.verdict;
  if (!verdict) return null;
  switch (verdict.kind) {
    case 'collecting':
      return verdict.daysLeft > 0
        ? `Collecting · ${verdict.daysLeft} ${verdict.daysLeft === 1 ? 'day' : 'days'} left`
        : 'Collecting';
    case 'leading':
      return `No result yet · ${verdict.variant} leads`;
    case 'winner':
      return `${verdict.variant} is better`;
    case 'no_difference':
      return 'No clear difference';
    case 'guardrail':
      return `${verdict.variant}: more errors`;
  }
}

export function VerdictBanner({ view }: { view: VerdictView }) {
  const Icon = view.icon;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3',
        view.tone === 'success' &&
          'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
        view.tone === 'warning' &&
          'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
        view.tone === 'neutral' && 'bg-muted/40',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{view.title}</p>
        <p className="mt-0.5 text-xs opacity-80">{view.detail}</p>
      </div>
    </div>
  );
}

/** Code that reads the test in the app. */
export function experimentSnippet(experiment: {
  key: string;
  overriddenKeys: string[];
  goalEvent: string;
}): string {
  const read =
    experiment.overriddenKeys.length > 0
      ? [
          `// Devices in the test get their variant's values for: ${experiment.overriddenKeys.join(', ')}`,
          'const { values } = await OtaKit.getConfig({ defaults });',
        ]
      : [
          "// 'control', another variant, or null when the device is not in the test",
          `const variant = await OtaKit.getVariant('${experiment.key}');`,
        ];
  return [
    "import { OtaKit, track } from '@otakit/capacitor-updater';",
    '',
    ...read,
    '',
    '// The goal, where it happens:',
    `track('${experiment.goalEvent}');`,
  ].join('\n');
}
