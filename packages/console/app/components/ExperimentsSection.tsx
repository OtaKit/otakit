'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, LoaderCircle, Plus, RefreshCw } from 'lucide-react';

import { CommandBlock } from '@/app/components/CommandBlock';
import { ExperimentEditorDialog } from '@/app/components/ExperimentEditorDialog';
import { ExperimentResultsDialog } from '@/app/components/ExperimentResultsDialog';
import {
  configName,
  ExperimentStatusBadge,
  formatDay,
  request,
  verdictShort,
} from '@/app/components/experiment-ui';
import { InfoHint } from '@/app/components/InfoHint';
import type { ExperimentResults, ExperimentSummary } from '@/lib/services/experiments';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const SNIPPET = [
  "import { OtaKit, track } from '@otakit/capacitor-updater';",
  '',
  "// Config tests: getConfig() returns the values of the device's variant.",
  "const { values } = await OtaKit.getConfig({ defaults: { paywallTitle: 'Go Pro' } });",
  '',
  '// Code tests: branch on the variant.',
  "const variant = await OtaKit.getVariant('new_onboarding');",
  '',
  '// The goal:',
  "track('purchase_completed');",
].join('\n');

type Editor = { experiment: ExperimentSummary | null; duplicate: boolean };

/** The app's A/B tests: config values and code paths tested on real devices. */
export function ExperimentsSection({
  appId,
  releaseChannels,
  docsUrl,
  onUpgrade,
  onConfigChanged,
}: {
  appId: string;
  releaseChannels: string[];
  docsUrl: string;
  onUpgrade?: () => void;
  /** A test started, stopped or shipped: the config has a new version. */
  onConfigChanged?: () => void;
}) {
  const [experiments, setExperiments] = useState<ExperimentSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<Record<string, ExperimentResults>>({});
  const [editor, setEditor] = useState<Editor | null>(null);
  // A notification links here with ?experiment=<id>.
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('experiment'),
  );

  const [reloadToken, setReloadToken] = useState(0);
  const load = () => setReloadToken((value) => value + 1);

  useEffect(() => {
    let active = true;
    request<{ experiments: ExperimentSummary[] }>(`/api/v1/apps/${appId}/experiments`)
      .then(async ({ experiments: list }) => {
        if (!active) return;
        setExperiments(list);
        setFailed(false);
        // The verdicts of running tests, for the list.
        const loaded = await Promise.all(
          list
            .filter((experiment) => experiment.status === 'running')
            .map((experiment) =>
              request<ExperimentResults>(
                `/api/v1/apps/${appId}/experiments/${experiment.id}/results`,
              )
                .then((result) => [experiment.id, result] as const)
                .catch(() => null),
            ),
        );
        if (active) setResults(Object.fromEntries(loaded.filter((entry) => entry !== null)));
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [appId, reloadToken]);

  const open = (id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('experiment', id);
    else url.searchParams.delete('experiment');
    window.history.replaceState(null, '', url);
  };

  const changed = () => {
    onConfigChanged?.();
    load();
  };

  return (
    <section id="experiments">
      <div className="mx-auto max-w-screen-xl bg-muted/30">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
          <div className="mr-5 flex items-center gap-3">
            <FlaskConical className="size-6 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[15px] font-semibold leading-tight">A/B tests</h2>
              <p className="text-xs leading-tight text-muted-foreground">
                Config values and screens tested on real users
              </p>
            </div>
          </div>
          <InfoHint label="About A/B tests">
            <p className="text-xs">
              Each device gets a variant from a random number that stays on the device, and keeps
              it. Devices report once when they first use the test and once per goal after that, so
              results count devices without any device identifier. Needs plugin 3.4+.{' '}
              <a
                href={`${docsUrl}/experiments`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Docs
              </a>
            </p>
          </InfoHint>
          <div className="ml-auto flex items-center gap-2">
            {experiments && experiments.length > 0 ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Refresh A/B tests"
                onClick={load}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setEditor({ experiment: null, duplicate: false })}>
              <Plus className="size-3.5" />
              New test
            </Button>
          </div>
        </div>

        <div className="border-b border-border bg-background">
          {!experiments ? (
            <div className="flex justify-center p-8">
              {failed ? (
                <Button variant="outline" size="sm" onClick={load}>
                  <RefreshCw className="size-3.5" />
                  Try again
                </Button>
              ) : (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              )}
            </div>
          ) : experiments.length === 0 ? (
            <div className="px-6 py-6">
              <div className="rounded-lg border border-dashed p-5">
                <p className="text-sm font-medium">Test changes before everyone gets them</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Give part of your users another paywall title, onboarding or limit, and see which
                  variant reaches your goal event more often. No new store release, and no new SDK.
                </p>
                <CommandBlock className="mt-4" value={SNIPPET} label="Copy example code" />
              </div>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table className="table-fixed sm:min-w-[720px] [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-auto">Test</TableHead>
                    <TableHead className="w-32">Status</TableHead>
                    <TableHead className="hidden w-44 md:table-cell">Variants</TableHead>
                    <TableHead className="hidden w-44 sm:table-cell">Goal</TableHead>
                    <TableHead className="w-44 text-right">Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiments.map((experiment) => {
                    const result =
                      experiment.status === 'shipped'
                        ? `Shipped ${experiment.shippedVariant}`
                        : experiment.status === 'running'
                          ? (verdictShort(results[experiment.id]) ?? '…')
                          : experiment.status === 'stopped'
                            ? 'Stopped'
                            : 'Not started';
                    const openRow = () =>
                      experiment.status === 'draft'
                        ? setEditor({ experiment, duplicate: false })
                        : open(experiment.id);
                    return (
                      <TableRow
                        key={experiment.id}
                        className="cursor-pointer"
                        tabIndex={0}
                        onClick={openRow}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openRow();
                          }
                        }}
                      >
                        <TableCell className="py-2.5">
                          <p className="truncate text-sm font-medium" title={experiment.name}>
                            {experiment.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">{experiment.key}</span> ·{' '}
                            {configName(experiment.channel)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <ExperimentStatusBadge status={experiment.status} />
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {experiment.status === 'draft'
                              ? `Created ${formatDay(experiment.createdAt)}`
                              : experiment.stoppedAt
                                ? `Ended ${formatDay(experiment.stoppedAt)}`
                                : `Since ${formatDay(experiment.startedAt)}`}
                          </p>
                        </TableCell>
                        <TableCell className="hidden truncate text-xs text-muted-foreground md:table-cell">
                          {experiment.variants
                            .map((variant) => `${variant.key} ${variant.weight}%`)
                            .join(' · ')}
                        </TableCell>
                        <TableCell className="hidden truncate font-mono text-xs sm:table-cell">
                          {experiment.goalEvent}
                        </TableCell>
                        <TableCell className="text-right text-xs">{result}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>

      {editor ? (
        <ExperimentEditorDialog
          key={editor.experiment?.id ?? 'new'}
          appId={appId}
          experiment={editor.experiment}
          duplicate={editor.duplicate}
          releaseChannels={releaseChannels}
          onUpgrade={onUpgrade}
          onClose={() => setEditor(null)}
          onSaved={(experiment, started) => {
            setEditor(null);
            if (started) {
              changed();
              open(experiment.id);
            } else {
              load();
            }
          }}
        />
      ) : null}

      {openId ? (
        <ExperimentResultsDialog
          key={openId}
          appId={appId}
          experimentId={openId}
          onClose={() => open(null)}
          onChanged={changed}
          onEdit={(experiment) => {
            open(null);
            setEditor({ experiment, duplicate: false });
          }}
          onDuplicate={(experiment) => {
            open(null);
            setEditor({ experiment, duplicate: true });
          }}
        />
      ) : null}
    </section>
  );
}
