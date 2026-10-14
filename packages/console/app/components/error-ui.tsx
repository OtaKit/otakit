'use client';

import type { ErrorIssueStatusValue } from '@/lib/error-tracking';
import type { ErrorIssueList } from '@/lib/services/error-issues';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Pieces shared by the Errors section and the issue dialog. */

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

/** Bars for every bucket of the range, zero where there were no events. */
export function Sparkline({
  trend,
  range,
  className,
}: {
  trend: Array<{ start: string; events: number }>;
  range: ErrorIssueList['range'];
  className?: string;
}) {
  const bucketMs = range.bucket === 'hour' ? HOUR_MS : DAY_MS;
  const to = Date.parse(range.to);
  const from = Math.floor(Date.parse(range.from) / bucketMs) * bucketMs;
  const counts = new Map(trend.map((bucket) => [Date.parse(bucket.start), bucket.events]));
  const values: number[] = [];
  for (let start = from; start < to; start += bucketMs) values.push(counts.get(start) ?? 0);
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
