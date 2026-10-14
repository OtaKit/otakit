'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, LoaderCircle, Pencil, Play, Rocket, Square, Trash2 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { CopyButton } from '@/app/components/CopyButton';
import {
  configName,
  experimentSnippet,
  ExperimentStatusBadge,
  formatDay,
  formatLift,
  formatProbability,
  formatShare,
  request,
  VerdictBanner,
  verdictView,
  type ApiError,
} from '@/app/components/experiment-ui';
import { InfoHint } from '@/app/components/InfoHint';
import type { ExperimentResults, ExperimentSummary } from '@/lib/services/experiments';
import type { RemoteConfigState } from '@/lib/services/remote-config';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const COLORS = ['#64748b', '#0ea5e9', '#f97316', '#a855f7', '#10b981'];

type Action = 'start' | 'stop' | 'ship' | 'delete';

function preview(value: unknown): string {
  const text = value === undefined ? 'not set' : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** Cumulative conversion per variant over the days of the test. */
function ConversionChart({ results }: { results: ExperimentResults }) {
  const keys = results.experiment.variants.map((variant) => variant.key);
  const config = Object.fromEntries(
    keys.map((key, index) => [key, { label: key, color: COLORS[index % COLORS.length] }]),
  );
  const rows = results.series.map((point) => ({
    day: point.day,
    ...Object.fromEntries(
      point.variants.map((variant) => [
        variant.key,
        variant.exposed > 0
          ? Math.round((variant.converted / variant.exposed) * 10_000) / 100
          : null,
      ]),
    ),
  }));
  if (rows.length < 2) return null;
  return (
    <section>
      <p className="mb-1 text-xs font-medium text-muted-foreground">
        Conversion so far, by day (UTC)
      </p>
      <ChartContainer config={config} className="aspect-auto h-40 w-full">
        <LineChart data={rows} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            tickFormatter={(value: string) => formatDay(`${value}T12:00:00.000Z`)}
          />
          <YAxis
            width={40}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `${value}%`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => formatDay(`${String(value)}T12:00:00.000Z`)}
                formatter={(value, name) => (
                  <span className="flex w-full justify-between gap-3">
                    <span className="text-muted-foreground">{String(name)}</span>
                    <span className="font-mono tabular-nums">{String(value)}%</span>
                  </span>
                )}
              />
            }
          />
          {keys.map((key) => (
            <Line
              key={key}
              dataKey={key}
              type="linear"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
          <ChartLegend content={<ChartLegendContent />} />
        </LineChart>
      </ChartContainer>
    </section>
  );
}

/** Results of one A/B test, with what can be done next. */
export function ExperimentResultsDialog({
  appId,
  experimentId,
  onClose,
  onChanged,
  onEdit,
  onDuplicate,
}: {
  appId: string;
  experimentId: string;
  onClose: () => void;
  /** The test or its config changed: reload the list and the config. */
  onChanged: () => void;
  onEdit: (experiment: ExperimentSummary) => void;
  onDuplicate: (experiment: ExperimentSummary) => void;
}) {
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [shipVariant, setShipVariant] = useState<string | null>(null);
  const [config, setConfig] = useState<RemoteConfigState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setResults(
        await request<ExperimentResults>(
          `/api/v1/apps/${appId}/experiments/${experimentId}/results`,
        ),
      );
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load the A/B test');
    }
  }, [appId, experimentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const experiment = results?.experiment ?? null;
  const view = results ? verdictView(results) : null;
  const variants = results?.stats?.variants ?? [];
  const goals = experiment?.secondaryEvents ?? [];
  const shipping = experiment?.variants.find((variant) => variant.key === shipVariant) ?? null;

  useEffect(() => {
    if (confirm !== 'ship' || !experiment) return;
    const query = new URLSearchParams({ channel: experiment.channel ?? '' });
    void request<RemoteConfigState>(`/api/v1/apps/${appId}/config?${query}`)
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [appId, confirm, experiment]);

  const leader = useMemo(() => {
    const verdict = results?.stats?.verdict;
    return verdict && 'variant' in verdict ? verdict.variant : null;
  }, [results]);

  async function act(action: Action) {
    if (!experiment) return;
    setBusy(true);
    try {
      const base = `/api/v1/apps/${appId}/experiments/${experiment.id}`;
      if (action === 'delete') {
        await request(base, { method: 'DELETE' });
        toast.success(`Deleted ${experiment.key}`);
        onChanged();
        onClose();
        return;
      }
      const result = await request<{ publicationStatus: 'published' | 'pending' }>(
        `${base}/${action}`,
        {
          method: 'POST',
          ...(action === 'ship' ? { body: JSON.stringify({ variant: shipVariant }) } : {}),
        },
      );
      toast.success(
        action === 'start'
          ? `${experiment.key} is running`
          : action === 'stop'
            ? `${experiment.key} stopped`
            : `Shipped ${shipVariant} of ${experiment.key}`,
      );
      if (result.publicationStatus === 'pending') {
        toast.warning('Writing the config file to the CDN failed; OtaKit retries within minutes.');
      }
      onChanged();
      await load();
    } catch (failure) {
      toast.error((failure as ApiError).message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {experiment?.name ?? 'A/B test'}
            {experiment ? <ExperimentStatusBadge status={experiment.status} /> : null}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {experiment ? (
              <>
                <span className="font-mono">{experiment.key}</span> ·{' '}
                {configName(experiment.channel)}
                {experiment.trafficPercent < 100
                  ? ` · ${experiment.trafficPercent}% of devices`
                  : ''}
                {experiment.startedAt
                  ? ` · ${formatDay(experiment.startedAt)}${experiment.stoppedAt ? ` to ${formatDay(experiment.stoppedAt)}` : ''} (${results?.daysRunning ?? 0} days)`
                  : ''}
                {' · '}goal <span className="font-mono">{experiment.goalEvent}</span>
              </>
            ) : error ? (
              'Could not load the A/B test.'
            ) : (
              'Loading…'
            )}
          </DialogDescription>
        </DialogHeader>

        {!results || !experiment ? (
          <div className="flex justify-center py-10">
            {error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {experiment.status === 'shipped' ? (
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
                {experiment.shippedVariant === 'control'
                  ? 'Ended with control: the config kept its values.'
                  : `${experiment.shippedVariant} shipped: its values are part of the ${configName(experiment.channel).toLowerCase()} for every device.`}
              </p>
            ) : null}
            {view && experiment.status !== 'shipped' ? <VerdictBanner view={view} /> : null}
            {!results.analyticsAvailable ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Analytics are unavailable right now: these counts can be incomplete.
              </p>
            ) : null}
            {results.analyticsPausedUntil ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Custom events are paused by the plan&apos;s monthly limit until{' '}
                {formatDay(results.analyticsPausedUntil)}: new reports of this test are not
                recorded.
              </p>
            ) : null}

            {experiment.status === 'draft' ? (
              <p className="text-sm text-muted-foreground">
                A draft: nothing reaches devices until it starts. Variants:{' '}
                {experiment.variants
                  .map((variant) => `${variant.key} ${variant.weight}%`)
                  .join(', ')}
                .
              </p>
            ) : (
              <section>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border text-left">
                        <th className="py-1.5 pr-3 font-medium">Variant</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Devices</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Converted</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Lift (95%)</th>
                        <th className="py-1.5 pr-3 text-right font-medium">
                          <span className="inline-flex items-center gap-1">
                            Best
                            <InfoHint label="About probability to be best">
                              <p className="text-xs">
                                The probability that the variant has the highest conversion, given
                                the data so far.
                              </p>
                            </InfoHint>
                          </span>
                        </th>
                        <th className="py-1.5 text-right font-medium">With errors</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variants.map((variant) => (
                        <tr
                          key={variant.key}
                          className={cn(
                            'border-b border-border/60',
                            variant.key === leader && 'bg-muted/40',
                          )}
                        >
                          <td className="py-1.5 pr-3 font-mono">
                            {variant.key}
                            <span className="ml-1 font-sans text-muted-foreground">
                              {experiment.variants.find((item) => item.key === variant.key)?.weight}
                              %
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {variant.exposed.toLocaleString('en-US')}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatShare(variant.rate)}
                            <span className="ml-1 text-muted-foreground">
                              ({variant.converted.toLocaleString('en-US')})
                            </span>
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {variant.lift ? (
                              <>
                                {formatLift(variant.lift.median)}
                                <span className="ml-1 text-muted-foreground">
                                  ({formatLift(variant.lift.low)} to {formatLift(variant.lift.high)}
                                  )
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">baseline</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">
                            {formatProbability(variant.probabilityBest)}
                          </td>
                          <td
                            className={cn(
                              'py-1.5 text-right tabular-nums',
                              variant.guardrail === 'worse' &&
                                'font-medium text-amber-700 dark:text-amber-400',
                            )}
                            title={
                              variant.probabilityMoreErrors !== null
                                ? `${formatProbability(variant.probabilityMoreErrors)} probability of more errors than control`
                                : undefined
                            }
                          >
                            {formatShare(variant.errorRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Devices report once each: when they first use the test, the first time they track
                  each goal after that, and their first error after that. No device identifiers.
                </p>
              </section>
            )}

            {goals.length > 0 && variants.length > 0 ? (
              <section>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Other goals</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-b border-border text-left">
                        <th className="py-1.5 pr-3 font-medium">Goal</th>
                        {variants.map((variant) => (
                          <th
                            key={variant.key}
                            className="py-1.5 pr-3 text-right font-mono font-medium"
                          >
                            {variant.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {goals.map((goal) => (
                        <tr key={goal} className="border-b border-border/60">
                          <td className="py-1.5 pr-3 font-mono">{goal}</td>
                          {variants.map((variant) => {
                            const result = variant.secondary[goal];
                            return (
                              <td key={variant.key} className="py-1.5 pr-3 text-right tabular-nums">
                                {formatShare(result?.rate ?? null)}
                                {result?.lift ? (
                                  <span className="ml-1 text-muted-foreground">
                                    {formatLift(result.lift.median)}
                                  </span>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <ConversionChart results={results} />

            <details className="group text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Use it in your app
              </summary>
              <div className="relative mt-2 rounded-md border bg-muted/30 p-3">
                <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
                  {experimentSnippet(experiment)}
                </pre>
                <div className="absolute right-2 top-2">
                  <CopyButton value={experimentSnippet(experiment)} label="Copy code" />
                </div>
              </div>
            </details>
          </div>
        )}

        {experiment ? (
          <DialogFooter className="flex-wrap gap-2 sm:justify-between sm:gap-2">
            <div className="flex gap-2">
              {experiment.status !== 'running' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => setConfirm('delete')}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              ) : null}
              {experiment.status === 'stopped' || experiment.status === 'shipped' ? (
                <Button variant="ghost" size="sm" onClick={() => onDuplicate(experiment)}>
                  <Copy className="size-3.5" />
                  Run again
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {experiment.status === 'draft' ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => onEdit(experiment)}>
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => setConfirm('start')}>
                    <Play className="size-3.5" />
                    Start test
                  </Button>
                </>
              ) : null}
              {experiment.status === 'running' ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirm('stop')}
                >
                  <Square className="size-3.5" />
                  Stop
                </Button>
              ) : null}
              {experiment.status === 'running' || experiment.status === 'stopped' ? (
                <div className="flex gap-2">
                  <Select
                    value={shipVariant ?? ''}
                    onValueChange={(value) => setShipVariant(value)}
                  >
                    <SelectTrigger className="h-8 w-32 text-xs" aria-label="Variant to ship">
                      <SelectValue placeholder="Variant" />
                    </SelectTrigger>
                    <SelectContent>
                      {experiment.variants.map((variant) => (
                        <SelectItem key={variant.key} value={variant.key}>
                          <span className="font-mono">{variant.key}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    disabled={busy || !shipVariant}
                    onClick={() => setConfirm('ship')}
                  >
                    <Rocket className="size-3.5" />
                    Ship
                  </Button>
                </div>
              ) : null}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'start'
                ? `Start ${experiment?.key}?`
                : confirm === 'stop'
                  ? `Stop ${experiment?.key}?`
                  : confirm === 'ship'
                    ? `Ship ${shipVariant} to every device?`
                    : `Delete ${experiment?.key}?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {confirm === 'start' ? (
                  <p>
                    Devices on plugin 3.4+ that read the{' '}
                    {configName(experiment?.channel ?? null).toLowerCase()} get their variant on
                    their next config fetch. While it runs, only its name can change.
                  </p>
                ) : null}
                {confirm === 'stop' ? (
                  <p>
                    Devices get the normal config values on their next fetch. The results stay here;
                    to keep a variant instead, ship it.
                  </p>
                ) : null}
                {confirm === 'delete' ? (
                  <p>The test and its results are deleted. This cannot be undone.</p>
                ) : null}
                {confirm === 'ship' && shipping ? (
                  Object.keys(shipping.overrides).length === 0 ? (
                    <p>
                      {shipping.key} changes no values: the config keeps its values and the test
                      ends.
                    </p>
                  ) : (
                    <>
                      <p>
                        These values become part of the{' '}
                        {configName(experiment?.channel ?? null).toLowerCase()} for every device, as
                        a new config version, and the test ends:
                      </p>
                      <ul className="space-y-1 rounded-md border bg-muted/30 p-2 font-mono text-xs">
                        {Object.entries(shipping.overrides).map(([key, value]) => (
                          <li key={key} className="break-all">
                            {key}:{' '}
                            {preview(config?.status === 'live' ? config.values?.[key] : undefined)}{' '}
                            → {preview(value)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={cn(
                confirm === 'delete' && 'bg-destructive text-white hover:bg-destructive/90',
              )}
              onClick={(event) => {
                event.preventDefault();
                if (confirm) void act(confirm);
              }}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {confirm === 'start'
                ? 'Start test'
                : confirm === 'stop'
                  ? 'Stop test'
                  : confirm === 'ship'
                    ? 'Ship'
                    : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
