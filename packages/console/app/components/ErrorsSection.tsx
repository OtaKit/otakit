'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bug, ChevronDown, LoaderCircle, Package, RefreshCw, Smartphone } from 'lucide-react';

import { CommandBlock } from '@/app/components/CommandBlock';
import type { ReleaseHistoryItem } from '@/app/components/dashboard-types';
import { ErrorIssueDialog } from '@/app/components/ErrorIssueDialog';
import { formatCount, relativeTime, Sparkline, StatusBadge } from '@/app/components/error-ui';
import { InfoHint } from '@/app/components/InfoHint';
import { PlatformIcon } from '@/app/components/PlatformIcon';
import type { ErrorIssueStatusValue, ErrorRange } from '@/lib/error-tracking';
import type { ErrorIssueList, ErrorIssueSummary } from '@/lib/services/error-issues';
import { Badge } from '@/components/ui/badge';
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

type StatusFilter = ErrorIssueStatusValue | 'all';
type PlatformFilter = 'all' | 'ios' | 'android';

const STATUSES: Array<{ value: StatusFilter; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'ignored', label: 'Ignored' },
  { value: 'all', label: 'All' },
];

const RANGES: Array<{ value: ErrorRange; label: string }> = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const ALL = 'all';
const PAGE = 25;

const SETUP_SNIPPET = [
  "import { initErrorTracking } from '@otakit/capacitor-updater';",
  '',
  '// Once, as early as possible (for example in main.ts):',
  'initErrorTracking();',
].join('\n');

/**
 * Error tracking for the selected app: issues (grouped JavaScript errors) per
 * range, status, platform and release, with the issue detail in a dialog.
 * Plugin 3.4+ with initErrorTracking() in the app.
 */
export function ErrorsSection({
  appId,
  releases,
  docsUrl,
  releaseFilter,
  onReleaseFilterChange,
  onUpgrade,
}: {
  appId: string;
  releases: ReleaseHistoryItem[];
  docsUrl: string;
  /** Set from outside, e.g. "View errors" in a release's health dialog. */
  releaseFilter: string | null;
  onReleaseFilterChange: (releaseId: string | null) => void;
  onUpgrade: () => void;
}) {
  const [range, setRange] = useState<ErrorRange>('7d');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [result, setResult] = useState<{
    key: string;
    data: ErrorIssueList | null;
    error: string | null;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [visible, setVisible] = useState(PAGE);
  // A link from an alert (?app=<id>&issue=<fingerprint>) opens the issue.
  const [openIssue, setOpenIssue] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const issue = params.get('issue');
    return params.get('app') === appId && issue && /^[0-9a-f]{16}$/.test(issue) ? issue : null;
  });
  const sectionRef = useRef<HTMLElement>(null);

  // "View errors" on a release shows all of its issues from the last 30 days,
  // matching the release's totals, instead of only open ones from 7 days.
  const [shownRelease, setShownRelease] = useState(releaseFilter);
  if (releaseFilter !== shownRelease) {
    setShownRelease(releaseFilter);
    if (releaseFilter) {
      setStatus('all');
      setRange('30d');
    }
  }

  const requestKey = `${appId}|${range}|${status}|${platform}|${releaseFilter ?? ''}|${reloadToken}`;
  const loading = result?.key !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ range, status, limit: '100', trend: '1' });
    if (platform !== 'all') params.set('platform', platform);
    if (releaseFilter) params.set('releaseId', releaseFilter);
    fetch(`/api/v1/apps/${appId}/errors?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (ErrorIssueList & { error?: string })
          | null;
        if (!response.ok || !body) throw new Error(body?.error ?? 'Could not load errors');
        setResult({ key: requestKey, data: body, error: null });
        setVisible(PAGE);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult((current) => ({
          key: requestKey,
          data: current?.data ?? null,
          error: cause instanceof Error ? cause.message : 'Could not load errors',
        }));
      });
    return () => controller.abort();
  }, [appId, range, status, platform, releaseFilter, reloadToken, requestKey]);

  useEffect(() => {
    if (openIssue) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Only for the issue a link opened, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // "View errors" from a release scrolls here.
  useEffect(() => {
    if (releaseFilter) sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [releaseFilter]);

  // The open issue is in the address bar, so the link can be copied and shared.
  const showIssue = useCallback((fingerprint: string | null) => {
    setOpenIssue(fingerprint);
    const url = new URL(window.location.href);
    if (fingerprint) url.searchParams.set('issue', fingerprint);
    else url.searchParams.delete('issue');
    if (url.toString() !== window.location.href) {
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  }, []);
  const closeIssue = useCallback(() => showIssue(null), [showIssue]);

  const releaseLabels = useMemo(
    () =>
      new Map(
        releases.map((release) => [
          release.id,
          `${release.bundleVersion} · ${release.channel ?? 'base'}`,
        ]),
      ),
    [releases],
  );
  const releaseOptions = useMemo(() => releases.slice(0, 50), [releases]);

  // A failed load for the current filters never shows the previous filters' issues.
  const failed = result?.key === requestKey && result.error !== null;
  const data = failed ? null : (result?.data ?? null);
  const issues = data?.issues ?? [];
  const usage = data?.usage ?? null;
  const nearLimit =
    usage?.limit &&
    usage.events !== null &&
    !usage.pausedUntil &&
    usage.events >= usage.limit * 0.8;
  const neverCaptured = data !== null && data.analyticsAvailable && !data.hasErrors;

  return (
    <section ref={sectionRef} id="errors" className="scroll-mt-4">
      <div className="mx-auto max-w-screen-xl bg-muted/30">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
          <div className="mr-5 flex items-center gap-3">
            <Bug className="size-6 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[15px] font-semibold leading-tight">Errors</h2>
              <p className="text-xs leading-tight text-muted-foreground">
                JavaScript errors per release
              </p>
            </div>
          </div>
          <InfoHint label="About error tracking">
            <p className="text-xs">
              Apps on plugin 3.4+ that call <code>initErrorTracking()</code> send unhandled errors
              and promise rejections. OtaKit groups the same error into one issue across builds and
              shows the releases it affects. A resolved issue reopens when it happens again.{' '}
              <a
                href={`${docsUrl}/error-tracking`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Docs
              </a>
            </p>
          </InfoHint>

          <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <Select value={range} onValueChange={(value) => setRange(value as ErrorRange)}>
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
              value={releaseFilter ?? ALL}
              onValueChange={(value) => onReleaseFilterChange(value === ALL ? null : value)}
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
                {releaseFilter && !releaseLabels.has(releaseFilter) ? (
                  <SelectItem value={releaseFilter}>Selected release</SelectItem>
                ) : null}
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
              variant="ghost"
              size="icon"
              className="hidden h-8 w-8 text-muted-foreground/55 hover:text-muted-foreground sm:inline-flex"
              disabled={loading}
              onClick={() => setReloadToken((token) => token + 1)}
              title="Refresh errors"
            >
              {loading ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              <span className="sr-only">Refresh errors</span>
            </Button>
          </div>
        </div>

        <div className="border-b border-border bg-background">
          <div
            className="flex flex-wrap items-center gap-2 px-6 py-3"
            role="group"
            aria-label="Status"
          >
            {STATUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => setStatus(option.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  status === option.value
                    ? 'border-foreground/30 bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
            {data && data.total > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">
                {formatCount(data.total)} {data.total === 1 ? 'issue' : 'issues'}
              </span>
            ) : null}
          </div>

          {usage?.pausedUntil ? (
            <div className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <span>
                Error tracking is paused until{' '}
                {new Intl.DateTimeFormat('en-US', {
                  month: 'long',
                  day: 'numeric',
                  timeZone: 'UTC',
                }).format(new Date(usage.pausedUntil))}
                : this workspace used {usage.limit ? `all ${formatCount(usage.limit)}` : 'its'}{' '}
                error events for the month. New errors are not recorded.
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onUpgrade}>
                Upgrade
              </Button>
            </div>
          ) : nearLimit && usage?.limit && usage.events !== null ? (
            <p className="mx-6 mb-3 text-xs text-muted-foreground">
              {formatCount(usage.events)} of {formatCount(usage.limit)} error events used this
              month. Above the limit, new errors are not recorded until next month.
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
            <p className="px-6 pb-6 pt-2 text-sm text-muted-foreground">
              Error data is unavailable right now. Try again in a minute.
            </p>
          ) : neverCaptured ? (
            <div className="p-5">
              <div className="mx-auto max-w-xl rounded-lg border border-dashed px-6 py-8">
                <p className="text-sm font-medium">No errors yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Turn on error tracking in your app (plugin 3.4+). OtaKit then shows each error
                  with the OTA release, platform and OS version it happened on.
                </p>
                <CommandBlock className="mt-4" value={SETUP_SNIPPET} label="Copy setup code" />
                <p className="mt-3 text-xs text-muted-foreground">
                  To check the setup, call <code>testErrorTracking()</code> once: a test error
                  appears here within a minute.{' '}
                  <Link
                    href={`${docsUrl}/error-tracking`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Read the guide
                  </Link>
                </p>
              </div>
            </div>
          ) : issues.length === 0 ? (
            <p className="px-6 pb-6 pt-2 text-sm text-muted-foreground">
              {status === 'all' ? 'No errors' : `No ${status} errors`} in the{' '}
              {RANGES.find((option) => option.value === range)?.label.toLowerCase()}
              {platform !== 'all' || releaseFilter ? ' with these filters' : ''}.
            </p>
          ) : (
            <div className="relative">
              <div className={cn('overflow-auto', loading && 'opacity-60')}>
                <Table className="table-fixed sm:min-w-[760px] [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-auto">Issue</TableHead>
                      <TableHead className="hidden w-28 sm:table-cell">Trend</TableHead>
                      <TableHead className="hidden w-20 text-right sm:table-cell">Events</TableHead>
                      <TableHead className="hidden w-20 text-right sm:table-cell">
                        Sessions
                      </TableHead>
                      <TableHead className="hidden w-20 text-right sm:table-cell">
                        Releases
                      </TableHead>
                      <TableHead className="hidden w-28 sm:table-cell">Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {issues.slice(0, visible).map((issue) => (
                      <IssueRow
                        key={issue.fingerprint}
                        issue={issue}
                        range={data.range}
                        showStatus={status === 'all'}
                        onOpen={() => showIssue(issue.fingerprint)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
              {issues.length > visible ? (
                <div className="flex justify-center border-t border-border py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setVisible((count) => count + PAGE)}
                  >
                    <ChevronDown className="size-3.5" />
                    Show more
                  </Button>
                </div>
              ) : null}
              {data.truncated || data.total > issues.length ? (
                <p className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
                  {data.truncated
                    ? 'More than 500 issues in this range.'
                    : `${formatCount(data.total)} issues in this range.`}{' '}
                  Showing the {formatCount(issues.length)} with the most events; narrow the filters
                  to see others.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {openIssue ? (
        <ErrorIssueDialog
          appId={appId}
          fingerprint={openIssue}
          initialRange={range}
          releaseLabels={releaseLabels}
          onClose={closeIssue}
          onStatusChange={() => setReloadToken((token) => token + 1)}
        />
      ) : null}
    </section>
  );
}

function IssueRow({
  issue,
  range,
  showStatus,
  onOpen,
}: {
  issue: ErrorIssueSummary;
  range: ErrorIssueList['range'];
  showStatus: boolean;
  onOpen: () => void;
}) {
  return (
    <TableRow
      className="cursor-pointer"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <TableCell className="py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {showStatus ? <StatusBadge status={issue.status} /> : null}
          {issue.isNew ? (
            <Badge
              variant="outline"
              className="h-5 border-sky-500/30 px-1.5 text-[10px] font-medium text-sky-700 dark:text-sky-300"
            >
              New
            </Badge>
          ) : null}
          {issue.regressions > 0 && issue.status === 'open' ? (
            <Badge
              variant="outline"
              className="h-5 border-amber-500/30 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
              title="It came back after it was resolved"
            >
              Regressed
            </Badge>
          ) : null}
          <span className="truncate font-mono text-xs font-medium" title={issue.title}>
            {issue.title}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={issue.lastMessage}>
          {issue.topFrame ? <span className="font-mono">{issue.topFrame}</span> : null}
          {issue.topFrame && issue.lastMessage ? ' · ' : null}
          {issue.lastMessage}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
          {formatCount(issue.events)} {issue.events === 1 ? 'event' : 'events'} ·{' '}
          {relativeTime(issue.lastSeenAt)}
        </p>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Sparkline trend={issue.trend ?? []} range={range} />
      </TableCell>
      <TableCell className="hidden text-right text-xs tabular-nums sm:table-cell">
        {formatCount(issue.events)}
      </TableCell>
      <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
        {formatCount(issue.sessions)}
      </TableCell>
      <TableCell
        className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell"
        title={issue.releases === 0 ? 'Only on the built-in bundle' : undefined}
      >
        {issue.releases === 0 ? '–' : formatCount(issue.releases)}
      </TableCell>
      <TableCell
        className="hidden text-xs text-muted-foreground sm:table-cell"
        title={issue.lastSeenAt}
      >
        {relativeTime(issue.lastSeenAt)}
      </TableCell>
    </TableRow>
  );
}
