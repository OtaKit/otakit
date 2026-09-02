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
  stepContent,
  stepEvidence,
  type AgentClient,
  type SetupMode,
  type StepId,
} from './content';

const MODE_STORAGE_KEY = 'otakit.setup.mode';
const CLIENT_STORAGE_KEY = 'otakit.setup.client';

function StatusMark({ status }: { status: SetupStepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="size-2.5 text-emerald-600 dark:text-emerald-400" />
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
        <CircleAlert className="size-2.5 text-amber-600 dark:text-amber-400" />
      </span>
    );
  }
  if (status === 'unknown') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted">
        <Minus className="size-2.5 text-muted-foreground" />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center">
        <span className="size-2 rounded-full bg-foreground" />
      </span>
    );
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <span className="size-2 rounded-full border border-muted-foreground/40" />
    </span>
  );
}

function ModeToggle({ mode, onChange }: { mode: SetupMode; onChange: (next: SetupMode) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {(['agent', 'cli'] as const).map((value) => {
        const Icon = value === 'agent' ? Sparkles : Terminal;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            aria-pressed={mode === value}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
              mode === value
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3" />
            {MODE_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}

export function SetupPanel({
  snapshot,
  className,
}: {
  snapshot: OnboardingSnapshot;
  className?: string;
}) {
  const [modeValue, setMode] = useStoredPreference(MODE_STORAGE_KEY);
  const [clientValue, setClient] = useStoredPreference(CLIENT_STORAGE_KEY);
  const mode: SetupMode = modeValue === 'cli' ? 'cli' : 'agent';
  const client: AgentClient =
    clientValue === 'codex' || clientValue === 'other' ? clientValue : 'claude';

  const [picked, setPicked] = useState<StepId | null>(null);
  const [revealed, setRevealed] = useState(false);

  const current = useMemo(
    () => STEP_ORDER.find((id) => snapshot.steps[id].status !== 'done') ?? null,
    [snapshot],
  );
  const focused = picked ?? current;
  const diagnosis = snapshot.steps.device.diagnosis;

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center justify-between gap-3 px-3.5 pb-2.5 pt-3">
        <p className="text-[13px] font-semibold">Set up OtaKit</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {snapshot.completedCount} of {snapshot.totalCount}
        </p>
      </div>

      <div className="flex items-center gap-1 px-3.5" aria-hidden>
        {STEP_ORDER.map((id) => {
          const status = snapshot.steps[id].status;
          return (
            <span
              key={id}
              className={cn(
                'h-0.5 flex-1 rounded-full',
                status === 'done' && 'bg-emerald-500',
                status === 'blocked' && 'bg-amber-500',
                status === 'unknown' && 'bg-muted-foreground/30',
                status === 'active' && 'bg-foreground/50',
                status === 'todo' && 'bg-border',
              )}
            />
          );
        })}
      </div>

      <div className="px-3.5 pb-1 pt-3">
        <ModeToggle
          mode={mode}
          onChange={(next) => {
            setMode(next);
            setRevealed(false);
          }}
        />
      </div>

      <ul className="p-1.5">
        {STEP_ORDER.map((id) => {
          const state = snapshot.steps[id];
          const content = stepContent(mode, id, client);
          const evidence = stepEvidence(snapshot, id);
          const isFocused = focused === id;
          const isDevice = id === 'device';

          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(isFocused ? null : id);
                  setRevealed(false);
                }}
                aria-expanded={isFocused}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                  isFocused ? 'bg-accent/60' : 'hover:bg-accent/40',
                )}
              >
                <StatusMark status={state.status} />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px]',
                    state.status === 'done'
                      ? 'text-muted-foreground'
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
                <div className="space-y-2.5 px-2 pb-3 pl-[1.875rem] pt-1">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {isDevice && diagnosis ? diagnosis.body : content.hint}
                  </p>

                  {isDevice && diagnosis?.tone !== 'waiting' && diagnosis?.detail ? (
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

                  {mode === 'agent' && id === 'agent' ? (
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
                              ? 'border-foreground/20 bg-background font-medium'
                              : 'border-transparent text-muted-foreground hover:bg-background/60',
                          )}
                        >
                          {CLIENT_LABELS[value]}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <StepAction
                    action={
                      isDevice && diagnosis?.fixPrompt
                        ? { kind: 'prompt', text: diagnosis.fixPrompt }
                        : content.action
                    }
                    revealed={revealed}
                    onToggleReveal={() => setRevealed((value) => !value)}
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

function StepAction({
  action,
  revealed,
  onToggleReveal,
}: {
  action: ReturnType<typeof stepContent>['action'];
  revealed: boolean;
  onToggleReveal: () => void;
}) {
  if (action.kind === 'none') return null;
  const label = action.kind === 'prompt' ? 'Copy prompt' : 'Copy command';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <CopyButton
          value={action.text}
          label={label}
          className="h-7 rounded-md border border-border bg-background px-2.5 hover:bg-accent"
        >
          <span className="text-xs font-medium">{label}</span>
        </CopyButton>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={onToggleReveal}
          aria-expanded={revealed}
        >
          {revealed ? 'Hide' : 'Show'}
          <ChevronDown className={cn('size-3 transition-transform', revealed && 'rotate-180')} />
        </Button>
      </div>

      {revealed ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/60 px-2.5 py-2 text-[11px] leading-relaxed">
          <code>{action.text}</code>
        </pre>
      ) : null}
    </div>
  );
}
