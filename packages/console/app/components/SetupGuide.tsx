'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  CircleDashed,
  LoaderCircle,
  Minus,
  Rocket,
  Sparkles,
  Terminal,
} from 'lucide-react';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import { CopyButton } from '@/app/components/CopyButton';
import { useStoredPreference } from '@/app/components/useStoredPreference';
import type {
  OnboardingSnapshot,
  SetupDiagnosis,
  SetupStepStatus,
} from '@/lib/services/onboarding';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Fast while a device is expected to report in, unhurried the rest of the time. */
const POLL_WAITING_MS = 5_000;
const POLL_IDLE_MS = 15_000;

const CLIENT_STORAGE_KEY = 'otakit.setup.client';

type ClientId = 'claude' | 'codex' | 'other';

function isClientId(value: string | null): value is ClientId {
  return value === 'claude' || value === 'codex' || value === 'other';
}

const CLIENT_TABS: { id: ClientId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'other', label: 'Other MCP client' },
];

/**
 * `connect` signs in and writes the MCP server into the project in one step.
 * The Claude path installs the plugin instead, because that also brings the
 * OtaKit Skill along with the tools.
 */
const CONNECT_COMMANDS: Record<ClientId, { label: string; command: string }[]> = {
  claude: [
    { label: 'Add the OtaKit marketplace', command: 'claude plugin marketplace add OtaKit/otakit' },
    { label: 'Install the plugin and Skill', command: 'claude plugin install otakit@otakit' },
    { label: 'Sign in', command: 'npx -y @otakit/cli@latest login' },
  ],
  codex: [
    {
      label: 'Connect this project to Codex',
      command: 'npx -y @otakit/cli@latest connect --client codex',
    },
  ],
  other: [
    { label: 'Sign in', command: 'npx -y @otakit/cli@latest login' },
    { label: 'Run OtaKit as an MCP server', command: 'npx -y @otakit/cli@latest mcp' },
  ],
};

/**
 * Prompts, not commands. The Skill already carries the procedure, so each of
 * these only has to point the agent at the right job.
 */
type StepCopy = {
  id: keyof OnboardingSnapshot['steps'];
  title: string;
  /** Shown while this step is the one to act on. */
  blurb: string;
  prompt?: string;
  cli?: string;
};

const STEPS: StepCopy[] = [
  {
    id: 'agent',
    title: 'Connect your coding agent',
    blurb:
      'OtaKit gives your agent the tools and the Skill it needs to ship an update. Everything after this is one sentence to your agent.',
  },
  {
    id: 'app',
    title: 'Create your app',
    blurb: 'Your agent registers the app, wires the Capacitor plugin, and sets the app ID for you.',
    prompt:
      'Set up OtaKit in this project: create the app in my OtaKit organization, install and configure the Capacitor plugin, and make sure notifyAppReady() is called once the app has finished booting.',
    cli: 'npx -y @otakit/cli@latest register --slug com.example.app',
  },
  {
    id: 'bundle',
    title: 'Upload your first bundle',
    blurb: 'Build the web assets and upload them. Nothing goes live until you publish.',
    prompt:
      "Build my web assets and upload them to OtaKit as a new bundle. Don't publish it yet — show me what you'd release.",
    cli: 'npx -y @otakit/cli@latest upload',
  },
  {
    id: 'release',
    title: 'Publish the release',
    blurb: 'Your agent shows you the exact lane and waits for your approval before publishing.',
    prompt:
      'Publish the bundle you just uploaded to my default lane. Show me the exact release first and wait for my approval.',
    cli: 'npx -y @otakit/cli@latest release',
  },
  {
    id: 'device',
    title: 'See it land on a device',
    blurb:
      'Rebuild the native app and launch it. OtaKit cannot see a device until it acts on a release, so this fills in on its own the moment one reports back.',
  },
];

/** Available as slash commands once the MCP server is connected. */
const AGENT_COMMANDS = [
  { name: '/otakit:check', description: 'Read-only readiness check for this project' },
  { name: '/otakit:release', description: 'Upload the built assets and prepare a release' },
  { name: '/otakit:rollout', description: 'Summarise what devices are reporting' },
  { name: '/otakit:revert', description: 'Prepare a revert for approval' },
];

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatusIcon({ status, busy }: { status: SetupStepStatus; busy: boolean }) {
  if (status === 'done') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
        <CircleAlert className="size-3 text-amber-600 dark:text-amber-400" />
      </span>
    );
  }
  if (status === 'unknown') {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
        <Minus className="size-3 text-muted-foreground" />
      </span>
    );
  }
  if (busy) {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      <CircleDashed
        className={cn(
          'size-4',
          status === 'active' ? 'text-foreground' : 'text-muted-foreground/40',
        )}
      />
    </span>
  );
}

function ProgressTrack({ snapshot }: { snapshot: OnboardingSnapshot }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {STEPS.map((step) => {
        const status = snapshot.steps[step.id].status;
        return (
          <span
            key={step.id}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              status === 'done' && 'bg-emerald-500',
              status === 'blocked' && 'bg-amber-500',
              status === 'unknown' && 'bg-muted-foreground/30',
              status === 'active' && 'bg-foreground/40',
              status === 'todo' && 'bg-border',
            )}
          />
        );
      })}
    </div>
  );
}

function PromptCard({ prompt, clientLabel }: { prompt: string; clientLabel: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Paste into {clientLabel}</p>
        <CopyButton value={prompt} label="prompt">
          <span className="text-xs">Copy</span>
        </CopyButton>
      </div>
      <div className="rounded-lg border border-border bg-muted/60 px-3 py-2.5 text-[13px] leading-relaxed">
        {prompt}
      </div>
    </div>
  );
}

function CommandLine({ label, command }: { label: string; command: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <CopyButton value={command} label={label} />
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed">
        <code>{command}</code>
      </pre>
    </div>
  );
}

function DiagnosisPanel({ diagnosis }: { diagnosis: SetupDiagnosis }) {
  const isProblem = diagnosis.tone === 'error' || diagnosis.tone === 'warning';
  return (
    <div
      className={cn(
        'rounded-lg border px-3.5 py-3',
        isProblem ? 'border-amber-500/40 bg-amber-500/5' : 'border-border bg-muted/40',
      )}
    >
      <div className="flex items-start gap-2.5">
        {isProblem ? (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-[13px] font-medium leading-snug">{diagnosis.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {diagnosis.body}
            </p>
          </div>

          {diagnosis.detail ? (
            <p className="text-xs text-muted-foreground">
              Device reported{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{diagnosis.detail}</code>
            </p>
          ) : null}

          {diagnosis.causes?.length ? (
            <ul className="space-y-1 text-[13px] text-muted-foreground">
              {diagnosis.causes.map((cause) => (
                <li key={cause} className="flex gap-2">
                  <span className="text-muted-foreground/50">·</span>
                  <span>{cause}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {diagnosis.fixPrompt ? (
            <div className="pt-0.5">
              <PromptCard prompt={diagnosis.fixPrompt} clientLabel="your agent" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function evidenceFor(snapshot: OnboardingSnapshot, id: StepCopy['id']): string | null {
  const steps = snapshot.steps;
  switch (id) {
    case 'agent':
      return steps.agent.status === 'done' ? (steps.agent.clientName ?? 'Connected') : null;
    case 'app':
      return steps.app.slug;
    case 'bundle':
      return steps.bundle.version;
    case 'release': {
      const lane = steps.release.channel ?? 'base';
      const runtime = steps.release.runtimeVersion;
      return steps.release.status === 'done'
        ? `${lane}${runtime ? ` · runtime ${runtime}` : ''}`
        : null;
    }
    case 'device': {
      if (steps.device.status !== 'done') return null;
      const parts = [steps.device.bundleVersion, steps.device.platform].filter(Boolean);
      const when = relativeTime(steps.device.appliedAt);
      return `${parts.join(' · ')}${when ? ` · ${when}` : ''}`;
    }
  }
}

export function SetupGuide({ initialSnapshot }: { initialSnapshot: OnboardingSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [storedClient, chooseClient] = useStoredPreference(CLIENT_STORAGE_KEY);
  const client: ClientId = isClientId(storedClient) ? storedClient : 'claude';
  // 'none' is an explicit collapse: without it, closing the auto-expanded step
  // falls back to the current step and immediately reopens it.
  const [expanded, setExpanded] = useState<StepCopy['id'] | 'none' | null>(null);
  const [showCli, setShowCli] = useState(false);

  // The first unfinished step is the one to act on, unless the reader opened
  // another. Recomputed from the snapshot so a checkpoint landing elsewhere
  // moves the guide forward on its own.
  const currentStep = useMemo(
    () => STEPS.find((step) => snapshot.steps[step.id].status !== 'done')?.id ?? null,
    [snapshot],
  );
  const openStep = expanded === 'none' ? null : (expanded ?? currentStep);

  const waitingOnDevice =
    snapshot.steps.device.status === 'active' || snapshot.steps.device.status === 'blocked';

  const appId = snapshot.app?.id ?? null;
  const complete = snapshot.complete;

  useEffect(() => {
    if (complete) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const url = appId
            ? `/api/v1/organization/onboarding?appId=${encodeURIComponent(appId)}`
            : '/api/v1/organization/onboarding';
          const response = await fetch(url, { signal: controller.signal });
          if (response.ok && !stopped) {
            setSnapshot((await response.json()) as OnboardingSnapshot);
          }
        } catch {
          // A dropped poll is not worth surfacing; the next tick recovers.
        }
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), waitingOnDevice ? POLL_WAITING_MS : POLL_IDLE_MS);
      }
    };

    timer = setTimeout(() => void tick(), waitingOnDevice ? POLL_WAITING_MS : POLL_IDLE_MS);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [complete, appId, waitingOnDevice]);

  const clientLabel = CLIENT_TABS.find((tab) => tab.id === client)?.label ?? 'your agent';

  return (
    <div className="flex min-h-svh flex-col">
      <DashboardHeader activeSection="dashboard" />

      <main className="flex-1">
        <div className="mx-auto max-w-3xl bg-muted/30">
          <div className="flex items-start justify-between gap-4 border-b border-border bg-background px-5 pb-6 pt-8">
            <div className="flex items-center gap-3">
              <Rocket className="size-6 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-0.5">
                <h1 className="text-[15px] font-semibold leading-tight">
                  {snapshot.complete ? "You're live" : 'Get your first update live'}
                </h1>
                <p className="text-xs leading-tight text-muted-foreground">
                  {snapshot.complete
                    ? `${snapshot.app?.slug ?? 'Your app'} is shipping updates over the air`
                    : `${snapshot.completedCount} of ${snapshot.totalCount} done`}
                </p>
              </div>
            </div>
            {snapshot.app ? (
              <Button variant="ghost" size="sm" className="h-8" asChild>
                <Link href="/dashboard">
                  <ArrowLeft className="size-3.5" /> Dashboard
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="border-b border-border bg-background px-5 py-4">
            <ProgressTrack snapshot={snapshot} />
          </div>

          <div className="divide-y divide-border border-b border-border">
            {STEPS.map((step) => {
              const state = snapshot.steps[step.id];
              const evidence = evidenceFor(snapshot, step.id);
              const isOpen = openStep === step.id;
              const busy =
                step.id === 'device' && state.status === 'active' && snapshot.analyticsAvailable;

              return (
                <div key={step.id} className="bg-background">
                  <button
                    type="button"
                    onClick={() => setExpanded(openStep === step.id ? 'none' : step.id)}
                    className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/40"
                  >
                    <StatusIcon status={state.status} busy={busy} />
                    <span
                      className={cn(
                        'flex-1 text-[13px] font-medium',
                        state.status === 'done' && 'text-muted-foreground',
                      )}
                    >
                      {step.title}
                    </span>
                    {evidence ? (
                      <span className="truncate text-xs text-muted-foreground">{evidence}</span>
                    ) : null}
                  </button>

                  {isOpen ? (
                    <div className="space-y-4 px-5 pb-5 pl-[3.25rem]">
                      <p className="text-[13px] leading-relaxed text-muted-foreground">
                        {step.blurb}
                      </p>

                      {step.id === 'agent' ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-1">
                            {CLIENT_TABS.map((tab) => (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => chooseClient(tab.id)}
                                className={cn(
                                  'rounded-md px-2.5 py-1.5 text-xs transition-colors',
                                  client === tab.id
                                    ? 'bg-accent font-medium text-foreground'
                                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                                )}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>
                          {CONNECT_COMMANDS[client].map((entry) => (
                            <CommandLine
                              key={entry.command}
                              label={entry.label}
                              command={entry.command}
                            />
                          ))}
                        </div>
                      ) : null}

                      {step.prompt ? (
                        <PromptCard prompt={step.prompt} clientLabel={clientLabel} />
                      ) : null}

                      {step.id === 'device' && snapshot.steps.device.diagnosis ? (
                        <DiagnosisPanel diagnosis={snapshot.steps.device.diagnosis} />
                      ) : null}

                      {step.cli ? (
                        <div>
                          <button
                            type="button"
                            onClick={() => setShowCli((value) => !value)}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            <Terminal className="size-3" />
                            {showCli ? 'Hide the command' : 'Prefer the terminal?'}
                          </button>
                          {showCli ? (
                            <div className="mt-2.5">
                              <CommandLine label="Equivalent command" command={step.cli} />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {snapshot.steps.agent.status === 'done' ? (
            <div className="border-b border-border bg-background px-5 py-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="size-3.5 text-muted-foreground" />
                <p className="text-xs font-medium">Your agent now has these commands</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {AGENT_COMMANDS.map((command) => (
                  <div key={command.name} className="rounded-lg border border-border px-3 py-2">
                    <code className="text-xs font-medium">{command.name}</code>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {command.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {snapshot.complete ? (
            <div className="bg-background px-5 py-6 text-center">
              <Badge variant="secondary" className="mb-3 gap-1.5">
                <Bot className="size-3" /> Setup complete
              </Badge>
              <p className="text-[13px] text-muted-foreground">
                Ask your agent to ship the next one — it already knows how.
              </p>
              <Button size="sm" className="mt-4" asChild>
                <Link href="/dashboard">Go to the dashboard</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
