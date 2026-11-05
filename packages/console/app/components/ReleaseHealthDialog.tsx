'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChartLine, LoaderCircle, RotateCw } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import type { ReleaseHistoryItem } from '@/app/components/dashboard-types';
import { InfoHint } from '@/app/components/InfoHint';
import { shouldAutoRevert } from '@/lib/auto-revert-rule';
import type {
  ReleaseTimeseries,
  ReleaseTimeseriesMarker,
  ReleaseTimeseriesRange,
} from '@/lib/services/release-timeseries';
import { Button } from '@/components/ui/button';
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

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The viewed release keeps the color of its own applies chart. */
const THIS_RELEASE_COLOR = 'var(--chart-2)';
// Other releases of the lane: distinct in light and dark themes, none close to
// the viewed release's color.
const LANE_COLORS = [
  '#0ea5e9',
  '#8b5cf6',
  '#f59e0b',
  '#f43f5e',
  '#64748b',
  '#6366f1',
  '#f97316',
  '#d946ef',
  '#a3a3a3',
];

const MARKER_COLORS: Record<ReleaseTimeseriesMarker['type'], string> = {
  released: 'var(--chart-2)',
  rollout: 'var(--chart-3)',
  reverted: 'var(--chart-4)',
  auto_reverted: 'var(--destructive)',
};

type Platform = 'all' | 'ios' | 'android';

const fullNumber = new Intl.NumberFormat('en-US');
// Axis labels stay short at any size: 950, 28K, 7.1M.
const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function relativeTime(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * Axis and tooltip labels: hours in the viewer's time zone, days as UTC dates.
 * Nothing is labeled later than `now`: the last bucket is still in progress.
 */
function timeLabels(range: ReleaseTimeseriesRange, now: number) {
  const utcDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const localDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayTime = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const daily = range === '30d';
  return {
    tick: (value: number) =>
      daily ? utcDay.format(value) : range === '24h' ? hour.format(value) : localDay.format(value),
    /** One bucket: "Oct 10, 10:00 AM – 11:00 AM", or "Oct 10 (UTC)". */
    bucket: (start: number, end: number) => {
      const label = daily
        ? `${utcDay.format(start)} (UTC)`
        : `${dayTime.format(start)} – ${time.format(end)}`;
      return end > now ? `${label}, so far` : label;
    },
    /** A moment, such as a marker: "Oct 10, 10:32 AM". */
    at: (value: number) => dayTime.format(value),
    /** The running total at the end of a bucket, or now for the current one. */
    total: (start: number, end: number) =>
      end > now
        ? `By ${dayTime.format(now)}`
        : daily
          ? `Through ${utcDay.format(start)} (UTC)`
          : `By ${dayTime.format(end)}`,
  };
}

/**
 * Ticks shared by every chart, so the charts line up, and never later than
 * now: every third local hour for 24 hours, local midnights for 7 days, and
 * every fifth UTC day back from today for 30 days.
 */
function axisTicks(range: ReleaseTimeseriesRange, from: number, now: number): number[] {
  const ticks: number[] = [];
  if (range === '30d') {
    for (let day = now - (now % DAY_MS); day >= from; day -= 5 * DAY_MS) ticks.unshift(day);
    return ticks;
  }
  const next = new Date(from);
  if (range === '7d') {
    next.setHours(24, 0, 0, 0);
  } else {
    next.setMinutes(0, 0, 0);
    if (next.getTime() < from) next.setHours(next.getHours() + 1);
    while (next.getHours() % 3 !== 0) next.setHours(next.getHours() + 1);
  }
  for (; next.getTime() <= now; next.setHours(next.getHours() + (range === '7d' ? 24 : 3))) {
    ticks.push(next.getTime());
  }
  return ticks;
}

function Stat({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: string;
  value: string;
  tone?: 'warning' | 'danger';
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border bg-muted/20 px-3 py-2', className)}>
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

function Notice({
  children,
  onRetry,
  retrying,
}: {
  children: ReactNode;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        <RotateCw className={cn('size-3.5', retrying && 'animate-spin')} />
        Try again
      </Button>
    </div>
  );
}

/**
 * How a release spreads and how healthy it is over time, plus the lane's
 * releases replacing each other. Loaded on demand from the release menu.
 */
export function ReleaseHealthDialog({
  appId,
  release,
  onClose,
}: {
  appId: string;
  release: ReleaseHistoryItem;
  onClose: () => void;
}) {
  // No range until one is picked: the API chooses the default (24 hours for a
  // young release, otherwise 7 days) and the result says which it chose.
  const [range, setRange] = useState<ReleaseTimeseriesRange | null>(null);
  const [platform, setPlatform] = useState<Platform>('all');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: ReleaseTimeseries | null;
    error: string | null;
  } | null>(null);
  const requestKey = `${range}|${platform}|${attempt}`;
  const loading = result?.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${range}|${platform}|${attempt}`;
    const params = new URLSearchParams({ lane: '1' });
    if (range) params.set('range', range);
    if (platform !== 'all') params.set('platform', platform);
    fetch(`/api/v1/apps/${appId}/releases/${release.id}/timeseries?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (ReleaseTimeseries & { error?: string })
          | null;
        if (!response.ok || !body) throw new Error(body?.error ?? 'Could not load health');
        setResult({ key, data: body, error: null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        // The last result is kept for a retry to fade over, and for the range
        // it was shown with.
        setResult((current) => ({
          key,
          data: current?.data ?? null,
          error: cause instanceof Error ? cause.message : 'Could not load health',
        }));
      });
    return () => controller.abort();
  }, [appId, release.id, range, platform, attempt]);

  // While a new range or platform loads, the previous result stays on screen.
  const data = result?.data ?? null;
  const error = result?.error ?? null;
  const shownRange = range ?? data?.range ?? null;
  const retry = () => setAttempt((value) => value + 1);

  const charts = useMemo(() => {
    if (!data) return null;
    const bucketMs = data.granularity === 'day' ? DAY_MS : HOUR_MS;
    const from = Date.parse(data.from);
    const to = Date.parse(data.to);
    // The server's time, not this device's, which may be off: the buckets are
    // the server's. Clamped into the last bucket, where it always falls.
    const now = Math.min(Math.max(Date.parse(data.asOf), to - bucketMs), to);
    // Per-bucket counts sit at the middle of the part of their bucket that has
    // passed; the running total of applies at its end (from 0 at the start of
    // the range), so a curve never rises before the release that caused it.
    const perBucket = data.buckets.map((bucket) => {
      const start = Date.parse(bucket.start);
      const end = start + bucketMs;
      return { ...bucket, start, end, t: start + (Math.min(end, now) - start) / 2 };
    });
    const cumulative = [
      { start: from - bucketMs, end: from, t: from, appliedTotal: 0, total: true },
      ...perBucket.map((point) => ({ ...point, t: Math.min(point.end, now), total: true })),
    ];
    const current = perBucket.at(-1);
    return {
      perBucket,
      cumulative,
      domain: [from, to] as [number, number],
      ticks: axisTicks(data.range, from, now),
      labels: timeLabels(data.range, now),
      // The last bucket is still filling up; it is shaded so its lower count
      // does not read as a drop.
      inProgress: current && current.end > now ? { from: current.start, to } : null,
      now,
    };
  }, [data]);

  const lane = useMemo(() => {
    if (!data?.lane || !charts) return null;
    // Colors follow the lane order, so a release keeps its color in this dialog.
    const colors = new Map<string, string>();
    let next = 0;
    for (const item of data.lane.releases) {
      colors.set(
        item.id,
        item.id === release.id ? THIS_RELEASE_COLOR : LANE_COLORS[next++ % LANE_COLORS.length],
      );
    }
    const releases = data.lane.releases.filter((item) => item.applied.some((value) => value > 0));
    if (releases.length === 0) return null;
    const config: ChartConfig = {};
    for (const item of releases) {
      config[item.id] = {
        label: item.id === release.id ? `${item.bundleVersion} (this)` : item.bundleVersion,
        color: colors.get(item.id),
      };
    }
    const rows = charts.perBucket.map((point, index) => ({
      start: point.start,
      end: point.end,
      t: point.t,
      ...Object.fromEntries(releases.map((item) => [item.id, item.applied[index] ?? 0])),
    }));
    return { releases, config, rows };
  }, [data, charts, release.id]);

  const totals = data?.totals;
  const share = totals?.rollbackSharePercent ?? null;
  // Colored only where it compares like with auto-revert: all platforms, the
  // 24-hour range and the same integer rule, minimum sample included. One
  // rollback of two is not 50%.
  const comparable =
    release.autoRevert && data?.range === '24h' && data.platform === null && totals !== undefined;
  const thresholds = {
    ratePercent: release.autoRevertRatePercent,
    minSample: release.autoRevertMinSample,
  };
  const shareTone = !comparable
    ? undefined
    : shouldAutoRevert(totals, thresholds)
      ? 'danger'
      : shouldAutoRevert(totals, { ...thresholds, ratePercent: thresholds.ratePercent / 2 })
        ? 'warning'
        : undefined;
  const empty =
    totals !== undefined &&
    totals.downloads + totals.applied + totals.downloadErrors + totals.rollbacks === 0;
  const markers = data?.markers ?? [];

  const xAxis = charts ? (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={charts.domain}
      ticks={charts.ticks}
      tickFormatter={charts.labels.tick}
      tickLine={false}
      axisLine={false}
      minTickGap={20}
    />
  ) : null;
  const yAxis = (
    <YAxis
      width={40}
      tickLine={false}
      axisLine={false}
      allowDecimals={false}
      tickFormatter={(value: number) => compactNumber.format(value)}
    />
  );
  const tooltip = charts ? (
    <ChartTooltip
      content={
        <ChartTooltipContent
          labelFormatter={(_, payload) => {
            const point = payload?.[0]?.payload as
              | { start: number; end: number; total?: boolean }
              | undefined;
            if (!point) return '';
            return point.total
              ? charts.labels.total(point.start, point.end)
              : charts.labels.bucket(point.start, point.end);
          }}
        />
      }
    />
  ) : null;
  const inProgress = charts?.inProgress ? (
    <ReferenceArea
      x1={charts.inProgress.from}
      x2={charts.inProgress.to}
      fill="var(--muted-foreground)"
      fillOpacity={0.08}
      ifOverflow="hidden"
    />
  ) : null;
  const markerLines = markers.map((marker) => (
    <ReferenceLine
      key={`${marker.type}-${marker.at}`}
      x={Date.parse(marker.at)}
      stroke={MARKER_COLORS[marker.type]}
      strokeDasharray="3 3"
    />
  ));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="text-left">
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
                aria-pressed={shownRange === item.value}
                onClick={() => {
                  if (item.value !== shownRange) setRange(item.value);
                }}
                className={cn(
                  'rounded px-2.5 py-1 text-xs transition-colors',
                  shownRange === item.value
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

        {error && !loading ? (
          <Notice onRetry={retry} retrying={false}>
            <p className="text-destructive">{error}</p>
          </Notice>
        ) : !data || !charts ? (
          <div className="flex justify-center p-12">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data.analyticsAvailable ? (
          <Notice onRetry={retry} retrying={loading}>
            <p>Analytics are unavailable right now, so no counts are shown.</p>
          </Notice>
        ) : (
          <div className={cn('space-y-5 transition-opacity', loading && 'opacity-60')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Applies" value={fullNumber.format(data.totals.applied)} />
              <Stat
                label="Rollbacks"
                value={fullNumber.format(data.totals.rollbacks)}
                tone={shareTone}
              />
              <Stat
                label="Rollback share"
                value={share === null ? '–' : `${share}%`}
                tone={shareTone}
                hint={
                  release.autoRevert
                    ? `Rollbacks ÷ (applies + rollbacks). Auto-revert acts at ≥${release.autoRevertRatePercent}% of ≥${release.autoRevertMinSample} over a rolling 24 hours. On the 24-hour range for all platforms, the color shows how close this release is; the range starts on the hour, so it is a guide, not auto-revert's own count.`
                    : 'Rollbacks ÷ (applies + rollbacks).'
                }
              />
              <Stat label="Download errors" value={fullNumber.format(data.totals.downloadErrors)} />
              <Stat
                label="Downloads"
                value={fullNumber.format(data.totals.downloads)}
                className="col-span-2 sm:col-span-1"
              />
            </div>

            {empty ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No events in this range.
              </p>
            ) : (
              <>
                <section>
                  <h3 className="text-xs font-medium text-muted-foreground">Applies, cumulative</h3>
                  <ChartContainer
                    config={{ appliedTotal: { label: 'Applies', color: THIS_RELEASE_COLOR } }}
                    className="mt-2 aspect-auto h-44 w-full"
                  >
                    <AreaChart data={charts.cumulative} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} />
                      {xAxis}
                      {yAxis}
                      {tooltip}
                      {inProgress}
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
                  {markers.length > 0 ? (
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
                          {marker.label} · {charts.labels.at(Date.parse(marker.at))}
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
                    <LineChart data={charts.perBucket} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} />
                      {xAxis}
                      {yAxis}
                      {tooltip}
                      {inProgress}
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
                  Applies on {data.lane?.channel ?? 'base'} by release, per {data.granularity}
                </h3>
                <ChartContainer config={lane.config} className="mt-2 aspect-auto h-40 w-full">
                  <AreaChart data={lane.rows} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    {xAxis}
                    {yAxis}
                    {tooltip}
                    {inProgress}
                    {lane.releases.map((item) => (
                      // No outline: in a stack, a release without applies would
                      // draw its line along the top of the others.
                      <Area
                        key={item.id}
                        dataKey={item.id}
                        stackId="lane"
                        type="monotone"
                        stroke="none"
                        fill={`var(--color-${item.id})`}
                        fillOpacity={item.id === release.id ? 0.75 : 0.5}
                      />
                    ))}
                    <ChartLegend content={<ChartLegendContent />} />
                  </AreaChart>
                </ChartContainer>
              </section>
            ) : null}

            <p className="text-[11px] text-muted-foreground">
              Counts are events reported by devices, not unique users.
              {/* Only when a chart shows the shading. */}
              {charts.inProgress && (!empty || lane)
                ? ` The shaded ${data.granularity} is still in progress.`
                : ''}
              {data.lastEventAt ? ` Last event ${relativeTime(data.lastEventAt, charts.now)}.` : ''}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
