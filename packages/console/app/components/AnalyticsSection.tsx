'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, LoaderCircle, Package, Radio, RefreshCw, Smartphone } from 'lucide-react';

import { AppEventDialog } from '@/app/components/AppEventDialog';
import { CommandBlock } from '@/app/components/CommandBlock';
import type { ReleaseHistoryItem } from '@/app/components/dashboard-types';
import { ChangeBadge, formatCount, relativeTime, Sparkline } from '@/app/components/error-ui';
import { InfoHint } from '@/app/components/InfoHint';
import { PlatformIcon } from '@/app/components/PlatformIcon';
import type { AppEventList, AppEventRange, LiveAppEventList } from '@/lib/services/app-events';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type PlatformFilter = 'all' | 'ios' | 'android';

const RANGES: Array<{ value: AppEventRange; label: string }> = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];
const ALL = 'all';
const LIVE_POLL_MS = 5_000;

const SETUP_SNIPPET = [
  "import { initAnalytics, track } from '@otakit/capacitor-updater';",
  '',
  '// Once at startup: counts app launches, the base of per-release rates.',
  'initAnalytics();',
  '',
  "track('checkout_completed', { plan: 'pro', value: 49 });",
].join('\n');

/** The latest custom events, refreshed every 5 seconds while open: the setup check. */
function LiveEvents({ appId }: { appId: string }) {
  const [data, setData] = useState<LiveAppEventList | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch(`/api/v1/apps/${appId}/analytics/live?limit=50`)
        .then(async (response) => {
          if (!response.ok) throw new Error('live');
          const body = (await response.json()) as LiveAppEventList;
          if (active) {
            setData(body);
            setFailed(false);
          }
        })
        .catch(() => active && setFailed(true));
    void load();
    const timer = setInterval(load, LIVE_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [appId]);

  return (
    <div className="border-b border-border px-6 py-4">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Latest events of the last 24 hours, refreshed every 5 seconds
      </p>
      {failed && !data ? (
        <p className="text-sm text-muted-foreground">Could not load the latest events.</p>
      ) : !data ? (
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      ) : data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No events in the last 24 hours. Events appear here within a minute of <code>track()</code>
          .
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {data.events.map((event) => (
            <li
              key={event.eventId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-1.5 py-1 text-xs hover:bg-muted/50"
            >
              <span className="w-20 shrink-0 text-muted-foreground" title={event.receivedAt}>
                {relativeTime(event.receivedAt)}
              </span>
              <span className="font-mono font-medium">{event.name}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <PlatformIcon platform={event.platform} className="size-3.5" />
                {event.osVersion ?? ''} · {event.bundleVersion}
              </span>
              {Object.entries(event.properties).map(([key, value]) => (
                <span
                  key={key}
                  className="max-w-56 truncate rounded border border-border px-1 font-mono text-[11px]"
                  title={`${key}=${value}`}
                >
                  {key}={value}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Custom events of the selected app (OtaKit.track(), plugin 3.4+): counts,
 * trends and change per event name, with a live view and per-event detail.
 */
export function AnalyticsSection({
  appId,
  releases,
  docsUrl,
  onUpgrade,
}: {
  appId: string;
  releases: ReleaseHistoryItem[];
  docsUrl: string;
  onUpgrade: () => void;
}) {
  const [range, setRange] = useState<AppEventRange>('7d');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: AppEventList | null;
    error: string | null;
  } | null>(null);
  const requestKey = `${appId}|${range}|${platform}|${releaseId ?? ''}|${reloadToken}`;
  const loading = result?.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ range, trend: '1' });
    if (platform !== 'all') params.set('platform', platform);
    if (releaseId) params.set('releaseId', releaseId);
    fetch(`/api/v1/apps/${appId}/analytics/events?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (AppEventList & { error?: string })
          | null;
        if (!response.ok || !body) throw new Error(body?.error ?? 'Could not load analytics');
        setResult({ key: requestKey, data: body, error: null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          data: null,
          error: cause instanceof Error ? cause.message : 'Could not load analytics',
        });
      });
    return () => controller.abort();
  }, [appId, range, platform, releaseId, requestKey]);

  const releaseOptions = useMemo(() => releases.slice(0, 50), [releases]);
  const failed = result?.key === requestKey && result.error !== null;
  const data = failed ? null : (result?.data ?? null);
  const usage = data?.usage ?? null;
  const nearLimit =
    usage?.limit &&
    usage.events !== null &&
    !usage.pausedUntil &&
    usage.events >= usage.limit * 0.8;

  return (
    <section id="analytics" className="scroll-mt-4">
      <div className="mx-auto max-w-screen-xl bg-muted/30">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
          <div className="mr-5 flex items-center gap-3">
            <BarChart3 className="size-6 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[15px] font-semibold leading-tight">Analytics</h2>
              <p className="text-xs leading-tight text-muted-foreground">
                Custom events per release
              </p>
            </div>
          </div>
          <InfoHint label="About analytics">
            <p className="text-xs">
              Apps on plugin 3.4+ send events with <code>track()</code>. OtaKit adds the release,
              channel and platform, and compares releases per 1,000 app launches when the app calls{' '}
              <code>initAnalytics()</code>. No user or device identifiers.{' '}
              <a
                href={`${docsUrl}/analytics`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Docs
              </a>
            </p>
          </InfoHint>

          <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <Select value={range} onValueChange={(value) => setRange(value as AppEventRange)}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-36" aria-label="Time range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={platform}
              onValueChange={(value) => setPlatform(value as PlatformFilter)}
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-36" aria-label="Platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="flex items-center gap-1.5">
                    <Smartphone className="size-3.5 text-muted-foreground" />
                    All platforms
                  </span>
                </SelectItem>
                <SelectItem value="ios">
                  <span className="flex items-center gap-1.5">
                    <PlatformIcon platform="ios" className="size-4" /> iOS
                  </span>
                </SelectItem>
                <SelectItem value="android">
                  <span className="flex items-center gap-1.5">
                    <PlatformIcon platform="android" className="size-4" /> Android
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={releaseId ?? ALL}
              onValueChange={(value) => setReleaseId(value === ALL ? null : value)}
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-44" aria-label="Release">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>
                  <span className="flex items-center gap-1.5">
                    <Package className="size-3.5 text-muted-foreground" />
                    All releases
                  </span>
                </SelectItem>
                {releaseOptions.map((release) => (
                  <SelectItem key={release.id} value={release.id}>
                    <span className="font-mono">{release.bundleVersion}</span>
                    <span className="text-muted-foreground"> · {release.channel ?? 'base'}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={live ? 'secondary' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              aria-pressed={live}
              onClick={() => setLive((value) => !value)}
            >
              <Radio className="size-3.5" />
              Live
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 text-muted-foreground/55 hover:text-muted-foreground sm:inline-flex"
              disabled={loading}
              onClick={() => setReloadToken((token) => token + 1)}
              title="Refresh analytics"
            >
              {loading ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span className="sr-only">Refresh analytics</span>
            </Button>
          </div>
        </div>

        <div className="border-b border-border bg-background">
          {live ? <LiveEvents appId={appId} /> : null}

          {usage?.pausedUntil ? (
            <div className="mx-6 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <span>
                Analytics are paused until{' '}
                {new Intl.DateTimeFormat('en-US', {
                  month: 'long',
                  day: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(usage.pausedUntil))}
                : this workspace used {usage.limit ? `all ${formatCount(usage.limit)}` : 'its'}{' '}
                custom events for the month. New events are not recorded.
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onUpgrade}>
                Upgrade
              </Button>
            </div>
          ) : nearLimit && usage?.limit && usage.events !== null ? (
            <p className="mx-6 mt-3 text-xs text-muted-foreground">
              {formatCount(usage.events)} of {formatCount(usage.limit)} custom events used this
              month. Above the limit, new events are not recorded until next month.
            </p>
          ) : null}

          {failed ? (
            <div className="flex flex-col items-center gap-3 p-8">
              <p className="text-sm text-muted-foreground">{result?.error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadToken((token) => token + 1)}
              >
                <RefreshCw className="size-3.5" />
                Try again
              </Button>
            </div>
          ) : !data ? (
            <div className="flex justify-center p-8">
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : !data.analyticsAvailable ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              Analytics are unavailable right now. Try again in a minute.
            </p>
          ) : !data.hasEvents ? (
            <div className="p-5">
              <div className="mx-auto max-w-xl rounded-lg border border-dashed px-6 py-8">
                <p className="text-sm font-medium">No events yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Send events from your app (plugin 3.4+). OtaKit shows how often they happen, split
                  by any property, and per release.
                </p>
                <CommandBlock className="mt-4" value={SETUP_SNIPPET} label="Copy setup code" />
                <p className="mt-3 text-xs text-muted-foreground">
                  Turn on <strong>Live</strong> to see events arrive within a minute.{' '}
                  <Link
                    href={`${docsUrl}/analytics`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Read the guide
                  </Link>
                </p>
              </div>
            </div>
          ) : data.events.length === 0 ? (
            <p className="px-6 py-6 text-sm text-muted-foreground">
              No events in the{' '}
              {RANGES.find((option) => option.value === range)?.label.toLowerCase()}
              {platform !== 'all' || releaseId ? ' with these filters' : ''}.
            </p>
          ) : (
            <div className={cn('overflow-auto', loading && 'opacity-60')}>
              <p className="px-6 pt-3 text-xs text-muted-foreground">
                {data.sessions === null
                  ? 'App launches are not counted: call initAnalytics() to compare releases per 1,000 launches.'
                  : `${formatCount(data.sessions)} app launches in this range.`}
              </p>
              <Table className="table-fixed sm:min-w-[680px] [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-auto">Event</TableHead>
                    <TableHead className="hidden w-28 sm:table-cell">Trend</TableHead>
                    <TableHead className="w-24 text-right">Events</TableHead>
                    <TableHead className="hidden w-24 text-right sm:table-cell">
                      App launches
                    </TableHead>
                    <TableHead className="w-24 text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.map((event) => (
                    <TableRow
                      key={event.name}
                      className="cursor-pointer"
                      tabIndex={0}
                      onClick={() => setOpenEvent(event.name)}
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                          keyEvent.preventDefault();
                          setOpenEvent(event.name);
                        }
                      }}
                    >
                      <TableCell
                        className="truncate py-2.5 font-mono text-xs font-medium"
                        title={event.name}
                      >
                        {event.name}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Sparkline
                          trend={event.trend ?? []}
                          range={data.range}
                          className="text-sky-500/80"
                        />
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {formatCount(event.events)}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                        {formatCount(event.sessions)}
                      </TableCell>
                      <TableCell
                        className="text-right text-xs"
                        title={`${formatCount(event.previousEvents)} in the previous period`}
                      >
                        <ChangeBadge percent={event.changePercent} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {openEvent ? (
        <AppEventDialog
          appId={appId}
          name={openEvent}
          initialRange={range}
          releases={releases}
          onClose={() => setOpenEvent(null)}
        />
      ) : null}
    </section>
  );
}
