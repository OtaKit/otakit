'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Minus, Sparkles, Terminal } from 'lucide-react';

import { CopyButton } from '@/app/components/CopyButton';
import { useStoredPreference } from '@/app/components/useStoredPreference';
import type { OnboardingSnapshot, SetupStepStatus } from '@/lib/services/onboarding';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  AGENT_CLIENTS,
  CLIENT_LABELS,
  MODE_LABELS,
  STEP_ORDER,
  connectCommand,
  stepContent,
  stepEvidence,
  type AgentClient,
  type SetupMode,
  type StepAction,
  type StepId,
} from './content';

const MODE_STORAGE_KEY = 'otakit.setup.mode';
const CLIENT_STORAGE_KEY = 'otakit.setup.client';

function StatusMark({ status }: { status: SetupStepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-amber-500/15">
        <CircleAlert className="size-3 text-amber-600 dark:text-amber-400" />
      </span>
    );
  }
  if (status === 'unknown') {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted">
        <Minus className="size-3 text-muted-foreground" />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-foreground/70">
        <span className="size-1.5 rounded-full bg-foreground" />
      </span>
    );
  }
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center">
      <span className="size-[13px] rounded-full border border-muted-foreground/30" />
    </span>
  );
}

function ActionRow({ action }: { action: StepAction }) {
  const [revealed, setRevealed] = useState(false);
  if (action.kind === 'none') return null;
  const label = action.kind === 'prompt' ? 'Copy prompt' : 'Copy command';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <CopyButton
          value={action.text}
          label={label}
          className="h-8 rounded-lg border border-border bg-background px-3 shadow-sm hover:bg-accent"
        >
          <span className="text-xs font-medium">{label}</span>
        </CopyButton>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => setRevealed((value) => !value)}
          aria-expanded={revealed}
        >
          {revealed ? 'Hide' : 'Show'}
          <ChevronDown className={cn('size-3 transition-transform', revealed && 'rotate-180')} />
        </Button>
      </div>
      {revealed ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <code>{action.text}</code>
        </pre>
      ) : null}
    </div>
  );
}

export function SetupPanel({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const [modeValue, setMode] = useStoredPreference(MODE_STORAGE_KEY);
  const [clientValue, setClient] = useStoredPreference(CLIENT_STORAGE_KEY);
  const mode: SetupMode = modeValue === 'cli' ? 'cli' : 'agent';
  const client: AgentClient =
    clientValue === 'codex' || clientValue === 'other' ? clientValue : 'claude';

  const [picked, setPicked] = useState<StepId | null>(null);
  const current = useMemo(
    () => STEP_ORDER.find((id) => snapshot.steps[id].status !== 'done') ?? null,
    [snapshot],
  );
  const focused = picked ?? current;
  const diagnosis = snapshot.steps.device.diagnosis;

  return (
    <div>
      {/* How you work — a root choice, not something implied per step. */}
      <div className="space-y-3 border-b border-border bg-muted/30 px-5 py-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(['agent', 'cli'] as const).map((value) => {
            const Icon = value === 'agent' ? Sparkles : Terminal;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
                  mode === value
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {MODE_LABELS[value]}
              </button>
            );
          })}
        </div>

        {mode === 'agent' ? (
          <div className="flex flex-wrap gap-1">
            {AGENT_CLIENTS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setClient(value)}
                aria-pressed={client === value}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] transition-colors',
                  client === value
                    ? 'border-border bg-background font-medium shadow-sm'
                    : 'border-transparent text-muted-foreground hover:bg-background/60',
                )}
              >
                {CLIENT_LABELS[value]}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {mode === 'agent'
              ? `One-time: connect OtaKit to ${CLIENT_LABELS[client]}.`
              : 'One-time: install the CLI and sign in.'}
          </p>
          <CopyButton
            value={connectCommand(mode, client)}
            label="connect command"
            className="h-7 shrink-0 rounded-lg border border-border bg-background px-2.5 shadow-sm hover:bg-accent"
          >
            <span className="text-[11px] font-medium">Copy</span>
          </CopyButton>
        </div>
      </div>

      <ul className="p-2">
        {STEP_ORDER.map((id) => {
          const state = snapshot.steps[id];
          const content = stepContent(mode, id);
          const evidence = stepEvidence(snapshot, id);
          const isFocused = focused === id;
          const isDevice = id === 'device';

          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => setPicked(isFocused ? null : id)}
                aria-expanded={isFocused}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  isFocused ? 'bg-accent/50' : 'hover:bg-accent/30',
                )}
              >
                <StatusMark status={state.status} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px]',
                    state.status === 'done'
                      ? 'text-muted-foreground line-through decoration-muted-foreground/30'
                      : 'font-medium text-foreground',
                  )}
                >
                  {content.title}
                </span>
                {evidence ? (
                  <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">
                    {evidence}
                  </span>
                ) : null}
              </button>

              {isFocused && state.status !== 'done' ? (
                <div className="space-y-3 px-3 pb-4 pl-[2.625rem] pt-1">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {isDevice && diagnosis ? diagnosis.body : content.hint}
                  </p>

                  {isDevice && diagnosis?.detail ? (
                    <p className="text-[11px] text-muted-foreground">
                      Device reported{' '}
                      <code className="rounded bg-muted px-1 py-0.5">{diagnosis.detail}</code>
                    </p>
                  ) : null}

                  {isDevice && diagnosis?.causes?.length ? (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {diagnosis.causes.map((cause) => (
                        <li key={cause} className="flex gap-1.5">
                          <span className="text-muted-foreground/50">·</span>
                          <span>{cause}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <ActionRow
                    action={
                      isDevice && diagnosis?.fixPrompt
                        ? { kind: 'prompt', text: diagnosis.fixPrompt }
                        : content.action
                    }
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
