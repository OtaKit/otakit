'use client';

import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { configName, formatShare, request, type ApiError } from '@/app/components/experiment-ui';
import {
  CONTROL_KEY,
  MAX_SECONDARY_GOALS,
  MAX_VARIANTS,
  validateExperimentDefinition,
  type ExperimentVariant,
} from '@/lib/experiments';
import type { AppEventList } from '@/lib/services/app-events';
import type { ExperimentEstimate, ExperimentSummary } from '@/lib/services/experiments';
import type { RemoteConfigState } from '@/lib/services/remote-config';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const BASE = '__base__';
const BASE_CHANNEL = '__base_channel__';

type VariantDraft = { key: string; weight: string; overrides: string };

type Draft = {
  name: string;
  key: string;
  keyEdited: boolean;
  file: string;
  someChannels: boolean;
  audience: string[];
  runtimeVersions: string;
  traffic: string;
  variants: VariantDraft[];
  goalEvent: string;
  secondaryEvents: string;
};

function keyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function draftOf(experiment: ExperimentSummary | null, duplicate: boolean): Draft {
  if (!experiment) {
    return {
      name: '',
      key: '',
      keyEdited: false,
      file: BASE,
      someChannels: false,
      audience: [],
      runtimeVersions: '',
      traffic: '100',
      variants: [
        { key: CONTROL_KEY, weight: '50', overrides: '{}' },
        { key: 'b', weight: '50', overrides: '{}' },
      ],
      goalEvent: '',
      secondaryEvents: '',
    };
  }
  return {
    name: duplicate ? `${experiment.name} (again)`.slice(0, 100) : experiment.name,
    key: experiment.key,
    keyEdited: true,
    file: experiment.channel ?? BASE,
    someChannels: experiment.audienceChannels !== null,
    audience: (experiment.audienceChannels ?? []).map((channel) => channel ?? BASE_CHANNEL),
    runtimeVersions: experiment.runtimeVersions.join(', '),
    traffic: String(experiment.trafficPercent),
    variants: experiment.variants.map((variant) => ({
      key: variant.key,
      weight: String(variant.weight),
      overrides: JSON.stringify(variant.overrides, null, 2),
    })),
    goalEvent: experiment.goalEvent,
    secondaryEvents: experiment.secondaryEvents.join(', '),
  };
}

/** The request body, or an error message for the first problem. */
function definitionOf(draft: Draft): { body: Record<string, unknown> } | { error: string } {
  const variants: ExperimentVariant[] = [];
  for (const variant of draft.variants) {
    let overrides: unknown;
    try {
      overrides = JSON.parse(variant.overrides.trim() || '{}');
    } catch {
      return { error: `The overrides of "${variant.key || 'a variant'}" are not valid JSON` };
    }
    variants.push({
      key: variant.key.trim(),
      weight: Number(variant.weight),
      overrides: overrides as ExperimentVariant['overrides'],
    });
  }
  const body: Record<string, unknown> = {
    key: draft.key.trim(),
    name: draft.name,
    channel: draft.file === BASE ? null : draft.file,
    audienceChannels:
      draft.file === BASE && draft.someChannels
        ? draft.audience.map((channel) => (channel === BASE_CHANNEL ? null : channel))
        : null,
    runtimeVersions: draft.runtimeVersions
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    trafficPercent: Number(draft.traffic),
    variants,
    goalEvent: draft.goalEvent.trim(),
    secondaryEvents: draft.secondaryEvents
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
  const validation = validateExperimentDefinition(body, body.channel as string | null);
  return validation.ok ? { body } : { error: validation.error };
}

/** Create a test, edit a draft, or start a new one from an earlier test. */
export function ExperimentEditorDialog({
  appId,
  experiment,
  duplicate = false,
  releaseChannels,
  onClose,
  onSaved,
  onUpgrade,
}: {
  appId: string;
  /** The draft to edit, or the test to start from; null for a new test. */
  experiment: ExperimentSummary | null;
  duplicate?: boolean;
  releaseChannels: string[];
  onClose: () => void;
  onSaved: (experiment: ExperimentSummary, started: boolean) => void;
  onUpgrade?: () => void;
}) {
  const editing = experiment !== null && !duplicate;
  const [draft, setDraft] = useState<Draft>(() => draftOf(experiment, duplicate));
  const [configs, setConfigs] = useState<RemoteConfigState[] | null>(null);
  const [eventNames, setEventNames] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<ExperimentEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);

  useEffect(() => {
    void request<{ configs: RemoteConfigState[] }>(`/api/v1/apps/${appId}/config/channels`)
      .then((result) => setConfigs(result.configs))
      .catch(() => setConfigs([]));
    void request<AppEventList>(`/api/v1/apps/${appId}/analytics/events?range=30d`)
      .then((result) => setEventNames(result.events.map((event) => event.name)))
      .catch(() => setEventNames([]));
  }, [appId]);

  const files = useMemo(() => {
    const live = (configs ?? [])
      .filter((config) => config.channel !== null && config.status === 'live')
      .map((config) => config.channel as string);
    return [BASE, ...live];
  }, [configs]);
  const fileConfig = configs?.find((config) => (config.channel ?? BASE) === draft.file) ?? null;
  const fileKeys = Object.keys(fileConfig?.status === 'live' ? (fileConfig.values ?? {}) : {});
  const audienceOptions = useMemo(() => [BASE_CHANNEL, ...releaseChannels], [releaseChannels]);

  const goal = draft.goalEvent.trim();
  const estimateChannel = draft.file === BASE ? null : draft.file;
  useEffect(() => {
    if (!/^(?=.*[A-Za-z0-9])[A-Za-z0-9_.:-]{1,64}$/.test(goal)) {
      setEstimate(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ goal });
      if (estimateChannel) query.set('channel', estimateChannel);
      fetch(`/api/v1/apps/${appId}/experiments/estimate?${query}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((result: ExperimentEstimate | null) => setEstimate(result))
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [appId, goal, estimateChannel]);

  const update = (change: Partial<Draft>) => {
    setError(null);
    setDraft((current) => ({ ...current, ...change }));
  };
  const updateVariant = (index: number, change: Partial<VariantDraft>) => {
    setError(null);
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant, at) =>
        at === index ? { ...variant, ...change } : variant,
      ),
    }));
  };
  const splitEvenly = (variants = draft.variants) => {
    const share = Math.floor(100 / variants.length);
    const rest = 100 - share * variants.length;
    return variants.map((variant, index) => ({
      ...variant,
      weight: String(share + (index === 0 ? rest : 0)),
    }));
  };
  const totalWeight = draft.variants.reduce(
    (sum, variant) => sum + (Number(variant.weight) || 0),
    0,
  );

  async function save(start: boolean) {
    const definition = definitionOf(draft);
    if ('error' in definition) {
      setError(definition.error);
      return;
    }
    setBusy(true);
    setError(null);
    let saved: ExperimentSummary | null = null;
    try {
      saved = editing
        ? (
            await request<{ experiment: ExperimentSummary }>(
              `/api/v1/apps/${appId}/experiments/${experiment!.id}`,
              { method: 'PATCH', body: JSON.stringify(definition.body) },
            )
          ).experiment
        : (
            await request<{ experiment: ExperimentSummary }>(`/api/v1/apps/${appId}/experiments`, {
              method: 'POST',
              body: JSON.stringify(definition.body),
            })
          ).experiment;
      if (start) {
        const started = await request<{ experiment: ExperimentSummary }>(
          `/api/v1/apps/${appId}/experiments/${saved.id}/start`,
          { method: 'POST' },
        );
        toast.success(`${started.experiment.key} is running`);
        onSaved(started.experiment, true);
      } else {
        toast.success(editing ? 'Draft saved' : `Draft ${saved.key} created`);
        onSaved(saved, false);
      }
    } catch (failure) {
      const apiError = failure as ApiError;
      const upgrade =
        apiError.code === 'PLAN_REQUIRED' && onUpgrade
          ? { action: { label: 'Upgrade', onClick: onUpgrade } }
          : undefined;
      if (saved) {
        // Saved, but it did not start: the draft is kept.
        toast.error(`Saved as a draft, but it did not start: ${apiError.message}`, upgrade);
        onSaved(saved, false);
      } else {
        setError(apiError.message);
        if (upgrade) toast.error('A/B tests need a paid plan', upgrade);
      }
    } finally {
      setBusy(false);
      setConfirmStart(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit draft' : 'New A/B test'}</DialogTitle>
          <DialogDescription>
            Each device gets a variant and keeps it. Variants change config values; code can also
            branch on the variant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="experiment-name">Name</Label>
              <Input
                id="experiment-name"
                value={draft.name}
                placeholder="Paywall title"
                maxLength={100}
                onChange={(event) =>
                  update({
                    name: event.target.value,
                    ...(draft.keyEdited ? {} : { key: keyFromName(event.target.value) }),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="experiment-key">Key</Label>
              <Input
                id="experiment-key"
                value={draft.key}
                placeholder="paywall_title"
                className="font-mono text-xs"
                maxLength={40}
                onChange={(event) => update({ key: event.target.value, keyEdited: true })}
              />
              <p className="text-[11px] text-muted-foreground">
                For <code>getVariant()</code>: lowercase letters, digits, _ and -.
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-sm font-medium">Who is in the test</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Config</Label>
                <Select value={draft.file} onValueChange={(file) => update({ file })}>
                  <SelectTrigger className="w-full" aria-label="Config">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {files.map((file) => (
                      <SelectItem key={file} value={file}>
                        {configName(file === BASE ? null : file)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {draft.file === BASE
                    ? 'Devices of every channel without its own config.'
                    : `Devices on ${draft.file}.`}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experiment-traffic">Devices in the test</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="experiment-traffic"
                    type="number"
                    min={1}
                    max={100}
                    value={draft.traffic}
                    className="w-24"
                    onChange={(event) => update({ traffic: event.target.value })}
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The rest keep the normal values and are not counted.
                </p>
              </div>
            </div>

            {draft.file === BASE ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.someChannels}
                    onCheckedChange={(checked) => update({ someChannels: checked === true })}
                  />
                  Only devices on some channels
                </label>
                {draft.someChannels ? (
                  <div className="flex flex-wrap gap-3 pl-6">
                    {audienceOptions.map((channel) => (
                      <label key={channel} className="flex items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={draft.audience.includes(channel)}
                          onCheckedChange={(checked) =>
                            update({
                              audience:
                                checked === true
                                  ? [...draft.audience, channel]
                                  : draft.audience.filter((value) => value !== channel),
                            })
                          }
                        />
                        {channel === BASE_CHANNEL ? 'base channel' : channel}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="experiment-runtimes">Runtime versions (optional)</Label>
              <Input
                id="experiment-runtimes"
                value={draft.runtimeVersions}
                placeholder="Every runtime version"
                onChange={(event) => update({ runtimeVersions: event.target.value })}
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Variants</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => update({ variants: splitEvenly() })}
                >
                  Split evenly
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={draft.variants.length >= MAX_VARIANTS}
                  onClick={() => {
                    const used = new Set(draft.variants.map((variant) => variant.key));
                    const key = 'bcdefgh'.split('').find((letter) => !used.has(letter)) ?? 'v';
                    update({
                      variants: splitEvenly([
                        ...draft.variants,
                        { key, weight: '0', overrides: '{}' },
                      ]),
                    });
                  }}
                >
                  <Plus className="size-3" />
                  Variant
                </Button>
              </div>
            </div>
            {fileKeys.length > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Keys in the {configName(draft.file === BASE ? null : draft.file).toLowerCase()}:{' '}
                <span className="font-mono">{fileKeys.slice(0, 12).join(', ')}</span>
                {fileKeys.length > 12 ? ' …' : ''}
              </p>
            ) : null}
            <div className="space-y-3">
              {draft.variants.map((variant, index) => (
                <div key={index} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Variant key"
                      value={variant.key}
                      disabled={index === 0}
                      className="h-8 w-36 font-mono text-xs"
                      onChange={(event) => updateVariant(index, { key: event.target.value })}
                    />
                    <Input
                      aria-label="Weight"
                      type="number"
                      min={1}
                      max={99}
                      value={variant.weight}
                      className="h-8 w-20"
                      onChange={(event) => updateVariant(index, { weight: event.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                    {index >= 2 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="ml-auto size-8 text-muted-foreground"
                        aria-label={`Remove ${variant.key}`}
                        onClick={() =>
                          update({
                            variants: splitEvenly(draft.variants.filter((_, at) => at !== index)),
                          })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  {index === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Control keeps the normal config values.
                    </p>
                  ) : (
                    <Textarea
                      aria-label={`Overrides of ${variant.key}`}
                      value={variant.overrides}
                      rows={3}
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder={'{ "paywallTitle": "Unlock everything" }'}
                      onChange={(event) => updateVariant(index, { overrides: event.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Weights add up to {totalWeight}% (must be 100). Overrides replace config values for
              devices in the variant; leave them empty (<code>{'{}'}</code>) for a test your code
              reads with <code>getVariant()</code>.
            </p>
          </section>

          <section className="space-y-3">
            <p className="text-sm font-medium">Goal</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="experiment-goal">Goal event</Label>
                <Input
                  id="experiment-goal"
                  list="experiment-events"
                  value={draft.goalEvent}
                  placeholder="purchase_completed"
                  className="font-mono text-xs"
                  onChange={(event) => update({ goalEvent: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experiment-secondary">
                  Other goals (up to {MAX_SECONDARY_GOALS}, optional)
                </Label>
                <Input
                  id="experiment-secondary"
                  value={draft.secondaryEvents}
                  placeholder="signup, share_tapped"
                  className="font-mono text-xs"
                  onChange={(event) => update({ secondaryEvents: event.target.value })}
                />
              </div>
            </div>
            <datalist id="experiment-events">
              {eventNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <p className="text-[11px] text-muted-foreground">
              A device converts when it tracks the goal with <code>track()</code> after it first
              used the test. Devices with an error after that count against the variant.
            </p>
            {estimate && goal ? (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {estimate.launchesPerDay === null || estimate.goalShare === null ? (
                  <>
                    No app launches recorded in the last 14 days. Call <code>initAnalytics()</code>{' '}
                    to see an estimate.
                  </>
                ) : estimate.goalShare === 0 ? (
                  <>
                    No <span className="font-mono">{goal}</span> events in the last 14 days. Send it
                    with <code>track()</code>, or results stay empty.
                  </>
                ) : (
                  <>
                    Last 14 days: about {estimate.launchesPerDay.toLocaleString('en-US')} app
                    launches a day; <span className="font-mono">{goal}</span> happened in{' '}
                    {formatShare(estimate.goalShare)} of them.
                    {estimate.plannedPerVariant
                      ? ` To detect a 20% change, plan for about ${estimate.plannedPerVariant.toLocaleString('en-US')} devices per variant (a rough guide).`
                      : ''}
                  </>
                )}
              </p>
            ) : null}
          </section>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => void save(false)} disabled={busy}>
            {editing ? 'Save draft' : 'Save as draft'}
          </Button>
          <Button
            onClick={() => {
              const definition = definitionOf(draft);
              if ('error' in definition) setError(definition.error);
              else setConfirmStart(true);
            }}
            disabled={busy}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            Start test
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmStart} onOpenChange={(open) => !open && setConfirmStart(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start {draft.key}?</AlertDialogTitle>
            <AlertDialogDescription>
              Devices on plugin 3.4+ that read the{' '}
              {configName(draft.file === BASE ? null : draft.file).toLowerCase()} get their variant
              on their next config fetch. While it runs, only its name can change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void save(true)}>
              Start test
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
