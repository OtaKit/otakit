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
    tooltip: (value: number) =>
      granularity === 'day' ? `${day.format(value)} (UTC)` : dayHour.format(value),
  };
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
    <div className="rounded-lg border bg-muted/20 px-3 py-2" title={hint}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
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
export function ReleaseHealthDialog({
  appId,
  release,
  onClose,
}: {
  appId: string;
  release: ReleaseHistoryItem;
  onClose: () => void;
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
  const points = useMemo(
    () => (data?.buckets ?? []).map((bucket) => ({ ...bucket, t: Date.parse(bucket.start) })),
    [data],
  );
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
    const rows = data.buckets.map((bucket, index) => ({
      t: Date.parse(bucket.start),
      ...Object.fromEntries(releases.map((item) => [item.id, item.applied[index] ?? 0])),
    }));
    return { releases, config, rows };
  }, [data, release.id]);

  const totals = data?.totals;
  const share = totals?.rollbackSharePercent ?? null;
  const shareTone =
    share === null || !release.autoRevert
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
    ? [
        Date.parse(data.from),
        Date.parse(data.to) - (data.granularity === 'day' ? 86_400_000 : 3_600_000),
      ]
    : undefined;
  const markers = data?.markers ?? [];

  const xAxis = labels ? (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={domain}
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
          labelFormatter={(_, payload) => labels.tooltip(Number(payload?.[0]?.payload?.t))}
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
                tone={data.totals.rollbacks > 0 ? 'danger' : undefined}
              />
              <Stat
                label="Rollback share"
                value={share === null ? '–' : `${share}%`}
                tone={shareTone}
                hint={
                  release.autoRevert
                    ? `Rollbacks ÷ (applies + rollbacks). Auto-revert at ≥${release.autoRevertRatePercent}% of ≥${release.autoRevertMinSample} in 24 hours.`
                    : 'Rollbacks ÷ (applies + rollbacks).'
                }
              />
              <Stat
                label="Download errors"
                value={formatNumber(data.totals.downloadErrors)}
                tone={data.totals.downloadErrors > 0 ? 'warning' : undefined}
              />
              <Stat label="Downloads" value={formatNumber(data.totals.downloads)} />
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
                    config={{ appliedTotal: { label: 'Applies', color: 'var(--chart-2)' } }}
                    className="mt-2 aspect-auto h-44 w-full"
                  >
                    <AreaChart data={points} margin={{ left: 0, right: 8, top: 8 }}>
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
                          {marker.label} · {labels.tooltip(Date.parse(marker.at))}
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
                      downloadErrors: { label: 'Download errors', color: 'var(--chart-4)' },
                    }}
                    className="mt-2 aspect-auto h-36 w-full"
                  >
                    <LineChart data={points} margin={{ left: 0, right: 8, top: 8 }}>
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
