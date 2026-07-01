'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import {
  Activity,
  BadgeCheck,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  CircleAlert,
  Clock,
  Copy,
  Cpu,
  Download,
  Filter,
  Hash,
  LayoutDashboard,
  Package,
  RefreshCw,
  RotateCcw,
  Rocket,
  Settings,
  SlidersHorizontal,
  Smartphone,
} from 'lucide-react';

// useLayoutEffect on the client (to position the ticker before paint, no flash),
// useEffect on the server to avoid the SSR warning.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* Static, fake-data mirror of the OtaKit console dashboard, used for the
   landing-page mockup — now lightly animated: events stream in and the bundle
   stats tick up, so it feels live. Hand-kept in visual sync with the real
   dashboard (packages/console). */

type Live = { channel: string; since: string; by: string; previous: string };

type Bundle = {
  version: string;
  runtime: string;
  size: string;
  date: string;
  time: string;
  live: Live[];
  previous: string[];
  downloads: number;
  applied: number;
  errors: number;
  rollbacks: number;
};

type EventRow = {
  id: number;
  time: string;
  platform: 'iOS' | 'Android';
  action: 'Downloaded' | 'Applied' | 'Download error' | 'Rollback';
  bundle: string;
  channel: string;
  runtime: string;
};

const INITIAL_BUNDLES: Bundle[] = [
  {
    version: '1.4.2',
    runtime: 'api-v3',
    size: '2.1 MB',
    date: 'Jun 30',
    time: '02:14 PM',
    live: [
      { channel: 'production', since: 'Jun 30, 02:14 PM', by: 'you@acme.com', previous: '1.4.0' },
    ],
    previous: [],
    downloads: 1284,
    applied: 1201,
    errors: 3,
    rollbacks: 0,
  },
  {
    version: '1.4.1',
    runtime: 'api-v3',
    size: '2.0 MB',
    date: 'Jun 28',
    time: '09:32 AM',
    live: [{ channel: 'beta', since: 'Jun 28, 09:32 AM', by: 'ci@acme.com', previous: '1.3.9' }],
    previous: ['production'],
    downloads: 942,
    applied: 905,
    errors: 1,
    rollbacks: 0,
  },
  {
    version: '1.4.0',
    runtime: 'api-v2',
    size: '1.9 MB',
    date: 'Jun 24',
    time: '11:05 AM',
    live: [],
    previous: ['production', 'beta'],
    downloads: 2310,
    applied: 2207,
    errors: 6,
    rollbacks: 2,
  },
];

// Rows visible in the events viewport (its height is frozen to exactly this).
const VISIBLE_ROWS = 7;

const INITIAL_EVENTS: EventRow[] = [
  {
    id: 6,
    time: '2:41:08 PM',
    platform: 'iOS',
    action: 'Applied',
    bundle: '1.4.2',
    channel: 'production',
    runtime: 'api-v3',
  },
  {
    id: 5,
    time: '2:40:44 PM',
    platform: 'Android',
    action: 'Downloaded',
    bundle: '1.4.2',
    channel: 'production',
    runtime: 'api-v3',
  },
  {
    id: 4,
    time: '2:40:19 PM',
    platform: 'iOS',
    action: 'Applied',
    bundle: '1.4.1',
    channel: 'beta',
    runtime: 'api-v3',
  },
  {
    id: 3,
    time: '2:39:52 PM',
    platform: 'Android',
    action: 'Download error',
    bundle: '1.4.2',
    channel: 'production',
    runtime: 'api-v3',
  },
  {
    id: 2,
    time: '2:39:25 PM',
    platform: 'iOS',
    action: 'Applied',
    bundle: '1.4.1',
    channel: 'beta',
    runtime: 'api-v3',
  },
  {
    id: 1,
    time: '2:38:57 PM',
    platform: 'iOS',
    action: 'Rollback',
    bundle: '1.4.0',
    channel: 'production',
    runtime: 'api-v2',
  },
  {
    id: 0,
    time: '2:38:30 PM',
    platform: 'Android',
    action: 'Applied',
    bundle: '1.4.2',
    channel: 'production',
    runtime: 'api-v3',
  },
];

const BUNDLE_ROUTES: Array<{ bundle: string; channel: string; runtime: string; weight: number }> = [
  { bundle: '1.4.2', channel: 'production', runtime: 'api-v3', weight: 0.6 },
  { bundle: '1.4.1', channel: 'beta', runtime: 'api-v3', weight: 0.3 },
  { bundle: '1.4.0', channel: 'base', runtime: 'api-v2', weight: 0.1 },
];

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

function LivePill({ live }: { live: Live }) {
  return (
    <details name="live-release" className="group relative inline-block">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-500/30 [&::-webkit-details-marker]:hidden dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {live.channel}
        <ChevronDown className="size-2.5 opacity-50 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-60 overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-2 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Channel</span>
          <span className="font-medium">{live.channel}</span>
          <span className="text-muted-foreground">Live since</span>
          <span>{live.since}</span>
          <span className="text-muted-foreground">Released by</span>
          <span className="truncate">{live.by}</span>
          <span className="text-muted-foreground">Previous</span>
          <span className="truncate font-mono">{live.previous}</span>
        </div>
        <div className="border-t border-border" />
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-foreground">
          <RotateCcw className="size-3.5" />
          Revert to previous
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

function Stat({ value }: { value: number }) {
  // Smoothly tween the displayed number with motion.
  const count = useMotionValue(value);
  const text = useTransform(count, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    const controls = animate(count, value, { duration: 0.65, ease: 'easeOut' });
    return () => controls.stop();
  }, [value, count]);

  return <motion.span className="tabular-nums">{text}</motion.span>;
}

function makeEvent(id: number, clock: Date): EventRow {
  const r = Math.random();
  const action: EventRow['action'] =
    r < 0.5 ? 'Applied' : r < 0.82 ? 'Downloaded' : r < 0.93 ? 'Download error' : 'Rollback';
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
  const time = clock.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  return {
    id,
    time,
    platform,
    action,
    bundle: route.bundle,
    channel: route.channel,
    runtime: route.runtime,
  };
}

export function DashboardPreview() {
  const [bundles, setBundles] = useState(INITIAL_BUNDLES);
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const nextId = useRef(100);
  const clock = useRef<Date | null>(null);

  // Freeze the events viewport to its natural (7-row) height once, so the
  // streaming rows animate *inside* a fixed box (clipped) instead of changing
  // the preview's total height — which would make ScaleToFit rescale and the
  // whole section jitter.
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
      const base = new Date();
      base.setHours(14, 41, 30, 0);
      clock.current = base;
    }

    const interval = setInterval(() => {
      const event = makeEvent(nextId.current++, clock.current!);
      // Keep one extra (clipped) buffer row so there's always a row to slide out.
      setEvents((prev) => [event, ...prev].slice(0, VISIBLE_ROWS + 1));

      if (event.action === 'Downloaded' || event.action === 'Applied') {
        const bump = 1 + Math.floor(Math.random() * 3);
        setBundles((prev) =>
          prev.map((b) =>
            b.version === event.bundle
              ? event.action === 'Downloaded'
                ? { ...b, downloads: b.downloads + bump }
                : { ...b, applied: b.applied + bump }
              : b,
          ),
        );
      }
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
            7f3c9a2e1b
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
            <col style={{ width: 200 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 96 }} />
            <col />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Bundle</th>
              <th>Runtime</th>
              <th>Size</th>
              <th>Uploaded</th>
              <th>Release</th>
              <th className="text-center">
                <Download className="mx-auto size-3.5 text-blue-600/55 dark:text-blue-400/60" />
              </th>
              <th className="text-center">
                <BadgeCheck className="mx-auto size-3.5 text-emerald-600/55 dark:text-emerald-400/60" />
              </th>
              <th className="text-center">
                <CircleAlert className="mx-auto size-3.5 text-amber-600/55 dark:text-amber-400/60" />
              </th>
              <th className="text-center">
                <RotateCcw className="mx-auto size-3.5 text-red-600/55 dark:text-red-400/60" />
              </th>
              <th className="text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b) => (
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
                    {b.previous.map((c) => (
                      <PrevPill key={c} channel={c} />
                    ))}
                    {b.live.length === 0 && b.previous.length === 0 ? 'Not released' : null}
                  </div>
                </td>
                <td className="text-center tabular-nums">
                  <Stat value={b.downloads} />
                </td>
                <td className="text-center tabular-nums">
                  <Stat value={b.applied} />
                </td>
                <td
                  className={`text-center tabular-nums ${b.errors > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}
                >
                  {b.errors}
                </td>
                <td
                  className={`text-center tabular-nums ${b.rollbacks > 0 ? 'text-destructive' : ''}`}
                >
                  {b.rollbacks}
                </td>
                <td className="text-center">
                  <span className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground">
                    <Rocket className="size-3" />
                    Release
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
