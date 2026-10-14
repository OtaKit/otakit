'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { CopyButton } from '@/app/components/CopyButton';
import type { ReleaseHistoryItem } from '@/app/components/dashboard-types';
import { ChangeBadge, formatCount, TrendChart } from '@/app/components/error-ui';
import { InfoHint } from '@/app/components/InfoHint';
import type {
  AppEventBreakdownResult,
  AppEventDetail,
  AppEventRange,
  AppEventReleaseComparison,
} from '@/lib/services/app-events';
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

const RANGE_LABELS: Record<AppEventRange, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
};
const NONE = '__none__';

/** One CSV field: quoted, with quotes doubled. */
function csvField(value: string | number | null): string {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function toCsv(rows: Array<Array<string | number | null>>): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\n');
}

/** Load JSON for a URL; the previous result is dropped when a load fails. */
function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string; data: T | null; error: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
        if (!response.ok || !body) throw new Error(body?.error ?? 'Could not load');
        setState({ url, data: body, error: null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          url,
          data: null,
          error: cause instanceof Error ? cause.message : 'Could not load',
        });
      });
    return () => controller.abort();
  }, [url]);
  const current = state?.url === url ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: url !== null && !current,
  };
}

function Breakdown({ result }: { result: AppEventBreakdownResult }) {
  if (result.total.events === 0) {
    return <p className="text-sm text-muted-foreground">No events in this range.</p>;
  }
  const rows = [
    ...result.values.map((entry) => ({
      label: entry.value === '' ? '(not set)' : entry.value,
      events: entry.events,
      share: entry.share,
      muted: entry.value === '',
    })),
    ...(result.other.events > 0
      ? [
          {
            label: 'Other values',
            events: result.other.events,
            share: result.other.share,
            muted: true,
          },
        ]
      : []),
  ];
  const csv = toCsv([
    [result.property, 'events', 'share %'],
    ...rows.map((row) => [row.label, row.events, row.share]),
  ]);
  return (
    <div>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="relative overflow-hidden rounded text-xs">
            <span
              className="absolute inset-y-0 left-0 bg-sky-500/10"
              style={{ width: `${row.share}%` }}
              aria-hidden="true"
            />
            <span className="relative flex justify-between gap-2 px-1.5 py-1">
              <span
                className={cn('truncate font-mono', row.muted && 'text-muted-foreground')}
                title={row.label}
              >
                {row.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCount(row.events)} · {row.share}%
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <CopyButton
          value={csv}
          label="breakdown as CSV"
          className="h-7 border border-border px-2 text-xs"
        >
          Copy as CSV
        </CopyButton>
      </div>
    </div>
  );
}

function Releases({ result }: { result: AppEventReleaseComparison }) {
  if (result.releases.length === 0) {
    return <p className="text-sm text-muted-foreground">No releases to compare yet.</p>;
  }
  const per = result.basis === 'sessions' ? 'Per 1,000 launches' : 'Per 1,000 applies';
  const csv = toCsv([
    [
      'release',
      'channel',
      'events',
      result.basis === 'sessions' ? 'app launches' : 'applies (3.4+)',
      'per 1,000',
      'difference %',
    ],
    ...result.releases.map((row) => [
      row.bundleVersion,
      row.channel ?? 'base',
      row.events,
      row.base,
      row.perThousand,
      row.differencePercent,
    ]),
  ]);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border text-left">
              <th className="py-1.5 pr-3 font-medium">Release</th>
              <th className="py-1.5 pr-3 text-right font-medium">Events</th>
              <th className="py-1.5 pr-3 text-right font-medium">{per}</th>
              <th className="py-1.5 text-right font-medium">vs oldest</th>
            </tr>
          </thead>
          <tbody>
            {result.releases.map((row) => (
              <tr key={row.releaseId} className="border-b border-border/60">
                <td className="py-1.5 pr-3">
                  <span className="font-mono">{row.bundleVersion}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {row.channel ?? 'base'}
                    {row.revertedAt
                      ? ' · reverted'
                      : row.rolloutPercent < 100
                        ? ` · ${row.rolloutPercent}%`
                        : ''}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(row.events)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{row.perThousand ?? '–'}</td>
                <td className="py-1.5 text-right">
                  <ChangeBadge percent={row.differencePercent} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {result.basis === 'sessions'
            ? 'Events per 1,000 app launches on each release, from initAnalytics().'
            : 'The app sends no session events, so rates use applies on plugin 3.4+: less precise. Call initAnalytics() to count launches.'}
        </p>
        <CopyButton
          value={csv}
          label="comparison as CSV"
          className="h-7 shrink-0 border border-border px-2 text-xs"
        >
          Copy as CSV
        </CopyButton>
      </div>
    </div>
  );
}

/** One custom event: trend, a split by any of its properties, and a comparison across releases. */
export function AppEventDialog({
  appId,
  name,
  initialRange,
  releases,
  onClose,
}: {
  appId: string;
  name: string;
  initialRange: AppEventRange;
  releases: ReleaseHistoryItem[];
  onClose: () => void;
}) {
  const [range, setRange] = useState<AppEventRange>(initialRange);
  const [property, setProperty] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>(() => {
    const latest = releases.find((release) => !release.revertedAt);
    return latest?.channel ?? NONE;
  });
  const base = `/api/v1/apps/${appId}/analytics/events/${encodeURIComponent(name)}`;
  const detail = useJson<AppEventDetail>(`${base}?range=${range}`);
  const breakdown = useJson<AppEventBreakdownResult>(
    property ? `${base}/breakdown?range=${range}&property=${encodeURIComponent(property)}` : null,
  );
  const comparison = useJson<AppEventReleaseComparison>(
    `${base}/releases?channel=${channel === NONE ? '' : encodeURIComponent(channel)}`,
  );
  const channels = Array.from(new Set(releases.map((release) => release.channel ?? NONE))).filter(
    (value) => !value.startsWith('__preview'),
  );
  const data = detail.data;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all pr-6 font-mono text-sm">{name}</DialogTitle>
          <DialogDescription className="text-xs">
            {data ? (
              <>
                {formatCount(data.events)} events in {formatCount(data.sessions)} app launches in
                the {RANGE_LABELS[range]} · <ChangeBadge percent={data.changePercent} /> against the
                previous period
              </>
            ) : detail.error ? (
              'Could not load the event.'
            ) : (
              'Loading…'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Select value={range} onValueChange={(value) => setRange(value as AppEventRange)}>
            <SelectTrigger className="h-8 w-36 text-xs" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {!data ? (
          <div className="flex justify-center py-10">
            {detail.error ? (
              <p className="text-sm text-muted-foreground">{detail.error}</p>
            ) : (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Events per {data.range.bucket}
              </p>
              <TrendChart trend={data.series} range={data.range} color="#0ea5e9" />
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Split by property</p>
                <Select
                  value={property ?? NONE}
                  onValueChange={(value) => setProperty(value === NONE ? null : value)}
                  disabled={data.propertyKeys.length === 0}
                >
                  <SelectTrigger className="h-8 w-48 text-xs" aria-label="Property">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {data.propertyKeys.length === 0 ? 'No properties' : 'Choose a property'}
                    </SelectItem>
                    {data.propertyKeys.map((key) => (
                      <SelectItem key={key} value={key}>
                        <span className="font-mono">{key}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {property ? (
                breakdown.data ? (
                  <Breakdown result={breakdown.data} />
                ) : breakdown.error ? (
                  <p className="text-sm text-muted-foreground">{breakdown.error}</p>
                ) : (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                )
              ) : null}
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  By release
                  <InfoHint label="About the release comparison">
                    <p className="text-xs">
                      The 5 latest releases of the channel, oldest first, each with all its events
                      (up to 13 months). The difference is against the oldest release shown.
                    </p>
                  </InfoHint>
                </p>
                {channels.length > 1 ? (
                  <Select value={channel} onValueChange={setChannel}>
                    <SelectTrigger className="h-8 w-40 text-xs" aria-label="Channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((value) => (
                        <SelectItem key={value} value={value}>
                          {value === NONE ? 'base' : value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              {comparison.data ? (
                <Releases result={comparison.data} />
              ) : comparison.error ? (
                <p className="text-sm text-muted-foreground">{comparison.error}</p>
              ) : (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              )}
            </section>

            <p className="text-[11px] text-muted-foreground">
              Event names and property values are set by the app and reported by devices.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
