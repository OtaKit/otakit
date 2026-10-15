'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChartLine, LoaderCircle } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReleaseHistoryItem } from '@/app/components/dashboard-types';
import { InfoHint } from '@/app/components/InfoHint';
import type { ReleaseErrorComparison } from '@/lib/services/error-issues';
import type {
  ReleaseTimeseries,
  ReleaseTimeseriesMarker,
  ReleaseTimeseriesRange,
} from '@/lib/services/release-timeseries';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

const RANGES: Array<{ value: ReleaseTimeseriesRange; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

const YOUNG_RELEASE_MS = 2 * 24 * 60 * 60 * 1000;

// Distinct in light and dark themes, so neighbouring releases never blend.
const LANE_COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e', '#64748b'];

const MARKER_COLORS: Record<ReleaseTimeseriesMarker['type'], string> = {
  released: 'var(--chart-2)',
  rollout: 'var(--chart-3)',
  reverted: 'var(--chart-4)',
  auto_reverted: 'var(--destructive)',
};

type Platform = 'all' | 'ios' | 'android';

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Axis and tooltip labels: hours in the viewer's time zone, days as UTC dates. */
function timeLabels(granularity: 'hour' | 'day', range: ReleaseTimeseriesRange) {
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const hour = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
  const dayHour = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const localDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  return {
    tick: (value: number) =>
      granularity === 'day'
        ? day.format(value)
        : range === '24h'
          ? hour.format(value)
          : localDay.format(value),
    /** One bucket: "Oct 10, 10:00–11:00", or "Oct 10 (UTC)". */
    bucket: (start: number, end: number) =>
      granularity === 'day'
        ? `${day.format(start)} (UTC)`
        : `${dayHour.format(start)}–${hour.format(end)}`,
    /** A moment, such as a marker: "Oct 10, 10:32". */
    at: (value: number) => dayHour.format(value),
    /** A running total at the end of a bucket: "By Oct 10, 11:00", or "Through Oct 10 (UTC)". */
    total: (start: number, end: number) =>
      granularity === 'day' ? `Through ${day.format(start)} (UTC)` : `By ${dayHour.format(end)}`,
  };
}

/**
 * Explicit ticks where automatic ones would repeat a label: one per local day
 * for 7 days of hours, and every fifth UTC day for 30 days. 24 hours of hours
 * label well on their own.
 */
function axisTicks(range: ReleaseTimeseriesRange, from: number, to: number): number[] | undefined {
  const ticks: number[] = [];
  if (range === '7d') {
    const midnight = new Date(from);
    midnight.setHours(24, 0, 0, 0);
    for (let next = midnight; next.getTime() <= to; next.setDate(next.getDate() + 1)) {
      ticks.push(next.getTime());
    }
    return ticks;
  }
  if (range === '30d') {
    for (let next = from; next <= to; next += 5 * DAY_MS) ticks.push(next);
    return ticks;
  }
  return undefined;
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'warning' | 'danger';
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        {hint ? (
          <InfoHint label={`About ${label.toLowerCase()}`}>
            <p className="text-xs">{hint}</p>
          </InfoHint>
        ) : null}
      </div>
      <div
        className={cn(
          'mt-0.5 text-lg font-semibold tabular-nums',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'danger' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * How a release spreads and how healthy it is over time, plus the lane's
 * releases replacing each other. Loaded on demand from the release menu.
 */
function formatRate(rate: number | null): string {
  if (rate === null) return '–';
  if (rate > 0 && rate < 0.1) return '<0.1';
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
}

/** The release's error tracking numbers (180 days), next to the release it replaced. */
function ReleaseErrors({
  appId,
  releaseId,
  onViewErrors,
}: {
  appId: string;
  releaseId: string;
  onViewErrors: () => void;
}) {
  const [data, setData] = useState<ReleaseErrorComparison | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/apps/${appId}/releases/${releaseId}/errors`, { signal: controller.signal })
      .then(async (response) =>
        response.ok ? ((await response.json()) as ReleaseErrorComparison) : null,
      )
      .then((body) => setData(body))
      .catch(() => undefined);
    return () => controller.abort();
  }, [appId, releaseId]);

  if (!data?.analyticsAvailable) return null;
  const { release, previous } = data;
  const worse =
    release.perThousandApplies !== null &&
    previous?.perThousandApplies != null &&
    release.events >= 20 &&
    release.perThousandApplies >= 3 * Math.max(previous.perThousandApplies, 0.0001);
  return (
    <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs">
      {release.events === 0 ? (
        <span className="text-muted-foreground">
          No errors reported for this release. Error tracking needs plugin 3.4+ and{' '}
          <code>initErrorTracking()</code>.
        </span>
      ) : (
        <span>
          <span className="font-medium">Errors</span>
          <span className="text-muted-foreground">
            {' '}
            · {formatNumber(release.events)} events · {formatNumber(release.issues)}{' '}
            {release.issues === 1 ? 'issue' : 'issues'}
            {release.newIssues > 0 ? ` (${formatNumber(release.newIssues)} new)` : ''} ·{' '}
          </span>
          <span className={cn(worse ? 'font-medium text-destructive' : 'text-muted-foreground')}>
            {formatRate(release.perThousandApplies)} per 1,000 applies
          </span>
          <InfoHint label="About the error rate" className="ml-1 inline-flex align-middle">
            <p className="text-xs">
              Error events per 1,000 applies from phones whose native plugin can report errors
              (3.4+), over the last 180 days.
            </p>
          </InfoHint>
          {previous && previous.perThousandApplies !== null ? (
            <span className="text-muted-foreground">
              {' '}
              (was {formatRate(previous.perThousandApplies)} on {previous.bundleVersion})
            </span>
          ) : null}
        </span>
      )}
      <button
        type="button"
        className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={onViewErrors}
      >
        View errors
      </button>
    </section>
  );
}

export function ReleaseHealthDialog({
  appId,
  release,
  onClose,
  onViewErrors,
}: {
  appId: string;
  release: ReleaseHistoryItem;
  onClose: () => void;
  /** Show this release's errors in the Errors section. */
  onViewErrors: () => void;
}) {
  // Same default as the API: young releases open on 24 hours.
  const [range, setRange] = useState<ReleaseTimeseriesRange>(() =>
    Date.now() - Date.parse(release.promotedAt) < YOUNG_RELEASE_MS ? '24h' : '7d',
  );
  const [platform, setPlatform] = useState<Platform>('all');
  const [result, setResult] = useState<{
    key: string;
    data: ReleaseTimeseries | null;
    error: string | null;
  } | null>(null);
  const requestKey = `${range}|${platform}`;
  const loading = result?.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ lane: '1', range });
    if (platform !== 'all') params.set('platform', platform);
    fetch(`/api/v1/apps/${appId}/releases/${release.id}/timeseries?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (ReleaseTimeseries & { error?: string })
          | null;
        if (!response.ok || !body) throw new Error(body?.error ?? 'Could not load health');
        setResult({ key: `${range}|${platform}`, data: body, error: null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult((current) => ({
          key: `${range}|${platform}`,
          data: current?.data ?? null,
          error: cause instanceof Error ? cause.message : 'Could not load health',
        }));
      });
    return () => controller.abort();
  }, [appId, release.id, range, platform]);

  // While a new range or platform loads, the previous result stays on screen.
  const data = result?.data ?? null;
  const error = result?.error ?? null;

  const labels = useMemo(() => (data ? timeLabels(data.granularity, data.range) : null), [data]);
  // Per-bucket counts sit at the middle of their bucket; the running total of
  // applies at its end (from 0 at the start of the range), so a curve never
  // rises before the release that caused it.
  const points = useMemo(() => {
    if (!data) return { perBucket: [], cumulative: [] };
    const bucketMs = data.granularity === 'day' ? DAY_MS : HOUR_MS;
    const from = Date.parse(data.from);
    const perBucket = data.buckets.map((bucket) => {
      const start = Date.parse(bucket.start);
      return { ...bucket, start, end: start + bucketMs, t: start + bucketMs / 2 };
    });
    const cumulative = [
      { start: from - bucketMs, end: from, t: from, appliedTotal: 0, total: true },
      ...perBucket.map((point) => ({ ...point, t: point.end, total: true })),
    ];
    return { perBucket, cumulative };
  }, [data]);
  const lane = useMemo(() => {
    if (!data?.lane) return null;
    const releases = data.lane.releases.filter((item) => item.applied.some((value) => value > 0));
    if (releases.length === 0) return null;
    const config: ChartConfig = {};
    releases.forEach((item, index) => {
      config[item.id] = {
        label: item.id === release.id ? `${item.bundleVersion} (this)` : item.bundleVersion,
        color: LANE_COLORS[index % LANE_COLORS.length],
      };
    });
    const bucketMs = data.granularity === 'day' ? DAY_MS : HOUR_MS;
    const rows = data.buckets.map((bucket, index) => {
      const start = Date.parse(bucket.start);
      return {
        start,
        end: start + bucketMs,
        t: start + bucketMs / 2,
        ...Object.fromEntries(releases.map((item) => [item.id, item.applied[index] ?? 0])),
      };
    });
    return { releases, config, rows };
  }, [data, release.id]);

  const totals = data?.totals;
  const share = totals?.rollbackSharePercent ?? null;
  // Colored only where it compares like with auto-revert: the same 24-hour
  // window and at least the minimum sample. One rollback of two is not 50%.
  const comparable =
    release.autoRevert &&
    data?.range === '24h' &&
    totals !== undefined &&
    totals.applied + totals.rollbacks >= release.autoRevertMinSample;
  const shareTone =
    share === null || !comparable
      ? undefined
      : share >= release.autoRevertRatePercent
        ? 'danger'
        : share >= release.autoRevertRatePercent / 2
          ? 'warning'
          : undefined;
  const empty =
    totals !== undefined &&
    totals.downloads + totals.applied + totals.downloadErrors + totals.rollbacks === 0;
  const domain: [number, number] | undefined = data
    ? [Date.parse(data.from), Date.parse(data.to)]
    : undefined;
  const ticks = data
    ? axisTicks(data.range, Date.parse(data.from), Date.parse(data.to))
    : undefined;
  const markers = data?.markers ?? [];

  const xAxis = labels ? (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={domain}
      ticks={ticks}
      tickFormatter={labels.tick}
      tickLine={false}
      axisLine={false}
      minTickGap={28}
    />
  ) : null;
  const tooltip = labels ? (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) => {
            const point = payload?.[0]?.payload as
              | { start: number; end: number; total?: boolean }
              | undefined;
            if (!point) return '';
            return point.total
              ? labels.total(point.start, point.end)
              : labels.bucket(point.start, point.end);
          }}
        />
      }
    />
  ) : null;
  const markerLines = markers.map((marker) => (
    <ReferenceLine
      key={`${marker.type}-${marker.at}`}
      x={Date.parse(marker.at)}
      stroke={MARKER_COLORS[marker.type]}
      strokeDasharray="3 3"
      // A marker in the current, partial bucket lies just past the last point.
      ifOverflow="extendDomain"
    />
  ));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChartLine className="size-4" />
            Health of {release.bundleVersion}
          </DialogTitle>
          <DialogDescription>
            {release.channel ?? 'base'}
            {release.runtimeVersion ? ` · runtime ${release.runtimeVersion}` : ''}
            {release.revertedAt ? ' · reverted' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Range">
            {RANGES.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={range === item.value}
                onClick={() => setRange(item.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs transition-colors',
                  range === item.value
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {loading && data ? (
              <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
            <Select value={platform} onValueChange={(value) => setPlatform(value as Platform)}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                <SelectItem value="ios">iOS</SelectItem>
                <SelectItem value="android">Android</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-destructive">
            {error}
          </p>
        ) : !data ? (
          <div className="flex justify-center p-12">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data.analyticsAvailable ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Analytics are unavailable right now, so no counts are shown. Try again in a few minutes.
          </p>
        ) : (
          <div className={cn('space-y-5 transition-opacity', loading && 'opacity-60')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Applies" value={formatNumber(data.totals.applied)} />
              <Stat
                label="Rollbacks"
                value={formatNumber(data.totals.rollbacks)}
                tone={shareTone}
              />
              <Stat
                label="Rollback share"
                value={share === null ? '–' : `${share}%`}
                tone={shareTone}
                hint={
                  release.autoRevert
                    ? `Rollbacks ÷ (applies + rollbacks). Auto-revert acts at ≥${release.autoRevertRatePercent}% of ≥${release.autoRevertMinSample} in 24 hours; the color follows that rule on the 24-hour range.`
                    : 'Rollbacks ÷ (applies + rollbacks).'
                }
              />
              <Stat label="Download errors" value={formatNumber(data.totals.downloadErrors)} />
              <Stat label="Downloads" value={formatNumber(data.totals.downloads)} />
            </div>

            <ReleaseErrors appId={appId} releaseId={release.id} onViewErrors={onViewErrors} />

            {empty ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No events in this range.
              </p>
            ) : (
              <>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">Applies, cumulative</h3>
                  <ChartContainer
                    config={{ appliedTotal: { label: 'Applies', color: 'var(--chart-2)' } }}
                    className="mt-2 aspect-auto h-44 w-full"
                  >
                    <AreaChart data={points.cumulative} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} />
                      {xAxis}
                      <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
                      {tooltip}
                      {markerLines}
                      <Area
                        dataKey="appliedTotal"
                        type="monotone"
                        stroke="var(--color-appliedTotal)"
                        fill="var(--color-appliedTotal)"
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ChartContainer>
                  {markers.length > 0 && labels ? (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      {markers.map((marker) => (
                        <li
                          key={`${marker.type}-${marker.at}`}
                          className="flex items-center gap-1.5"
                        >
                          <span
                            className="h-3 w-0 border-l border-dashed"
                            style={{ borderColor: MARKER_COLORS[marker.type] }}
                          />
                          {marker.label} · {labels.at(Date.parse(marker.at))}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>

                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">
                    Rollbacks and download errors per {data.granularity}
                  </h3>
                  <ChartContainer
                    config={{
                      rollbacks: { label: 'Rollbacks', color: 'var(--destructive)' },
                      downloadErrors: { label: 'Download errors', color: '#f59e0b' },
                    }}
                    className="mt-2 aspect-auto h-36 w-full"
                  >
                    <LineChart data={points.perBucket} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} />
                      {xAxis}
                      <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
                      {tooltip}
                      {markerLines}
                      <Line
                        dataKey="rollbacks"
                        type="linear"
                        stroke="var(--color-rollbacks)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        dataKey="downloadErrors"
                        type="linear"
                        stroke="var(--color-downloadErrors)"
                        strokeWidth={2}
                        dot={false}
                      />
                      <ChartLegend content={<ChartLegendContent />} />
                    </LineChart>
                  </ChartContainer>
                </section>
              </>
            )}

            {lane ? (
              <section>
                <h3 className="text-xs font-medium text-muted-foreground">
                  Applies on {data.lane?.channel ?? 'base'} by release
                </h3>
                <ChartContainer config={lane.config} className="mt-2 aspect-auto h-40 w-full">
                  <AreaChart data={lane.rows} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    {xAxis}
                    <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
                    {tooltip}
                    {lane.releases.map((item) => (
                      <Area
                        key={item.id}
                        dataKey={item.id}
                        stackId="lane"
                        type="monotone"
                        stroke={`var(--color-${item.id})`}
                        fill={`var(--color-${item.id})`}
                        fillOpacity={0.35}
                      />
                    ))}
                    <ChartLegend content={<ChartLegendContent />} />
                  </AreaChart>
                </ChartContainer>
              </section>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              Counts are events reported by devices, not unique users.
              {data.lastEventAt ? ` Last event ${relativeTime(data.lastEventAt)}.` : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
