'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import {
  Activity,
  BookOpen,
  ChartLine,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Clock,
  Copy,
  Cpu,
  Ellipsis,
  Filter,
  Hash,
  Info,
  LayoutDashboard,
  Package,
  RefreshCw,
  RotateCcw,
  Rocket,
  Settings,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';

import { site } from '@/lib/site';

// useLayoutEffect on the client (to position the ticker before paint, no flash),
// useEffect on the server to avoid the SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* Static, fake-data mirror of the OtaKit console dashboard for the landing
   page, lightly animated so it feels live: events stream in, the current bar of
   the activity chart grows and the totals tick up. Hand-kept in visual sync
   with the real dashboard (packages/console, ProductDashboard and
   EventActivityChart). The story in the data: 2.3.0 went to every device
   yesterday evening, and 2.4.0 is on beta and rolling out to 25%. */

const SIGNUP_URL = `${site.console}/login`;

type LiveTarget = {
  channel: string;
  since: string;
  by: string;
  previous: string;
  /** Percent of devices while a rollout is in progress. */
  rollout?: number;
  autoRevert?: boolean;
  /** The lane's other release while a newer one rolls out. */
  sharedWith?: string;
};

type Bundle = {
  version: string;
  runtime: string;
  size: string;
  date: string;
  time: string;
  live: LiveTarget[];
  previous: string[];
};

const BUNDLES: Bundle[] = [
  {
    version: '2.4.1',
    runtime: '5.0',
    size: '2.4 MB',
    date: 'Nov 6',
    time: '02:12 PM',
    live: [],
    previous: [],
  },
  {
    version: '2.4.0',
    runtime: '5.0',
    size: '2.4 MB',
    date: 'Nov 6',
    time: '09:31 AM',
    live: [
      {
        channel: 'base',
        since: 'Nov 6, 10:00 AM',
        by: 'you@acme.com',
        previous: '2.3.0',
        rollout: 25,
        autoRevert: true,
      },
      { channel: 'beta', since: 'Nov 6, 09:45 AM', by: 'ci@acme.com', previous: '2.3.0' },
    ],
    previous: [],
  },
  {
    version: '2.3.0',
    runtime: '5.0',
    size: '2.4 MB',
    date: 'Nov 5',
    time: '05:12 PM',
    live: [
      {
        channel: 'base',
        since: 'Nov 5, 06:00 PM',
        by: 'you@acme.com',
        previous: '2.2.1',
        autoRevert: true,
        sharedWith: '2.4.0',
      },
    ],
    previous: ['beta'],
  },
];

/* ---------- Activity chart data: the last 24 hours, per 30 minutes ---------- */

const ACTIONS = [
  { key: 'downloaded', label: 'Downloaded', stat: 'Downloads', color: '#3b82f6' },
  { key: 'applied', label: 'Applied', stat: 'Applies', color: '#10b981' },
  { key: 'downloadError', label: 'Download error', stat: 'Download errors', color: '#f59e0b' },
  { key: 'checkError', label: 'Update check error', stat: 'Check errors', color: '#a1a1aa' },
  { key: 'rollback', label: 'Rollback', stat: 'Rollbacks', color: '#ef4444' },
] as const;

type ActionKey = (typeof ACTIONS)[number]['key'];
type Bucket = Record<ActionKey, number>;

const BUCKETS = 48;
/** The first bar starts at 3 PM yesterday; the last one (2:30 PM) is in progress. */
const FIRST_HOUR = 15;
const BASE_DEVICES = 64_000;
const BETA_DEVICES = 2_600;
/** When things happened, in buckets since the first bar. */
const AT = { release: 6, beta: 37.5, rollout10: 38, rollout25: 44 };

type Marker = {
  at: number;
  bundle: string;
  channel: string;
  label: string;
  time: string;
};

const MARKERS: Marker[] = [
  { at: AT.release, bundle: '2.3.0', channel: 'base', label: 'Released', time: 'Nov 5, 6:00 PM' },
  { at: AT.beta, bundle: '2.4.0', channel: 'beta', label: 'Released', time: 'Nov 6, 9:45 AM' },
  {
    at: AT.rollout10,
    bundle: '2.4.0',
    channel: 'base',
    label: 'Released',
    time: 'Nov 6, 10:00 AM',
  },
  {
    at: AT.rollout25,
    bundle: '2.4.0',
    channel: 'base',
    label: 'Rollout 10% → 25%',
    time: 'Nov 6, 1:00 PM',
  },
];

/** Flags closer than this (in buckets) share one flag, as in the real chart. */
const FLAG_CLUSTER_BUCKETS = 2.5;
const CLUSTERS = MARKERS.reduce<Marker[][]>((clusters, marker) => {
  const last = clusters.at(-1);
  if (last && marker.at - last[0].at < FLAG_CLUSTER_BUCKETS) last.push(marker);
  else clusters.push([marker]);
  return clusters;
}, []);

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Share of devices that open the app in a bucket: quiet at night, busiest late afternoon. */
function openShare(bucket: number): number {
  const hour = (FIRST_HOUR + bucket / 2 + 0.25) % 24;
  return 0.0225 * (1 + 0.6 * Math.sin((2 * Math.PI * (hour - 10.5)) / 24));
}

/**
 * A small, deterministic fleet model (same on the server and the client):
 * devices download a release when they next open the app, so a release swells
 * and fades with the daily rhythm.
 */
function buildActivity(): Bucket[] {
  const random = seededRandom(20261106);
  const noise = () => 0.95 + random() * 0.1;
  let pending = 14_000; // devices still moving to 2.2.1
  let pendingBeta = 0;
  let previousGood = 0;
  const raw: Bucket[] = [];

  for (let i = 0; i < BUCKETS; i += 1) {
    if (i === AT.release) pending = BASE_DEVICES;
    if (i === Math.ceil(AT.beta)) pendingBeta = BETA_DEVICES;
    if (i === AT.rollout10) pending += (BASE_DEVICES - pending) * 0.1;
    if (i === AT.rollout25) pending += (BASE_DEVICES - pending) * 0.15;

    const share = openShare(i);
    const baseDownloads = pending * share * noise();
    const betaDownloads = pendingBeta * share * 1.5 * noise();
    pending -= baseDownloads;
    pendingBeta -= betaDownloads;

    const downloaded = baseDownloads + betaDownloads;
    const downloadError = downloaded * 0.012 * noise();
    const good = downloaded - downloadError;
    const applied = 0.6 * good + 0.36 * previousGood;
    previousGood = good;
    raw.push({
      downloaded,
      applied,
      downloadError,
      checkError: (BASE_DEVICES + BETA_DEVICES) * share * 0.0011 * noise(),
      rollback: applied * 0.004 * noise(),
    });
  }

  // Devices check in over a while rather than all at once: ease each series.
  let eased = raw[0];
  return raw.map((bucket) => {
    eased = Object.fromEntries(
      ACTIONS.map(({ key }) => [key, eased[key] * 0.45 + bucket[key] * 0.55]),
    ) as Bucket;
    return Object.fromEntries(ACTIONS.map(({ key }) => [key, Math.round(eased[key])])) as Bucket;
  });
}

const FULL_ACTIVITY = buildActivity();
const SETTLED = FULL_ACTIVITY.slice(0, -1);
/** The current bar when it is complete; it starts part way and grows live. */
const CURRENT_TARGET = FULL_ACTIVITY[BUCKETS - 1];
const CURRENT_START = scaleBucket(CURRENT_TARGET, 0.45);

function scaleBucket(bucket: Bucket, factor: number): Bucket {
  return Object.fromEntries(
    ACTIONS.map(({ key }) => [key, Math.round(bucket[key] * factor)]),
  ) as Bucket;
}

function bucketTotal(bucket: Bucket): number {
  return ACTIONS.reduce((sum, { key }) => sum + bucket[key], 0);
}

const SETTLED_TOTALS = SETTLED.reduce<Bucket>(
  (sum, bucket) =>
    Object.fromEntries(ACTIONS.map(({ key }) => [key, sum[key] + bucket[key]])) as Bucket,
  scaleBucket(CURRENT_TARGET, 0),
);

/** Round y-axis steps (500, 1K, 2K...) with room above the tallest bar. */
function niceTicks(max: number): number[] {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((m) => m >= raw) ?? raw;
  const top = Math.ceil((max * 1.04) / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
}

const Y_TICKS = niceTicks(Math.max(...FULL_ACTIVITY.map(bucketTotal)));
const Y_MAX = Y_TICKS.at(-1)!;
/** Px: the y-axis column, the right margin, the flag row and the plot (as in EventActivityChart). */
const Y_AXIS_WIDTH = 40;
const RIGHT_MARGIN = 8;
const PLOT_TOP = 26;
const PLOT_HEIGHT = 140;

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullNumber = new Intl.NumberFormat('en-US');

/** 3 PM on the axis; 3:00 PM in a tooltip, as the real chart formats them. */
function clockLabel(minutes: number, withMinutes = false): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = minute || withMinutes ? `:${String(minute).padStart(2, '0')}` : '';
  return `${h12}${suffix} ${hour < 12 ? 'AM' : 'PM'}`;
}

function bucketLabel(index: number): string {
  const start = FIRST_HOUR * 60 + index * 30;
  const day = start >= 24 * 60 ? 'Nov 6' : 'Nov 5';
  const range = `${day}, ${clockLabel(start, true)} – ${clockLabel(start + 30, true)}`;
  return index === BUCKETS - 1 ? `${range}, so far` : range;
}

/** Every third hour from the first bar, as the real 24-hour chart labels them. */
const X_TICKS = Array.from({ length: 8 }, (_, index) => ({
  share: (index * 6) / BUCKETS,
  label: clockLabel(FIRST_HOUR * 60 + index * 180),
}));

/* ---------- Event list ---------- */

type EventRow = {
  id: number;
  time: string;
  platform: 'iOS' | 'Android';
  action: 'Downloaded' | 'Applied' | 'Download error' | 'Rollback';
  bundle: string;
  channel: string;
  runtime: string;
};

// Rows visible in the events viewport (its height is frozen to exactly this).
const VISIBLE_ROWS = 5;

const INITIAL_EVENTS: EventRow[] = [
  { id: 5, platform: 'iOS', action: 'Applied', bundle: '2.4.0', channel: 'base' },
  { id: 4, platform: 'Android', action: 'Downloaded', bundle: '2.3.0', channel: 'base' },
  { id: 3, platform: 'iOS', action: 'Applied', bundle: '2.4.0', channel: 'beta' },
  { id: 2, platform: 'Android', action: 'Download error', bundle: '2.3.0', channel: 'base' },
  { id: 1, platform: 'iOS', action: 'Downloaded', bundle: '2.4.0', channel: 'base' },
].map((event) => ({ ...event, time: 'Nov 6, 02:41 PM', runtime: '5.0' }) as EventRow);

const BUNDLE_ROUTES: Array<{ bundle: string; channel: string; weight: number }> = [
  { bundle: '2.3.0', channel: 'base', weight: 0.6 },
  { bundle: '2.4.0', channel: 'base', weight: 0.25 },
  { bundle: '2.4.0', channel: 'beta', weight: 0.15 },
];

const EVENT_TIME = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const TABLE_CLASS =
  'w-full table-fixed text-xs ' +
  '[&_th]:h-9 [&_th]:px-2 [&_th]:text-left [&_th]:align-middle [&_th]:font-medium [&_th]:text-muted-foreground ' +
  '[&_td]:px-2 [&_td]:py-2 [&_td]:align-middle [&_td]:text-muted-foreground ' +
  '[&_th]:border-r [&_td]:border-r [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 ' +
  '[&_th:first-child]:pl-6 [&_td:first-child]:pl-6 [&_th:last-child]:pr-6 [&_td:last-child]:pr-6 ' +
  '[&_thead_tr]:border-b [&_tbody_tr]:border-b';

// Events use a CSS grid (not a table) so rows can grow in smoothly.
const EVENT_GRID =
  'grid grid-cols-6 border-b border-border ' +
  '[&>div]:flex [&>div]:items-center [&>div]:border-r [&>div]:border-border [&>div]:px-2 ' +
  '[&>div:first-child]:pl-6 [&>div:last-child]:border-r-0 [&>div:last-child]:pr-6';
const EVENT_HEADER_CLASS = `${EVENT_GRID} [&>div]:h-9 [&>div]:font-medium [&>div]:text-muted-foreground`;
const EVENT_ROW_CLASS = `${EVENT_GRID} [&>div]:py-2`;

function StatusDot({ rolling, pulse }: { rolling: boolean; pulse: boolean }) {
  const color = rolling ? 'bg-sky-500' : 'bg-emerald-500';
  return (
    <span className="relative flex size-1.5 shrink-0">
      {pulse ? (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
        />
      ) : null}
      <span className={`relative inline-flex size-1.5 rounded-full ${color}`} />
    </span>
  );
}

function LivePill({ live }: { live: LiveTarget }) {
  const rolling = live.rollout !== undefined;
  return (
    <details name="live-release" className="group relative inline-block">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 [&::-webkit-details-marker]:hidden ${
          rolling
            ? 'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:bg-sky-500/15 dark:text-sky-400 dark:ring-sky-500/25'
            : 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25'
        }`}
      >
        <StatusDot rolling={rolling} pulse={Boolean(live.autoRevert)} />
        {live.channel}
        {rolling ? <span className="tabular-nums">{live.rollout}%</span> : null}
        <ChevronDown className="size-2.5 opacity-50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Channel</span>
          <span className="font-medium">{live.channel}</span>
          {rolling ? (
            <>
              <span className="text-muted-foreground">Rollout</span>
              <span className="font-medium text-sky-700 dark:text-sky-400">
                {live.rollout}% of devices
              </span>
            </>
          ) : null}
          {live.sharedWith ? (
            <>
              <span className="text-muted-foreground">Share</span>
              <span>
                Other devices while <span className="font-mono">{live.sharedWith}</span> rolls out
              </span>
            </>
          ) : null}
          <span className="text-muted-foreground">Live since</span>
          <span>{live.since}</span>
          <span className="text-muted-foreground">Released by</span>
          <span className="truncate">{live.by}</span>
          <span className="text-muted-foreground">Previous</span>
          <span className="truncate font-mono">{live.previous}</span>
          {live.autoRevert ? (
            <>
              <span className="text-muted-foreground">Guard</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                Auto-revert at ≥20% of ≥50 devices / 24h
              </span>
            </>
          ) : null}
        </div>
        <div className="border-t border-border" />
        <div className="py-1 text-xs text-foreground [&>div]:flex [&>div]:items-center [&>div]:gap-2 [&>div]:px-2 [&>div]:py-1.5">
          <div>
            <ChartLine className="size-3.5" />
            Show activity
          </div>
          {rolling ? (
            <>
              <div>
                <SlidersHorizontal className="size-3.5" />
                Change rollout
              </div>
              <div>
                <Check className="size-3.5" />
                Complete rollout
              </div>
              <div>
                <RotateCcw className="size-3.5" />
                Cancel rollout
              </div>
            </>
          ) : (
            <div>
              <RotateCcw className="size-3.5" />
              Revert to previous
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function PrevPill({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
      {channel}
    </span>
  );
}

function FilterPill({ icon: Icon, label }: { icon: typeof Smartphone; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-foreground">
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
      <ChevronDown className="ml-1 size-3.5 opacity-50" />
    </span>
  );
}

/** A number that tweens to its new value. */
function Ticker({
  value,
  format = (v) => fullNumber.format(Math.round(v)),
}: {
  value: number;
  format?: (value: number) => string;
}) {
  const count = useMotionValue(value);
  const text = useTransform(count, format);

  useEffect(() => {
    const controls = animate(count, value, { duration: 0.65, ease: 'easeOut' });
    return () => controls.stop();
  }, [value, count]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}

function ChartStat({
  label,
  color,
  children,
}: {
  label: string;
  color?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {color ? (
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
        ) : null}
        {label}
        {color ? null : <Info className="size-3 text-muted-foreground/70" />}
      </dt>
      <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{children}</dd>
    </div>
  );
}

function ActivityChart({ current }: { current: Bucket }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const buckets = [...SETTLED, current];
  const totals = Object.fromEntries(
    ACTIONS.map(({ key }) => [key, SETTLED_TOTALS[key] + current[key]]),
  ) as Bucket;
  const rollbackShare = (totals.rollback / (totals.applied + totals.rollback)) * 100;
  const hoveredBucket = hovered === null ? null : buckets[hovered];

  return (
    <div className="border-b border-border bg-background px-6 pb-4 pt-5">
      <div className="flex items-start justify-between gap-x-8">
        <dl className="flex flex-wrap gap-x-8 pl-10">
          {ACTIONS.map((action) => (
            <ChartStat key={action.key} label={action.stat} color={action.color}>
              <Ticker value={totals[action.key]} />
            </ChartStat>
          ))}
          <ChartStat label="Rollback share">
            <Ticker value={rollbackShare} format={(v) => `${v.toFixed(2)}%`} />
          </ChartStat>
        </dl>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          Split by
          <span className="inline-flex h-8 w-32 items-center justify-between rounded-md border border-input bg-background px-3 text-xs text-foreground">
            Action
            <ChevronDown className="size-3.5 opacity-50" />
          </span>
        </span>
      </div>

      <div className="relative mt-4" style={{ height: PLOT_TOP + PLOT_HEIGHT }}>
        {/* Y axis and grid. */}
        {Y_TICKS.map((tick) => (
          <div
            key={tick}
            className="absolute flex -translate-y-1/2 items-center"
            style={{
              left: 0,
              right: RIGHT_MARGIN,
              top: PLOT_TOP + PLOT_HEIGHT * (1 - tick / Y_MAX),
            }}
          >
            <span
              className="shrink-0 pr-2 text-right text-[11px] text-muted-foreground"
              style={{ width: Y_AXIS_WIDTH }}
            >
              {compactNumber.format(tick)}
            </span>
            <span className="h-px flex-1 border-t border-dashed border-border" />
          </div>
        ))}

        <div
          className="absolute bottom-0"
          style={{ left: Y_AXIS_WIDTH, right: RIGHT_MARGIN, top: PLOT_TOP }}
        >
          {/* Bars: downloads at the bottom, rollbacks on top. */}
          <div className="absolute inset-0 flex items-end" onMouseLeave={() => setHovered(null)}>
            {buckets.map((bucket, index) => {
              const total = bucketTotal(bucket);
              return (
                <div
                  key={index}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHovered(index)}
                >
                  {hovered === index ? <div className="absolute inset-0 bg-muted/70" /> : null}
                  <div
                    className="relative flex w-[88%] flex-col-reverse transition-[height] duration-700 ease-out"
                    style={{
                      height: `${(total / Y_MAX) * 100}%`,
                      opacity: index === BUCKETS - 1 ? 0.55 : 1,
                    }}
                  >
                    {ACTIONS.map(({ key, color }) => (
                      <div
                        key={key}
                        className="shrink-0 transition-[height] duration-700 ease-out"
                        style={{
                          height: total ? `${(bucket[key] / total) * 100}%` : 0,
                          background: color,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Release markers. */}
          {MARKERS.map((marker) => (
            <div
              key={`${marker.at}-${marker.label}`}
              className="pointer-events-none absolute inset-y-0 border-l border-dashed"
              style={{
                left: `${(marker.at / BUCKETS) * 100}%`,
                borderColor: 'var(--foreground)',
                opacity: 0.5,
              }}
            />
          ))}

          {/* Hover tooltip for a bar. */}
          {hoveredBucket && hovered !== null ? (
            <div
              className={`pointer-events-none absolute top-2 z-20 min-w-44 rounded-lg border bg-background px-3 py-2 text-xs shadow-md ${
                hovered > BUCKETS * 0.75 ? '-translate-x-full' : 'translate-x-3'
              }`}
              style={{
                left: `${((hovered + (hovered > BUCKETS * 0.75 ? 0 : 1)) / BUCKETS) * 100}%`,
              }}
            >
              <p className="font-medium">{bucketLabel(hovered)}</p>
              <div className="mt-1.5 space-y-1">
                {ACTIONS.map(({ key, label, color }) =>
                  hoveredBucket[key] > 0 ? (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="size-2 rounded-[2px]" style={{ background: color }} />
                        {label}
                      </span>
                      <span className="font-medium tabular-nums">
                        {fullNumber.format(hoveredBucket[key])}
                      </span>
                    </div>
                  ) : null,
                )}
              </div>
              <div className="mt-1.5 flex justify-between border-t pt-1.5">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium tabular-nums">
                  {fullNumber.format(bucketTotal(hoveredBucket))}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Flags: one per release, rollout step or revert, merged where they would overlap. */}
        <div
          className="absolute top-0 z-10 h-5"
          style={{ left: Y_AXIS_WIDTH, right: RIGHT_MARGIN }}
        >
          {CLUSTERS.map((cluster) => {
            const newest = cluster.at(-1)!;
            return (
              <div
                key={cluster[0].at}
                className="group absolute top-0 -translate-x-1/2"
                style={{ left: `${(cluster[0].at / BUCKETS) * 100}%` }}
              >
                <span className="flex h-5 items-center gap-1 rounded-full border bg-background px-1.5 font-mono text-[10px] leading-none text-foreground shadow-xs">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: 'var(--foreground)' }}
                  />
                  {newest.bundle}
                  {cluster.length > 1 ? (
                    <span className="text-muted-foreground">+{cluster.length - 1}</span>
                  ) : null}
                </span>
                <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden w-max max-w-72 -translate-x-1/2 rounded-md bg-foreground px-3 py-1.5 text-left text-xs text-background group-hover:block">
                  <ul className="space-y-1">
                    {cluster.map((marker) => (
                      <li key={marker.label + marker.channel}>
                        <span className="font-medium">
                          {marker.bundle} · {marker.channel} · 5.0
                        </span>
                        <br />
                        {marker.label}, {marker.time}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* X axis. */}
      <div
        className="relative mt-2 h-4 text-[11px] text-muted-foreground"
        style={{ marginLeft: Y_AXIS_WIDTH, marginRight: RIGHT_MARGIN }}
      >
        {X_TICKS.map((tick) => (
          <span
            key={tick.label}
            className="absolute -translate-x-1/2"
            style={{ left: `${tick.share * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-x-6 pl-10">
        <ul className="flex items-center gap-x-4 text-xs">
          {ACTIONS.map(({ key, label, color }) => (
            <li key={key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[3px]" style={{ background: color }} />
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums text-muted-foreground/70">
                {compactNumber.format(totals[key])}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          per 30 minutes · click a bar to list its events
        </p>
      </div>
    </div>
  );
}

function makeEvent(id: number, clock: Date): EventRow {
  const r = Math.random();
  const action: EventRow['action'] =
    r < 0.5 ? 'Applied' : r < 0.9 ? 'Downloaded' : r < 0.97 ? 'Download error' : 'Rollback';
  const platform: EventRow['platform'] = Math.random() < 0.5 ? 'iOS' : 'Android';

  let acc = 0;
  const pick = Math.random();
  let route = BUNDLE_ROUTES[0];
  for (const candidate of BUNDLE_ROUTES) {
    acc += candidate.weight;
    if (pick <= acc) {
      route = candidate;
      break;
    }
  }

  clock.setTime(clock.getTime() + (5 + Math.floor(Math.random() * 28)) * 1000);
  return {
    id,
    time: EVENT_TIME.format(clock),
    platform,
    action,
    bundle: route.bundle,
    channel: route.channel,
    runtime: '5.0',
  };
}

/** The current bar fills in step by step until it reaches its full height. */
function growCurrent(current: Bucket): Bucket {
  const next = { ...current };
  for (const { key } of ACTIONS) {
    const gap = CURRENT_TARGET[key] - current[key];
    if (gap <= 0) continue;
    const step = Math.max(1, Math.round(CURRENT_TARGET[key] * (0.01 + Math.random() * 0.015)));
    next[key] = current[key] + Math.min(gap, step);
  }
  return next;
}

export function DashboardPreview() {
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [current, setCurrent] = useState(CURRENT_START);
  const nextId = useRef(100);
  const clock = useRef<Date | null>(null);

  // Freeze the events viewport to its natural height once, so the streaming
  // rows animate *inside* a fixed box (clipped) instead of changing the
  // preview's total height — which would make ScaleToFit rescale and the whole
  // section jitter.
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState<number>();
  useEffect(() => {
    if (listRef.current) setListHeight(listRef.current.offsetHeight);
  }, []);

  // Ticker: on each new event the whole list glides down by exactly one row so
  // the newest slides in at the top and the oldest slides out the (clipped)
  // bottom — one smooth transform, nothing reflows.
  const y = useMotionValue(0);
  const lastTopId = useRef<number | undefined>(undefined);
  useIsoLayoutEffect(() => {
    const topId = events[0]?.id;
    if (lastTopId.current === undefined) {
      lastTopId.current = topId; // skip the initial mount
      return;
    }
    if (topId === lastTopId.current || !listHeight) return;
    lastTopId.current = topId;
    const rowH = listHeight / VISIBLE_ROWS;
    y.set(-rowH);
    const controls = animate(y, 0, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [events, listHeight, y]);

  useEffect(() => {
    if (!clock.current) {
      clock.current = new Date(2026, 10, 6, 14, 41, 30);
    }

    const interval = setInterval(() => {
      const event = makeEvent(nextId.current++, clock.current!);
      // Keep one extra (clipped) buffer row so there's always a row to slide out.
      setEvents((prev) => [event, ...prev].slice(0, VISIBLE_ROWS + 1));
      setCurrent(growCurrent);
    }, 2100);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-background text-left text-foreground">
      {/* Top header */}
      <header className="flex h-14 items-center gap-4 border-b border-border px-6">
        <div className="flex items-center gap-2">
          <Image
            src="/logo.svg"
            alt="OtaKit"
            width={28}
            height={28}
            className="size-7 rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight">OtaKit</span>
        </div>
        <nav className="ml-auto flex items-center gap-1">
          <span className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-foreground">
            <LayoutDashboard className="size-3.5" />
            Dashboard
          </span>
          <span className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground">
            <Settings className="size-3.5" />
            Settings
          </span>
        </nav>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BookOpen className="size-3.5" />
          Docs
        </span>
      </header>

      {/* Apps bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 pb-5 pt-6">
        <h2 className="flex items-center gap-3 text-[15px] font-semibold">
          <Cpu className="size-6 shrink-0 text-muted-foreground" />
          App
        </h2>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium">
          com.acme.mobile
          <ChevronsUpDown className="size-4 opacity-50" />
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Hash className="size-3" />
          App ID
          <span className="inline-flex items-center gap-1 font-mono">
            7f3c2a10-5b1e-4c...
            <Copy className="size-3" />
          </span>
        </span>
      </div>

      {/* Updates */}
      <div className="bg-muted/30">
        <div className="flex items-center gap-3 border-b border-border bg-background px-6 pb-5 pt-7">
          <Package className="size-6 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">Updates</h3>
            <p className="text-xs leading-tight text-muted-foreground">Bundles &amp; releases</p>
          </div>
          <SlidersHorizontal className="ml-auto size-3.5 text-muted-foreground/45" />
        </div>
        <table className={TABLE_CLASS}>
          <colgroup>
            <col style={{ width: 208 }} />
            <col style={{ width: 168 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 112 }} />
            <col />
            <col style={{ width: 192 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Bundle</th>
              <th>Runtime</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>Release</th>
              <th className="text-center!">Action</th>
            </tr>
          </thead>
          <tbody>
            {BUNDLES.map((b) => (
              <tr key={b.version}>
                <td className="font-mono font-medium text-foreground">
                  <span className="inline-flex items-center gap-1">
                    {b.version}
                    <Copy className="size-3 text-muted-foreground/40" />
                    <Filter className="size-3 text-muted-foreground/40" />
                  </span>
                </td>
                <td className="font-mono">{b.runtime}</td>
                <td>{b.size}</td>
                <td>
                  <div className="leading-tight">{b.date}</div>
                  <div className="leading-tight">{b.time}</div>
                </td>
                <td className="align-middle">
                  <div className="flex flex-wrap items-center gap-1">
                    {b.live.map((l) => (
                      <LivePill key={l.channel} live={l} />
                    ))}
                    {b.previous.map((channel) => (
                      <PrevPill key={channel} channel={channel} />
                    ))}
                    {b.live.length === 0 && b.previous.length === 0 ? 'Not released' : null}
                  </div>
                </td>
                <td className="whitespace-nowrap pl-6 text-center">
                  <a
                    href={SIGNUP_URL}
                    title="Start free to release your own app"
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85"
                  >
                    <Rocket className="size-3" />
                    Release
                  </a>
                  <span className="ml-1.5 inline-flex h-7 items-center rounded-md border border-input bg-background px-2 align-middle text-foreground">
                    <Ellipsis className="size-3.5" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Events */}
      <div className="bg-muted/30">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-6 pb-5 pt-7">
          <div className="mr-3 flex items-center gap-3">
            <Activity className="size-6 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-tight text-foreground">Events</h3>
              <p className="text-xs leading-tight text-muted-foreground">Device activity</p>
            </div>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <FilterPill icon={Smartphone} label="All platforms" />
            <FilterPill icon={Package} label="All bundles" />
            <FilterPill icon={Hash} label="All channels" />
            <FilterPill icon={Cpu} label="All runtimes" />
            <FilterPill icon={Activity} label="All actions" />
            <FilterPill icon={Clock} label="Last 24 hours" />
            <span className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground/55">
              <RefreshCw className="size-3.5" />
            </span>
          </div>
        </div>
        <ActivityChart current={current} />
        <div className="text-xs">
          <div className={EVENT_HEADER_CLASS}>
            <div>Time</div>
            <div>Platform</div>
            <div>Action</div>
            <div>Bundle</div>
            <div>Channel</div>
            <div>Runtime</div>
          </div>
          <div
            ref={listRef}
            className="overflow-hidden"
            style={listHeight ? { height: listHeight } : undefined}
          >
            <motion.div style={{ y }}>
              {events.map((e) => (
                <motion.div
                  key={e.id}
                  // Streamed rows (id >= 100) flash a fading highlight as they
                  // arrive; the seeded rows just render.
                  initial={e.id >= 100 ? { backgroundColor: 'rgba(59,130,246,0.14)' } : false}
                  animate={{ backgroundColor: 'rgba(59,130,246,0)' }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  className={EVENT_ROW_CLASS}
                >
                  <div className="text-muted-foreground">{e.time}</div>
                  <div className="text-muted-foreground">{e.platform}</div>
                  <div
                    className={
                      e.action === 'Download error'
                        ? 'text-amber-600 dark:text-amber-400'
                        : e.action === 'Rollback'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    }
                  >
                    {e.action}
                  </div>
                  <div className="font-mono text-foreground">{e.bundle}</div>
                  <div className="text-muted-foreground">{e.channel}</div>
                  <div className="font-mono text-muted-foreground">{e.runtime}</div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
