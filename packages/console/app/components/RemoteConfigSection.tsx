'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Braces,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { CopyButton } from '@/app/components/CopyButton';
import { InfoHint } from '@/app/components/InfoHint';
import {
  configKeyChanges,
  MAX_CONFIG_MESSAGE_LENGTH,
  validateConfigValues,
  type ConfigValues,
} from '@/lib/remote-config';
import type { RemoteConfigHistoryEntry, RemoteConfigState } from '@/lib/services/remote-config';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const BASE = '__base__';
const CHANNEL_NAME = /^[A-Za-z0-9._-]{1,64}$/;

type ApiError = Error & { status?: number; code?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string })
    | null;
  if (!response.ok || !body) {
    const error = new Error(body?.error ?? 'Request failed') as ApiError;
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body;
}

function keyOf(channel: string | null): string {
  return channel ?? BASE;
}

function channelOf(key: string): string | null {
  return key === BASE ? null : key;
}

function channelName(channel: string | null): string {
  return channel ?? 'base';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function preview(value: unknown, length = 120): string {
  const text = JSON.stringify(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** A starting point for `getConfig({ defaults })` with the config's own keys. */
function snippet(values: ConfigValues | null): string {
  const defaults = Object.keys(values ?? {}).length > 0 ? values : { checkoutEnabled: true };
  const body = JSON.stringify(defaults, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');
  return [
    "import { OtaKit } from '@otakit/capacitor-updater';",
    '',
    'const { values } = await OtaKit.getConfig({',
    `  defaults: ${body},`,
    '});',
    "OtaKit.addListener('configChanged', ({ values }) => apply(values));",
  ].join('\n');
}

function staleOrFailure(error: unknown, fallback: string): string {
  const failure = error as ApiError;
  if (failure.code === 'STALE_CONFIG_VERSION') {
    return 'The config changed while you were editing. It has been reloaded; apply your change again.';
  }
  return failure.message || fallback;
}

/**
 * Remote config of the selected app: values per channel that apps read with
 * OtaKit.getConfig() (plugin 3.4+), with editing, history and restore.
 */
export function RemoteConfigSection({
  appId,
  releaseChannels,
  docsUrl,
}: {
  appId: string;
  /** Channels that have releases, offered when adding a channel's config. */
  releaseChannels: string[];
  docsUrl: string;
}) {
  const [configs, setConfigs] = useState<RemoteConfigState[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string>(BASE);
  const [editing, setEditing] = useState<{ channel: string | null } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<RemoteConfigState | null>(null);
  const [addingChannel, setAddingChannel] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/apps/${appId}/config`;

  const load = useCallback(async () => {
    try {
      const result = await request<{ configs: RemoteConfigState[] }>(`${base}/channels`);
      setConfigs(result.configs);
      setLoadFailed(false);
    } catch (error) {
      setLoadFailed(true);
      toast.error(error instanceof Error ? error.message : 'Could not load remote config');
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = useMemo(
    () => new Map((configs ?? []).map((config) => [keyOf(config.channel), config])),
    [configs],
  );
  const baseConfig = byKey.get(BASE) ?? null;
  const current: RemoteConfigState | null = configs
    ? (byKey.get(selected) ?? {
        appId,
        channel: channelOf(selected),
        version: 0,
        status: 'none',
        values: null,
        message: null,
        updatedBy: null,
        updatedAt: null,
        usesBaseConfig: selected !== BASE,
        publicationStatus: 'published',
        fileUrl: null,
      })
    : null;
  const chips = useMemo(() => {
    const keys = new Set<string>([BASE, ...(configs ?? []).map((config) => keyOf(config.channel))]);
    if (selected !== BASE) keys.add(selected);
    return [
      BASE,
      ...Array.from(keys)
        .filter((key) => key !== BASE)
        .sort(),
    ];
  }, [configs, selected]);

  async function remove(config: RemoteConfigState) {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        channel: config.channel ?? '',
        expectedVersion: String(config.version),
      });
      await request(`${base}?${params}`, { method: 'DELETE' });
      toast.success(
        config.channel === null
          ? 'Base config deleted'
          : `${config.channel} now uses the base config`,
      );
    } catch (error) {
      toast.error(staleOrFailure(error, 'Could not delete the config'));
    } finally {
      setBusy(false);
      setDeleting(null);
      await load();
    }
  }

  const live = current?.status === 'live';
  const values = live ? (current?.values ?? {}) : null;

  return (
    <section>
      <div className="mx-auto max-w-screen-xl bg-muted/30">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
          <div className="mr-5 flex items-center gap-3">
            <Braces className="size-6 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[15px] font-semibold leading-tight">Remote config</h2>
              <p className="text-xs leading-tight text-muted-foreground">
                Values your app reads without a release
              </p>
            </div>
          </div>
          <InfoHint label="About remote config">
            <p className="text-xs">
              A JSON object per channel. Apps on plugin 3.4+ read it with{' '}
              <code>OtaKit.getConfig()</code> and pick up changes at launch or when they return to
              the foreground. A channel without its own config uses the base channel&apos;s.{' '}
              <a
                href={`${docsUrl}/remote-config`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Docs
              </a>
            </p>
          </InfoHint>
        </div>

        {!configs || !current ? (
          <div className="flex justify-center border-b border-border bg-background p-8">
            {loadFailed ? (
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-3.5" />
                Try again
              </Button>
            ) : (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
        ) : (
          <div className="space-y-4 border-b border-border bg-background px-6 py-5">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Channel">
              {chips.map((key) => {
                const config = byKey.get(key);
                const active = key === selected;
                const note =
                  config?.status === 'live'
                    ? `v${config.version}`
                    : key === BASE
                      ? 'none'
                      : 'uses base';
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelected(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                      active
                        ? 'border-foreground/30 bg-secondary font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {channelName(channelOf(key))}
                    <span className="text-[10px] text-muted-foreground">{note}</span>
                  </button>
                );
              })}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setAddingChannel(true)}
              >
                <Plus className="size-3" />
                Channel
              </Button>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1 text-sm">
                {live ? (
                  <>
                    <p>
                      <span className="font-medium">Version {current.version}</span>
                      <span className="text-muted-foreground">
                        {current.updatedBy ? ` · ${current.updatedBy}` : ''}
                        {current.updatedAt ? ` · ${formatDate(current.updatedAt)}` : ''}
                      </span>
                    </p>
                    {current.message ? (
                      <p className="text-xs text-muted-foreground">“{current.message}”</p>
                    ) : null}
                    {current.publicationStatus === 'pending' ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Publishing to the CDN is pending; OtaKit retries within minutes.
                      </p>
                    ) : null}
                  </>
                ) : current.channel === null ? (
                  <p className="text-muted-foreground">
                    {current.status === 'deleted'
                      ? 'The base config was deleted. Apps use their code defaults.'
                      : 'No config yet. Apps use their code defaults until you publish one.'}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    Devices on{' '}
                    <span className="font-medium text-foreground">{current.channel}</span> use the
                    base channel&apos;s config
                    {baseConfig?.status === 'live' ? ` (version ${baseConfig.version})` : ''}. Give
                    it its own config to override it.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={live ? 'outline' : 'default'}
                  onClick={() => setEditing({ channel: current.channel })}
                >
                  {live ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
                  {live
                    ? 'Edit'
                    : current.channel === null
                      ? 'Create config'
                      : `Create ${current.channel} config`}
                </Button>
                {current.version > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setHistoryFor(current.channel)}>
                    <History className="size-3.5" />
                    History
                  </Button>
                ) : null}
                {live ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy}
                    onClick={() => setDeleting(current)}
                  >
                    <Trash2 className="size-3.5" />
                    {current.channel === null ? 'Delete' : 'Use base config'}
                  </Button>
                ) : null}
              </div>
            </div>

            {values ? (
              Object.keys(values).length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  An empty object: apps use their defaults for every key.
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border">
                  <Table>
                    <TableBody>
                      {Object.entries(values).map(([key, value]) => (
                        <TableRow key={key}>
                          <TableCell
                            className="w-1/3 max-w-0 truncate font-mono text-xs"
                            title={key}
                          >
                            {key}
                          </TableCell>
                          <TableCell className="max-w-0 truncate font-mono text-xs text-muted-foreground">
                            {preview(value, 200)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : null}

            <details className="group text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Read it in your app
              </summary>
              <div className="relative mt-2 rounded-md border bg-muted/30 p-3">
                <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
                  {snippet(values)}
                </pre>
                <div className="absolute right-2 top-2">
                  <CopyButton value={snippet(values)} label="Copy code" />
                </div>
              </div>
            </details>
          </div>
        )}
      </div>

      {editing && configs ? (
        <ConfigEditorDialog
          key={keyOf(editing.channel)}
          base={base}
          state={
            byKey.get(keyOf(editing.channel)) ??
            (current && keyOf(current.channel) === keyOf(editing.channel) ? current : null)
          }
          channel={editing.channel}
          template={
            editing.channel !== null && baseConfig?.status === 'live' ? baseConfig.values : null
          }
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onStale={load}
        />
      ) : null}

      {historyFor !== undefined ? (
        <HistoryDialog
          base={base}
          channel={historyFor}
          currentVersion={byKey.get(keyOf(historyFor))?.version ?? 0}
          onClose={() => setHistoryFor(undefined)}
          onRestored={async () => {
            setHistoryFor(undefined);
            await load();
          }}
          onStale={load}
        />
      ) : null}

      <AddChannelDialog
        open={addingChannel}
        existing={chips}
        suggestions={releaseChannels}
        onClose={() => setAddingChannel(false)}
        onAdd={(channel) => {
          setAddingChannel(false);
          setSelected(channel);
        }}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.channel === null
                ? 'Delete the base config?'
                : `Stop using a separate config for ${deleting?.channel}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.channel === null
                ? 'Apps will use their code defaults, and channels without their own config too. History is kept, so you can restore it.'
                : `Devices on ${deleting?.channel} will use the base channel's config. History is kept, so you can restore it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void remove(deleting);
              }}
            >
              {deleting?.channel === null ? 'Delete' : 'Use base config'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ConfigEditorDialog({
  base,
  state,
  channel,
  template,
  onClose,
  onSaved,
  onStale,
}: {
  base: string;
  state: RemoteConfigState | null;
  channel: string | null;
  /** Values to start a new channel config from (the base config). */
  template: ConfigValues | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onStale: () => Promise<void>;
}) {
  const live = state?.status === 'live';
  const before = live ? (state?.values ?? {}) : null;
  const [text, setText] = useState(() => JSON.stringify(before ?? template ?? {}, null, 2));
  const [message, setMessage] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'Invalid JSON' };
    }
  }, [text]);
  const validation = parsed.ok ? validateConfigValues(parsed.value) : null;
  const error = !parsed.ok
    ? `Not valid JSON: ${parsed.error}`
    : validation && !validation.ok
      ? validation.error
      : null;
  const changes = validation?.ok === true ? configKeyChanges(before, validation.values) : null;
  const unchanged =
    changes !== null &&
    live &&
    changes.added.length + changes.changed.length + changes.removed.length === 0;

  async function publish() {
    if (validation?.ok !== true) return;
    setSaving(true);
    try {
      const result = await request<{ changed: boolean; config: RemoteConfigState }>(base, {
        method: 'PUT',
        body: JSON.stringify({
          channel,
          values: validation.values,
          expectedVersion: state?.version ?? 0,
          message: message.trim() || undefined,
        }),
      });
      toast.success(
        result.changed
          ? `Version ${result.config.version} published to ${channelName(channel)}`
          : 'Nothing changed',
      );
      await onSaved();
    } catch (failure) {
      const apiError = failure as ApiError;
      toast.error(staleOrFailure(failure, 'Could not publish the config'));
      if (apiError.code === 'STALE_CONFIG_VERSION') {
        await onStale();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {reviewing ? 'Review changes' : live ? 'Edit config' : 'Create config'} ·{' '}
            {channelName(channel)}
          </DialogTitle>
          <DialogDescription>
            {reviewing
              ? `Apps on plugin 3.4+ get version ${(state?.version ?? 0) + 1} on their next fetch: at launch, or when they return to the foreground.`
              : 'A JSON object. Top-level keys become `values.key` in getConfig().'}
          </DialogDescription>
        </DialogHeader>

        {reviewing && changes && validation?.ok ? (
          <div className="space-y-3">
            <ul className="space-y-1 break-all rounded-md border p-3 font-mono text-xs">
              {changes.added.map((key) => (
                <li key={`+${key}`} className="text-emerald-600 dark:text-emerald-400">
                  + {key}: {preview(validation.values[key])}
                </li>
              ))}
              {changes.changed.map((key) => (
                <li key={`~${key}`} className="text-sky-600 dark:text-sky-400">
                  ~ {key}: {preview(before?.[key], 60)} → {preview(validation.values[key], 60)}
                </li>
              ))}
              {changes.removed.map((key) => (
                <li key={`-${key}`} className="text-muted-foreground line-through">
                  - {key}: {preview(before?.[key])}
                </li>
              ))}
              {changes.added.length + changes.changed.length + changes.removed.length === 0 ? (
                <li className="text-muted-foreground">An empty config.</li>
              ) : null}
            </ul>
            {message.trim() ? (
              <p className="text-xs text-muted-foreground">“{message.trim()}”</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <Textarea
              aria-label="Config JSON"
              value={text}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              className="min-h-64 font-mono text-xs"
            />
            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {validation?.ok && validation.warnings.length > 0 ? (
              <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                {validation.warnings.map((warning) => (
                  <li key={warning.key} className="flex items-start gap-1.5">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {warning.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Config is public: anyone with your app can read it. Never put secrets here.
            </p>
            <div className="space-y-2">
              <Label htmlFor="config-message">What changes (optional)</Label>
              <Input
                id="config-message"
                value={message}
                maxLength={MAX_CONFIG_MESSAGE_LENGTH}
                placeholder="Disable checkout during the partner outage"
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {reviewing ? (
            <>
              <Button variant="outline" onClick={() => setReviewing(false)} disabled={saving}>
                Back
              </Button>
              <Button onClick={() => void publish()} disabled={saving}>
                {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                Publish version {(state?.version ?? 0) + 1}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={error !== null || unchanged} onClick={() => setReviewing(true)}>
                {unchanged ? 'No changes' : 'Review changes'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  base,
  channel,
  currentVersion,
  onClose,
  onRestored,
  onStale,
}: {
  base: string;
  channel: string | null;
  currentVersion: number;
  onClose: () => void;
  onRestored: () => Promise<void>;
  /** The config changed meanwhile: reload it so a retry uses the new version. */
  onStale: () => Promise<void>;
}) {
  const [versions, setVersions] = useState<RemoteConfigHistoryEntry[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ channel: channel ?? '' });
    request<{ versions: RemoteConfigHistoryEntry[] }>(`${base}/history?${params}`)
      .then((result) => setVersions(result.versions))
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Could not load history');
        setVersions([]);
      });
  }, [base, channel]);

  async function restore(version: number) {
    setRestoring(version);
    try {
      const result = await request<{ changed: boolean; config: RemoteConfigState }>(
        `${base}/restore`,
        {
          method: 'POST',
          body: JSON.stringify({ channel, version, expectedVersion: currentVersion }),
        },
      );
      toast.success(
        result.changed
          ? `Restored version ${version} as version ${result.config.version}`
          : `Version ${version} is already live`,
      );
      await onRestored();
    } catch (error) {
      toast.error(staleOrFailure(error, 'Could not restore'));
      if ((error as ApiError).code === 'STALE_CONFIG_VERSION') {
        onClose();
        await onStale();
      }
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            History · {channelName(channel)}
          </DialogTitle>
          <DialogDescription>
            The last 50 versions. Restoring publishes the old values as a new version.
          </DialogDescription>
        </DialogHeader>
        {versions === null ? (
          <div className="flex justify-center p-8">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {versions.map((entry) => (
              <li key={entry.version} className="space-y-2 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-expanded={open === entry.version}
                    className="flex min-w-0 items-center gap-2 text-left"
                    disabled={entry.deleted}
                    onClick={() => setOpen(open === entry.version ? null : entry.version)}
                  >
                    <span className="font-medium">v{entry.version}</span>
                    {entry.version === currentVersion ? (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        Current
                      </Badge>
                    ) : null}
                    {entry.deleted ? (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        Deleted
                      </Badge>
                    ) : null}
                    <span className="truncate text-xs text-muted-foreground">
                      {formatDate(entry.createdAt)} · {entry.createdBy}
                    </span>
                  </button>
                  {!entry.deleted && entry.version !== currentVersion ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={restoring !== null}
                      onClick={() => void restore(entry.version)}
                    >
                      {restoring === entry.version ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3" />
                      )}
                      Restore
                    </Button>
                  ) : null}
                </div>
                {entry.message ? (
                  <p className="text-xs text-muted-foreground">“{entry.message}”</p>
                ) : null}
                {open === entry.version && entry.values ? (
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(entry.values, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddChannelDialog({
  open,
  existing,
  suggestions,
  onClose,
  onAdd,
}: {
  open: boolean;
  existing: string[];
  suggestions: string[];
  onClose: () => void;
  onAdd: (channel: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const valid =
    CHANNEL_NAME.test(trimmed) &&
    !trimmed.toLowerCase().startsWith('__preview') &&
    !['base', 'default', BASE].includes(trimmed.toLowerCase());
  const offered = suggestions.filter((channel) => !existing.includes(channel));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('');
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Config for a channel</DialogTitle>
          <DialogDescription>
            Devices on a channel without its own config use the base config. Give a channel its own
            config to change values only there.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            aria-label="Channel name"
            value={name}
            placeholder="beta"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) onAdd(trimmed);
            }}
          />
          {offered.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {offered.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => onAdd(channel)}
                >
                  {channel}
                </button>
              ))}
            </div>
          ) : null}
          {trimmed && !valid ? (
            <p className="text-xs text-destructive">
              Use 1-64 letters, digits, &quot;.&quot;, &quot;_&quot; or &quot;-&quot;.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={() => onAdd(trimmed)}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
