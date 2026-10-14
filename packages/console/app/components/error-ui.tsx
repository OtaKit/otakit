'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import type { ErrorIssueStatusValue } from '@/lib/error-tracking';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { cn } from '@/lib/utils';

/** Pieces shared by the Errors and Analytics sections and their dialogs. */

/** A time range with its bucket size, as the errors and analytics APIs return it. */
export type BucketRange = { from: string; to: string; bucket: 'hour' | 'day' };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Every bucket of the range, zero where there were no events. */
export function trendBuckets(
  trend: Array<{ start: string; events: number }>,
  range: BucketRange,
): Array<{ start: number; events: number }> {
  const bucketMs = range.bucket === 'hour' ? HOUR_MS : DAY_MS;
  const to = Date.parse(range.to);
  const from = Math.floor(Date.parse(range.from) / bucketMs) * bucketMs;
  const counts = new Map(trend.map((bucket) => [Date.parse(bucket.start), bucket.events]));
  const buckets: Array<{ start: number; events: number }> = [];
  for (let start = from; start < to; start += bucketMs) {
    buckets.push({ start, events: counts.get(start) ?? 0 });
  }
  return buckets;
}

export function Sparkline({
  trend,
  range,
  className,
}: {
  trend: Array<{ start: string; events: number }>;
  range: BucketRange;
  className?: string;
}) {
  const values = trendBuckets(trend, range).map((bucket) => bucket.events);
  const max = Math.max(1, ...values);
  const width = 96;
  const height = 24;
  const step = width / Math.max(values.length, 1);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-6 w-24 text-rose-500/80', className)}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {values.map((value, index) =>
        value > 0 ? (
          <rect
            key={index}
            x={index * step + step * 0.15}
            width={Math.max(step * 0.7, 0.8)}
            y={height - Math.max((value / max) * height, 1.5)}
            height={Math.max((value / max) * height, 1.5)}
            rx={0.5}
            fill="currentColor"
          />
        ) : null,
      )}
    </svg>
  );
}

export function StatusBadge({ status }: { status: ErrorIssueStatusValue }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 px-1.5 text-[10px] font-medium',
        status === 'open' && 'border-rose-500/30 text-rose-700 dark:text-rose-300',
        status === 'resolved' && 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
        status === 'ignored' && 'text-muted-foreground',
      )}
    >
      {status === 'open' ? 'Open' : status === 'resolved' ? 'Resolved' : 'Ignored'}
    </Badge>
  );
}

/** Events per hour (24 hours) or UTC day, with a time axis and a tooltip. */
export function TrendChart({
  trend,
  range,
  color = '#f43f5e',
}: {
  trend: Array<{ start: string; events: number }>;
  range: BucketRange;
  color?: string;
}) {
  const hourly = range.bucket === 'hour';
  const tick = new Intl.DateTimeFormat(
    'en-US',
    hourly
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', timeZone: 'UTC' },
  );
  const label = new Intl.DateTimeFormat(
    'en-US',
    hourly
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', timeZone: 'UTC' },
  );
  const data = trendBuckets(trend, range);
  return (
    <ChartContainer
      config={{ events: { label: 'Events', color } }}
      className="aspect-auto h-28 w-full"
    >
      <BarChart data={data} margin={{ left: 0, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="start"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={(value: number) => tick.format(value)}
        />
        <YAxis width={32} tickLine={false} axisLine={false} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const start = payload?.[0]?.payload?.start as number | undefined;
                return start === undefined ? '' : `${label.format(start)}${hourly ? '' : ' (UTC)'}`;
              }}
            />
          }
        />
        <Bar dataKey="events" fill="var(--color-events)" radius={2} maxBarSize={24} />
      </BarChart>
    </ChartContainer>
  );
}

/** A change in percent, green up and red down; a dash without a base. */
export function ChangeBadge({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-muted-foreground">–</span>;
  return (
    <span
      className={cn(
        'tabular-nums',
        percent > 0 && 'text-emerald-700 dark:text-emerald-400',
        percent < 0 && 'text-rose-700 dark:text-rose-400',
        percent === 0 && 'text-muted-foreground',
      )}
    >
      {percent > 0 ? '+' : ''}
      {percent}%
    </span>
  );
}
