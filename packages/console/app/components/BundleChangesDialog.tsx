'use client';

import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, FileDiff, Info, LoaderCircle, Search } from 'lucide-react';

import type { BundleSummaryItem } from '@/app/components/dashboard-types';
import { printablePath, type FileChangeStatus } from '@/lib/bundle-diff';
import type { BundleDiff } from '@/lib/services/bundle-diff';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const PREVIOUS = 'previous';
/** Select values for "what a channel runs": `channel:` plus the name, empty for base. */
const CHANNEL_PREFIX = 'channel:';
/** Rows rendered at once; the search narrows the rest. */
const MAX_ROWS = 500;

const STATUS_STYLES: Record<FileChangeStatus, { label: string; className: string }> = {
  added: { label: 'Added', className: 'text-emerald-600 dark:text-emerald-400' },
  changed: { label: 'Changed', className: 'text-sky-600 dark:text-sky-400' },
  removed: { label: 'Removed', className: 'text-muted-foreground line-through' },
};

const UNAVAILABLE: Record<'encrypted' | 'unreadable', string> = {
  encrypted: 'it is encrypted, so OtaKit cannot see its files',
  unreadable: 'its files could not be read',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function changeSize(change: {
  status: FileChangeStatus;
  sizeBefore: number | null;
  sizeAfter: number | null;
}): string {
  return change.status === 'changed'
    ? `${formatBytes(change.sizeBefore)} → ${formatBytes(change.sizeAfter)}`
    : formatBytes(change.sizeAfter ?? change.sizeBefore);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function diffQuery(against: string): string {
  if (against === PREVIOUS) return '';
  if (against.startsWith(CHANNEL_PREFIX)) {
    return `?channel=${encodeURIComponent(against.slice(CHANNEL_PREFIX.length))}`;
  }
  return `?against=${encodeURIComponent(against)}`;
}

/**
 * What a bundle changes compared with another one, and content that should
 * not ship. Opened from a bundle row (against its previous upload) or a
 * release (against the release it replaced).
 */
export function BundleChangesDialog({
  appId,
  bundle,
  bundles,
  against: initialAgainst,
  onClose,
}: {
  appId: string;
  bundle: { id: string; version: string };
  /** Bundles to offer under "Compare with". */
  bundles: BundleSummaryItem[];
  /** Bundle to compare with; omitted for the previous upload. */
  against?: string | null;
  onClose: () => void;
}) {
  const [against, setAgainst] = useState(initialAgainst ?? PREVIOUS);
  const [status, setStatus] = useState<FileChangeStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{
    key: string;
    diff: BundleDiff | null;
    error: string | null;
  } | null>(null);
  const loading = result?.key !== against;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/v1/apps/${appId}/bundles/${bundle.id}/diff${diffQuery(against)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | (BundleDiff & { error?: string })
          | null;
        if (!response.ok || !body) throw new Error(body?.error ?? 'Could not compare bundles');
        setResult({ key: against, diff: body, error: null });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: against,
          diff: null,
          error: cause instanceof Error ? cause.message : 'Could not compare bundles',
        });
      });
    return () => controller.abort();
  }, [appId, bundle.id, against]);

  const diff = result?.diff ?? null;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (diff?.changes ?? []).filter(
      (change) =>
        (status === 'all' || change.status === status) &&
        (!needle || change.path.toLowerCase().includes(needle)),
    );
  }, [diff, status, query]);
  const options = bundles.filter((item) => item.id !== bundle.id);
  // Channels with a release for this bundle's runtime version: what their devices run.
  const runtimeVersion = bundles.find((item) => item.id === bundle.id)?.runtimeVersion ?? null;
  const channels = Array.from(
    new Set(
      bundles.flatMap((item) =>
        item.currentTargets
          .filter((target) => target.runtimeVersion === runtimeVersion)
          .map((target) => target.channel ?? ''),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const summary = diff?.summary ?? null;
  const filtered = status !== 'all' || query.trim() !== '';
  const baseRuntimeDiffers =
    diff?.base !== null &&
    diff?.base !== undefined &&
    diff.base.runtimeVersion !== diff.target.runtimeVersion;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDiff className="size-4" />
            Changes in {bundle.version}
          </DialogTitle>
          <DialogDescription>
            Files added, changed and removed, and content that should not ship.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Compare with</span>
          <Select value={against} onValueChange={setAgainst}>
            <SelectTrigger className="h-8 w-56 text-xs" aria-label="Compare with">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PREVIOUS}>Previous upload</SelectItem>
              {channels.length > 0 ? (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>What a channel runs</SelectLabel>
                    {channels.map((channel) => (
                      <SelectItem key={channel} value={`${CHANNEL_PREFIX}${channel}`}>
                        {channel || 'base'}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              ) : null}
              {options.length > 0 ? (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Bundle</SelectLabel>
                    {options.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        <span className="font-mono">{item.version}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              ) : null}
            </SelectContent>
          </Select>
          {loading && result ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {!result ? (
          <div className="flex justify-center p-12">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : result.error ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-destructive">
            {result.error}
          </p>
        ) : diff ? (
          <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
            {diff.status === 'target_unavailable' ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Files of {diff.target.version} cannot be listed:{' '}
                {UNAVAILABLE[diff.unavailableReason ?? 'unreadable']}.
              </p>
            ) : diff.status === 'base_unavailable' ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Cannot compare with {diff.base?.version}:{' '}
                {UNAVAILABLE[diff.unavailableReason ?? 'unreadable']}.
              </p>
            ) : summary ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {diff.base ? (
                    <>
                      Compared with <span className="font-mono">{diff.base.version}</span>
                      {diff.baseSource === 'previous_upload'
                        ? ', the previous upload'
                        : diff.baseSource === 'channel'
                          ? `, what ${against.slice(CHANNEL_PREFIX.length) || 'the base channel'} runs`
                          : ''}
                      .
                    </>
                  ) : (
                    'Nothing earlier to compare with: every file is new.'
                  )}
                </p>
                {diff.base && diff.baseSource === 'previous_upload' && channels.length > 0 ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    Devices may run an older bundle than the previous upload. To see what they
                    download, compare with what a channel runs.
                  </p>
                ) : null}
                {baseRuntimeDiffers ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    The two bundles are for different runtime versions, so no device updates from
                    one to the other.
                  </p>
                ) : null}
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Added" value={String(summary.added)} />
                  <Stat label="Changed" value={String(summary.changed)} />
                  <Stat label="Removed" value={String(summary.removed)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Stat
                    label="Size"
                    value={
                      summary.totalBefore === null
                        ? formatBytes(summary.totalAfter)
                        : `${formatBytes(summary.totalBefore)} → ${formatBytes(summary.totalAfter)}`
                    }
                    hint="Unpacked size of all files"
                  />
                  <Stat
                    label={
                      diff.base && !baseRuntimeDiffers
                        ? `Download from ${diff.base.version}`
                        : 'Download'
                    }
                    value={
                      summary.downloadBytes === null || diff.target.strategy === 'deltas'
                        ? `up to ${formatBytes(summary.downloadBytes ?? diff.target.size)}`
                        : formatBytes(summary.downloadBytes)
                    }
                    hint={
                      diff.target.strategy === 'deltas'
                        ? 'Delta update: only files the device does not have yet.'
                        : 'Zip update: the whole archive.'
                    }
                  />
                </div>
                {!diff.comparable ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    One bundle is a zip and the other uses delta updates, so files count as changed
                    only when their size changed.
                  </p>
                ) : null}
              </>
            ) : null}

            {diff.warnings.length > 0 ? (
              <ul className="space-y-2">
                {diff.warnings.map((warning) => (
                  <li
                    key={warning.code}
                    className={cn(
                      'rounded-lg border p-3 text-xs',
                      warning.severity === 'warning'
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'bg-muted/20',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {warning.severity === 'warning' ? (
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-foreground">{warning.message}</p>
                        {warning.paths.length > 0 ? (
                          <p className="break-all font-mono text-muted-foreground">
                            {warning.paths.map(printablePath).join(', ')}
                            {warning.count > warning.paths.length
                              ? ` and ${warning.count - warning.paths.length} more`
                              : ''}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {diff.changes.length > 0 ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="inline-flex rounded-md border p-0.5"
                    role="group"
                    aria-label="Show"
                  >
                    {(['all', 'added', 'changed', 'removed'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={status === value}
                        onClick={() => setStatus(value)}
                        className={cn(
                          'rounded px-2.5 py-1 text-xs capitalize transition-colors',
                          status === value
                            ? 'bg-secondary font-medium text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  <div className="relative min-w-40 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter files"
                      className="h-8 pl-8 text-xs"
                      aria-label="Filter files"
                    />
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto rounded-md border">
                  <Table>
                    <TableBody>
                      {rows.slice(0, MAX_ROWS).map((change) => (
                        <TableRow key={`${change.status}:${change.path}`}>
                          <TableCell className="w-16 sm:w-20">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px] font-normal',
                                STATUS_STYLES[change.status].className,
                              )}
                            >
                              {STATUS_STYLES[change.status].label}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-0 font-mono text-xs">
                            <div className="truncate" title={printablePath(change.path)}>
                              {printablePath(change.path)}
                            </div>
                            {/* On phones the size goes under the path, so the path keeps its width. */}
                            <div className="text-[11px] tabular-nums text-muted-foreground sm:hidden">
                              {changeSize(change)}
                            </div>
                          </TableCell>
                          <TableCell className="hidden w-40 text-right text-xs tabular-nums text-muted-foreground sm:table-cell">
                            {changeSize(change)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {rows.length === 0 ? (
                    <p className="p-4 text-center text-xs text-muted-foreground">
                      No matching files.
                    </p>
                  ) : null}
                </div>
                {rows.length > MAX_ROWS ? (
                  <p className="text-xs text-muted-foreground">
                    Showing {MAX_ROWS} of {rows.length} {filtered ? 'matching ' : ''}files. Filter
                    to find the rest.
                  </p>
                ) : null}
                {diff.unlistedChanges > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {diff.unlistedChanges.toLocaleString('en-US')} more changed files are counted
                    above but not listed here or in <code>otakit diff --json</code>, which list the
                    first {diff.changes.length.toLocaleString('en-US')}.
                  </p>
                ) : null}
              </section>
            ) : summary && diff.base ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No file changes.
              </p>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
