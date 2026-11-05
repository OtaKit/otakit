'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  Tooltip as ChartHoverTooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';

import { InfoHint } from '@/app/components/InfoHint';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  EVENT_ACTIVITY_RANGES,
  OTHER_SEGMENT_KEY,
  type EventActivity,
  type EventActivityMarker,
  type EventActivitySegment,
  type EventActivitySplit,
} from '@/lib/event-activity-types';
import { cn } from '@/lib/utils';

export type ActivityWindow = { start: number; end: number };

const SPLIT_OPTIONS: Array<{ value: EventActivitySplit; label: string }> = [
  { value: 'action', label: 'Action' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'channel', label: 'Channel' },
  { value: 'platform', label: 'Platform' },
  { value: 'runtime', label: 'Runtime' },
];

/** Outcome colors, the same wherever an action is shown. */
const ACTION_COLORS: Record<string, string> = {
  downloaded: '#3b82f6',
  applied: '#10b981',
  download_error: '#f59e0b',
  check_error: '#a1a1aa',
  rollback: '#ef4444',
};
/** Other splits: by size, largest first; "Other" stays grey. */
const SEGMENT_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'];
const OTHER_COLOR = '#a1a1aa';

const MARKER_COLORS: Record<EventActivityMarker['type'], string> = {
  released: 'var(--foreground)',
  rollout: '#8b5cf6',
  reverted: '#f59e0b',
  auto_reverted: '#ef4444',
};

// The plot sits between the y-axis and a small right margin; the marker flags
// above it use the same insets so they line up with their lines.
const Y_AXIS_WIDTH = 40;
const RIGHT_MARGIN = 8;
/** Space kept between two flags, and the room an x-axis label needs (px). */
const FLAG_GAP = 6;
const TICK_SPACING = 72;
/** Width used before the plot has been measured. */
const FALLBACK_PLOT_WIDTH = 1000;

const fullNumber = new Intl.NumberFormat('en-US');
const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function segmentColor(splitBy: EventActivitySplit, segment: EventActivitySegment, index: number) {
  if (segment.key === OTHER_SEGMENT_KEY) return OTHER_COLOR;
  if (splitBy === 'action') return ACTION_COLORS[segment.key] ?? OTHER_COLOR;
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
}

/** Labels on the viewer's clock; nothing in the current bucket is labeled past now. */
function timeFormats(range: EventActivity['range'], now: number) {
  const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const hour = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayTime = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return {
    tick: (value: number) =>
      range === '1h'
        ? time.format(value)
        : range === '24h'
          ? hour.format(value)
          : day.format(value),
    bucket: (start: number, end: number) => {
      const label =
        range === '30d'
          ? weekday.format(start)
          : range === '1h'
            ? dayTime.format(start)
            : `${dayTime.format(start)} – ${time.format(end)}`;
      return end > now ? `${label}, so far` : label;
    },
    window: (start: number, end: number) =>
      range === '30d'
        ? weekday.format(start)
        : range === '1h'
          ? dayTime.format(start)
          : `${dayTime.format(start)} – ${time.format(end)}`,
    at: (value: number) => dayTime.format(value),
  };
}

/** Every 10 minutes, every third hour, every midnight, or every fifth day back from today. */
function axisTicks(range: EventActivity['range'], from: number, to: number): number[] {
  const ticks: number[] = [];
  const next = new Date(from);
  if (range === '30d') {
    for (let day = to - EVENT_ACTIVITY_RANGES['30d'].bucketMs; day >= from; ) {
      ticks.unshift(day);
      const previous = new Date(day);
      previous.setDate(previous.getDate() - 5);
      day = previous.getTime();
    }
    return ticks;
  }
  if (range === '7d') {
    next.setHours(24, 0, 0, 0);
    for (; next.getTime() < to; next.setDate(next.getDate() + 1)) ticks.push(next.getTime());
    return ticks;
  }
  const stepMinutes = range === '1h' ? 10 : 180;
  next.setSeconds(0, 0);
  if (range === '24h') next.setMinutes(0);
  while (
    next.getTime() < from ||
    (range === '1h' ? next.getMinutes() % 10 !== 0 : next.getHours() % 3 !== 0)
  ) {
    next.setMinutes(next.getMinutes() + (range === '1h' ? 1 : 60));
  }
  for (; next.getTime() < to; next.setMinutes(next.getMinutes() + stepMinutes)) {
    ticks.push(next.getTime());
  }
  return ticks;
}

type Row = {
  x: number;
  start: number;
  end: number;
  total: number;
  inProgress: boolean;
} & Record<`s${number}`, number>;

type MarkerCluster = { at: number; share: number; markers: EventActivityMarker[] };

/** A marker flag's width: dot, padding and monospace label (10px, about 6.2px a character). */
function flagWidth(version: string, count: number): number {
  const label = count > 1 ? `${version} +${count - 1}` : version;
  return Math.min(144, 22 + label.length * 6.2);
}

/**
 * One flag per marker, merged left to right while flags would touch. A merged
 * flag sits at its newest marker and names it; the tooltip lists them all.
 */
function clusterMarkers(
  markers: EventActivityMarker[],
  from: number,
  to: number,
  plotWidth: number,
) {
  const clusters: MarkerCluster[] = [];
  for (const marker of markers) {
    const at = Date.parse(marker.at);
    const share = (at - from) / (to - from);
    const last = clusters.at(-1);
    if (last) {
      const lastNewest = last.markers.at(-1)!;
      const room =
        flagWidth(lastNewest.bundleVersion, last.markers.length) / 2 +
        flagWidth(marker.bundleVersion, 1) / 2 +
        FLAG_GAP;
      if ((share - last.share) * plotWidth < room) {
        last.markers.push(marker);
        last.at = at;
        last.share = share;
        continue;
      }
    }
    clusters.push({ at, share, markers: [marker] });
  }
  return clusters;
}

/** Round y-axis steps (1, 2, 2.5 or 5 times a power of ten), at most five of them. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  for (let exponent = Math.floor(Math.log10(max / 5)); ; exponent += 1) {
    for (const multiple of [1, 2, 2.5, 5]) {
      const step = multiple * 10 ** exponent;
      if (step < 1 || !Number.isInteger(step) || max / step > 5) continue;
      const top = Math.ceil(max / step) * step;
      return Array.from({ length: top / step + 1 }, (_, index) => index * step);
    }
  }
}

function Stat({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {color ? (
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
        ) : null}
        {label}
        {hint ? (
          <InfoHint label={`About ${label.toLowerCase()}`}>
            <p className="text-xs">{hint}</p>
          </InfoHint>
        ) : null}
      </dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Device activity over time, above the event list and under its filters:
 * stacked bars split by one dimension, with release markers. Clicking a bar
 * lists that bucket's events; clicking a legend entry filters to it.
 */
export function EventActivityChart({
  activity,
  loading,
  splitBy,
  onSplitByChange,
  selected,
  onSelect,
  canFilter,
  isFiltered,
  onFilterSegment,
}: {
  activity: EventActivity;
  loading: boolean;
  splitBy: EventActivitySplit;
  onSplitByChange: (split: EventActivitySplit) => void;
  selected: ActivityWindow | null;
  onSelect: (window: ActivityWindow | null) => void;
  canFilter: (segment: EventActivitySegment) => boolean;
  isFiltered: (segment: EventActivitySegment) => boolean;
  onFilterSegment: (segment: EventActivitySegment) => void;
}) {
  const from = Date.parse(activity.from);
  const to = Date.parse(activity.to);
  const now = Date.parse(activity.asOf);
  const { bucketMs, segments, totals } = activity;
  const formats = useMemo(() => timeFormats(activity.range, now), [activity.range, now]);
  // The plot's width, for flags that must not overlap and labels that must fit.
  const overlay = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setMeasuredWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const plotWidth = measuredWidth || FALLBACK_PLOT_WIDTH;
  const ticks = useMemo(() => {
    const all = axisTicks(activity.range, from, to);
    // Keep every nth label when they would not fit, so the gaps stay even.
    const every = Math.ceil(all.length / Math.max(2, Math.floor(plotWidth / TICK_SPACING)));
    return every > 1 ? all.filter((_, index) => index % every === 0) : all;
  }, [activity.range, from, to, plotWidth]);
  const colors = segments.map((segment, index) => segmentColor(activity.splitBy, segment, index));

  const rows = useMemo<Row[]>(
    () =>
      activity.buckets.map((bucket) => {
        const start = Date.parse(bucket.start);
        const row = {
          x: start + bucketMs / 2,
          start,
          end: start + bucketMs,
          total: bucket.total,
          inProgress: start + bucketMs > now,
        } as Row;
        bucket.counts.forEach((count, index) => {
          row[`s${index}`] = count;
        });
        return row;
      }),
    [activity.buckets, bucketMs, now],
  );
  const clusters = useMemo(
    () => clusterMarkers(activity.markers, from, to, plotWidth),
    [activity.markers, from, to, plotWidth],
  );
  const yTicks = useMemo(
    () => niceTicks(Math.max(0, ...activity.buckets.map((bucket) => bucket.total))),
    [activity.buckets],
  );
  const config: ChartConfig = Object.fromEntries(
    segments.map((segment, index) => [`s${index}`, { label: segment.label, color: colors[index] }]),
  );

  const actionColor = (action: string) =>
    activity.splitBy === 'action' ? ACTION_COLORS[action] : undefined;
  const isSelected = (row: Row) => selected !== null && row.start === selected.start;
  const barOpacity = (row: Row) =>
    selected !== null && !isSelected(row) ? 0.3 : row.inProgress ? 0.55 : 1;

  const tooltip = ({ active, payload }: TooltipProps<number, string>) => {
    const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
    if (!row) return null;
    return (
      <div className="min-w-44 rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
        <p className="font-medium">{formats.bucket(row.start, row.end)}</p>
        <div className="mt-1.5 space-y-1">
          {segments.map((segment, index) =>
            row[`s${index}`] > 0 ? (
              <div key={segment.key} className="flex items-center justify-between gap-4">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: colors[index] }}
                  />
                  <span className="truncate">{segment.label}</span>
                </span>
                <span className="font-medium tabular-nums">
                  {fullNumber.format(row[`s${index}`])}
                </span>
              </div>
            ) : null,
          )}
          {row.total === 0 ? <p className="text-muted-foreground">No events</p> : null}
        </div>
        {segments.filter((_, index) => row[`s${index}`] > 0).length > 1 ? (
          <div className="mt-1.5 flex justify-between border-t pt-1.5">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium tabular-nums">{fullNumber.format(row.total)}</span>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className={cn(
          'border-b border-border bg-background px-6 pb-4 pt-5',
          loading && 'opacity-60',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
            <Stat
              label="Downloads"
              value={fullNumber.format(totals.downloads)}
              color={actionColor('downloaded')}
            />
            <Stat
              label="Applies"
              value={fullNumber.format(totals.applied)}
              color={actionColor('applied')}
            />
            <Stat
              label="Download errors"
              value={fullNumber.format(totals.downloadErrors)}
              color={actionColor('download_error')}
            />
            <Stat
              label="Check errors"
              value={fullNumber.format(totals.checkErrors)}
              color={actionColor('check_error')}
            />
            <Stat
              label="Rollbacks"
              value={fullNumber.format(totals.rollbacks)}
              color={actionColor('rollback')}
            />
            <Stat
              label="Rollback share"
              value={totals.rollbackSharePercent === null ? '–' : `${totals.rollbackSharePercent}%`}
              hint="Rollbacks ÷ (applies + rollbacks): the rate auto-revert watches."
            />
          </dl>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Split by
            <Select
              value={splitBy}
              onValueChange={(value) => onSplitByChange(value as EventActivitySplit)}
            >
              <SelectTrigger
                className="h-8 w-32 text-xs text-foreground"
                aria-label="Split bars by"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPLIT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="relative mt-4">
          {/* Release markers: one flag per release, rollout step or revert, or one per cluster. */}
          <div
            ref={overlay}
            className="pointer-events-none absolute top-0 z-10 h-5"
            style={{ left: Y_AXIS_WIDTH, right: RIGHT_MARGIN }}
          >
            {clusters.map((cluster, clusterIndex) => {
              const newest = cluster.markers.at(-1)!;
              const edge =
                cluster.share < 0.06
                  ? 'translate-x-0'
                  : cluster.share > 0.94
                    ? '-translate-x-full'
                    : '-translate-x-1/2';
              return (
                <Tooltip key={`${clusterIndex}-${cluster.at}`}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'pointer-events-auto absolute top-0 flex h-5 max-w-36 items-center gap-1 rounded-full border bg-background px-1.5 font-mono text-[10px] leading-none text-foreground shadow-xs',
                        edge,
                      )}
                      style={{ left: `${cluster.share * 100}%` }}
                      aria-label={`${cluster.markers.length} release event${cluster.markers.length === 1 ? '' : 's'}`}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: MARKER_COLORS[newest.type] }}
                      />
                      <span className="truncate">{newest.bundleVersion}</span>
                      {cluster.markers.length > 1 ? (
                        <span className="text-muted-foreground">+{cluster.markers.length - 1}</span>
                      ) : null}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-72 text-left">
                    <ul className="space-y-1">
                      {cluster.markers.map((marker, markerIndex) => (
                        <li key={markerIndex}>
                          <span className="font-medium">
                            {marker.bundleVersion} · {marker.channel ?? 'base'}
                            {marker.runtimeVersion ? ` · ${marker.runtimeVersion}` : ''}
                          </span>
                          <br />
                          {marker.label}, {formats.at(Date.parse(marker.at))}
                        </li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          <ChartContainer
            config={config}
            className="aspect-auto h-48 w-full [&_.recharts-wrapper]:cursor-pointer"
          >
            <BarChart
              data={rows}
              margin={{ top: 26, right: RIGHT_MARGIN, bottom: 0, left: 0 }}
              barCategoryGap="12%"
              onClick={(state) => {
                const row = state?.activePayload?.[0]?.payload as Row | undefined;
                if (!row || row.total === 0) return;
                onSelect(isSelected(row) ? null : { start: row.start, end: row.end });
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[from, to]}
                ticks={ticks}
                interval={0}
                tickFormatter={formats.tick}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                fontSize={11}
                allowDataOverflow
              />
              <YAxis
                width={Y_AXIS_WIDTH}
                allowDecimals={false}
                tickFormatter={(value: number) => compactNumber.format(value)}
                tickLine={false}
                axisLine={false}
                domain={[0, yTicks.at(-1) ?? 1]}
                ticks={yTicks}
                interval={0}
                fontSize={11}
              />
              <ChartHoverTooltip
                content={tooltip}
                cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                isAnimationActive={false}
              />
              {activity.markers.map((marker, markerIndex) => (
                <ReferenceLine
                  key={markerIndex}
                  x={Date.parse(marker.at)}
                  stroke={MARKER_COLORS[marker.type]}
                  strokeOpacity={marker.type === 'released' ? 0.45 : 0.8}
                  strokeDasharray="3 3"
                  ifOverflow="hidden"
                />
              ))}
              {segments.map((segment, index) => (
                <Bar
                  key={segment.key}
                  dataKey={`s${index}`}
                  stackId="activity"
                  fill={colors[index]}
                  isAnimationActive={false}
                >
                  {rows.map((row) => (
                    <Cell key={row.start} fillOpacity={barOpacity(row)} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ChartContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pl-10">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            {segments.map((segment, index) => {
              const filterable = canFilter(segment);
              const filtered = isFiltered(segment);
              const content = (
                <>
                  <span
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: colors[index] }}
                  />
                  <span
                    className={cn(
                      'truncate',
                      filtered ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {segment.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground/70">
                    {compactNumber.format(segment.total)}
                  </span>
                </>
              );
              return (
                <li key={segment.key} className="min-w-0">
                  {filterable ? (
                    <button
                      type="button"
                      onClick={() => onFilterSegment(segment)}
                      title={filtered ? 'Show all again' : `Show only ${segment.label}`}
                      className="flex max-w-48 items-center gap-1.5 rounded-sm hover:[&>span:nth-child(2)]:text-foreground"
                    >
                      {content}
                    </button>
                  ) : (
                    <span className="flex max-w-48 items-center gap-1.5">{content}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {selected ? (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1.5 text-xs text-foreground hover:bg-muted"
              title="Show the whole range again"
            >
              Events {formats.window(selected.start, selected.end)}
              <X className="size-3 text-muted-foreground" />
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {EVENT_ACTIVITY_RANGES[activity.range].bucketLabel} · click a bar to list its events
            </p>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
