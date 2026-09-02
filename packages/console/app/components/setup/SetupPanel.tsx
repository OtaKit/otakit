'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Minus } from 'lucide-react';

import { CommandBlock } from '@/app/components/CommandBlock';
import { useStoredPreference } from '@/app/components/useStoredPreference';
import type { OnboardingSnapshot, SetupStepStatus } from '@/lib/services/onboarding';
import { cn } from '@/lib/utils';

import {
  CHOICE_LABELS,
  CHOICE_SHORT_LABELS,
  SETUP_CHOICES,
  STEP_ORDER,
  choiceMode,
  connectCommand,
  connectSummary,
  readChoice,
  stepContent,
  stepEvidence,
  type SetupChoice,
  type StepAction,
  type StepId,
} from './content';

const MODE_STORAGE_KEY = 'otakit.setup.mode';
const CLIENT_STORAGE_KEY = 'otakit.setup.client';

/** Long enough for the animation to finish before anything is scrolled. */
const EXPAND_MS = 200;

/**
 * Five states, one 20px disc, so the marks read as a single column rather than
 * as five different widgets. The disc is opaque because the connector line runs
 * behind it: the mark is what breaks the line between one step and the next.
 */
function StatusMark({ status }: { status: SetupStepStatus }) {
  const shell =
    'relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-popover';
  const disc = 'flex size-5 items-center justify-center rounded-full';

  if (status === 'done') {
    return (
      <span className={shell}>
        <span className={cn(disc, 'bg-emerald-500/15')}>
          <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
        </span>
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className={shell}>
        <span className={cn(disc, 'bg-amber-500/15')}>
          <CircleAlert className="size-3 text-amber-600 dark:text-amber-400" />
        </span>
      </span>
    );
  }
  if (status === 'unknown') {
    return (
      <span className={shell}>
        <span className={cn(disc, 'bg-muted')}>
          <Minus className="size-3 text-muted-foreground" />
        </span>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className={shell}>
        <span className={cn(disc, 'border-[1.5px] border-foreground/70')}>
          <span className="size-1.5 rounded-full bg-foreground" />
        </span>
      </span>
    );
  }
  return (
    <span className={shell}>
      <span className={cn(disc, 'border border-dashed border-muted-foreground/40')} />
    </span>
  );
}

/**
 * A radio group rather than four independent buttons, because it is one choice
 * — which means arrow keys move between the options and only the selected one
 * is a tab stop.
 */
function ChoicePicker({
  value,
  onChange,
}: {
  value: SetupChoice;
  onChange: (choice: SetupChoice) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function move(delta: number) {
    const index = SETUP_CHOICES.indexOf(value);
    const nextIndex = (index + delta + SETUP_CHOICES.length) % SETUP_CHOICES.length;
    onChange(SETUP_CHOICES[nextIndex]);
    buttons.current[nextIndex]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="What you are setting OtaKit up from"
      className="grid grid-cols-4 gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {SETUP_CHOICES.map((choice, index) => (
        <button
          key={choice}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={value === choice}
          tabIndex={value === choice ? 0 : -1}
          title={CHOICE_LABELS[choice]}
          onClick={() => onChange(choice)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            }
          }}
          className={cn(
            'truncate rounded-md px-1.5 py-1 text-[11px] outline-none transition-colors',
            'focus-visible:ring-[2px] focus-visible:ring-ring/60',
            value === choice
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {CHOICE_SHORT_LABELS[choice]}
        </button>
      ))}
    </div>
  );
}

export function SetupPanel({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const [modeValue, setMode] = useStoredPreference(MODE_STORAGE_KEY);
  const [clientValue, setClient] = useStoredPreference(CLIENT_STORAGE_KEY);
  const choice = readChoice(modeValue, clientValue);
  const mode = choiceMode(choice);

  // `undefined` follows the snapshot; a step id or `null` is the reader saying
  // otherwise. A plain `picked ?? current` cannot tell "nothing picked yet"
  // from "closed", so closing the step the snapshot points at did nothing.
  const [picked, setPicked] = useState<StepId | null | undefined>(undefined);
  const rows = useRef(new Map<StepId, HTMLLIElement>());

  const current = useMemo(
    () => STEP_ORDER.find((id) => snapshot.steps[id].status !== 'done') ?? null,
    [snapshot],
  );
  // The panel polls, so a step someone opened can finish while it is open. The
  // list moves on rather than holding a row that has nothing left to say.
  const focused =
    picked === undefined || (picked !== null && snapshot.steps[picked].status === 'done')
      ? current
      : picked;
  const diagnosis = snapshot.steps.device.diagnosis;

  // Opening the last step while the panel is already scrolled to its end would
  // otherwise expand out of sight. Waits for the row to reach full height, so
  // "nearest" is measured against what the reader is about to see.
  useEffect(() => {
    if (!picked) return;
    const timer = setTimeout(() => {
      rows.current.get(picked)?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }, EXPAND_MS);
    return () => clearTimeout(timer);
  }, [picked]);

  function pick(next: SetupChoice) {
    setMode(choiceMode(next));
    // Left alone for 'cli' on purpose — see readChoice.
    if (next !== 'cli') setClient(next);
  }

  return (
    <div>
      <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-3.5">
        <ChoicePicker value={choice} onChange={pick} />
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">{connectSummary(choice)}</p>
          <CommandBlock value={connectCommand(choice)} label="connect command" wrap />
        </div>
      </div>

      <ol className="p-2">
        {STEP_ORDER.map((id, index) => {
          const state = snapshot.steps[id];
          const content = stepContent(mode, id);
          const evidence = stepEvidence(snapshot, id);
          const isDevice = id === 'device';
          const done = state.status === 'done';
          const open = focused === id && !done;
          const action: StepAction =
            isDevice && diagnosis?.fixPrompt
              ? { kind: 'prompt', text: diagnosis.fixPrompt }
              : content.action;

          const row = (
            <>
              <StatusMark status={state.status} />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px]',
                  done ? 'text-muted-foreground' : 'font-medium text-foreground',
                )}
              >
                {content.title}
              </span>
              {evidence ? (
                <span
                  title={evidence}
                  className="max-w-[9rem] shrink-0 truncate font-mono text-[11px] text-muted-foreground"
                >
                  {evidence}
                </span>
              ) : null}
            </>
          );

          return (
            <li
              key={id}
              ref={(node) => {
                if (node) rows.current.set(id, node);
                else rows.current.delete(id);
              }}
              className="relative"
            >
              {/* The spine, drawn past the row so the next mark covers the join. */}
              {index < STEP_ORDER.length - 1 ? (
                <span aria-hidden className="absolute -bottom-2 left-5 top-7 w-px bg-border" />
              ) : null}

              {done ? (
                // A finished step has nothing to open. Clicking one and getting
                // nothing back is what made the list feel arbitrary.
                <div className="flex items-center gap-3 rounded-lg px-2.5 py-2">{row}</div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPicked(open ? null : id)}
                  aria-expanded={open}
                  aria-controls={`setup-step-${id}`}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors',
                    'focus-visible:ring-[2px] focus-visible:ring-ring/60',
                    open ? 'bg-accent/50' : 'hover:bg-accent/30',
                  )}
                >
                  {row}
                </button>
              )}

              {/* Rows animate open by handing the child a row track rather than
                  a height, which needs no measurement and never jumps. */}
              <div
                id={`setup-step-${id}`}
                inert={!open}
                className={cn(
                  'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
                  open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                )}
              >
                <div className="overflow-hidden">
                  <div className="space-y-2.5 pb-3.5 pl-[2.625rem] pr-2.5 pt-1">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {isDevice && diagnosis ? diagnosis.body : content.hint}
                    </p>

                    {isDevice && diagnosis?.detail ? (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Device reported{' '}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono">
                          {diagnosis.detail}
                        </code>
                      </p>
                    ) : null}

                    {isDevice && diagnosis?.causes?.length ? (
                      <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                        {diagnosis.causes.map((cause) => (
                          <li key={cause} className="flex gap-1.5">
                            <span aria-hidden className="text-muted-foreground/50">
                              ·
                            </span>
                            <span>{cause}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {action.kind !== 'none' ? (
                      <CommandBlock
                        value={action.text}
                        label={action.kind === 'prompt' ? 'prompt' : 'command'}
                        wrap={action.kind === 'prompt'}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
