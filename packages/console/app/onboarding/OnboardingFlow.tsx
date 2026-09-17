'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SUPPORT_MAILTO } from '@/lib/support';
import { cn } from '@/lib/utils';
import {
  LAST_QUESTION,
  ONBOARDING_QUESTIONS,
  onboardingAnswersSchema,
  type OnboardingAnswers,
  type OnboardingProfile,
  type OnboardingQuestion,
  type OnboardingRequest,
} from '@/lib/onboarding-profile';

/**
 * The title asks the question, so nothing repeats it as a field label. The
 * line under it says why we are asking, which is the only reason a screen gets
 * a second sentence at all.
 */
const SCREENS: Record<OnboardingQuestion, { title: string; lead: string }> = {
  stage: {
    title: 'Where is your app today?',
    lead: 'Live with users, or still building? It tells us who is picking OtaKit up.',
  },
  updates: {
    title: 'Are you shipping OTA updates today?',
    lead: 'If you are moving across from another provider, we would like to know which one.',
  },
  source: {
    title: 'How did you hear about us?',
    lead: 'It is how we know which channels are worth keeping.',
  },
};

export function OnboardingFlow({
  organizationId,
  organizationName,
  initialProfile,
}: {
  organizationId: string;
  organizationName: string;
  initialProfile: OnboardingProfile | null;
}) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => initialProfile?.answers ?? {});
  const [step, setStep] = useState<OnboardingQuestion>(
    initialProfile?.step ?? ONBOARDING_QUESTIONS[0],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const landed = useRef(false);
  const index = ONBOARDING_QUESTIONS.indexOf(step);
  const last = step === LAST_QUESTION;

  // Moving to another step re-reads the card from the top. Focus goes to the
  // new question without scrolling on its own, so the two never fight and the
  // page settles once instead of jumping twice.
  useEffect(() => {
    if (!landed.current) {
      landed.current = true;
      return;
    }
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [step]);
  useEffect(() => {
    if (error) errorRef.current?.focus({ preventScroll: true });
  }, [error]);

  function goToDashboard() {
    window.location.assign('/dashboard');
  }
  function update(patch: Partial<OnboardingAnswers>) {
    setAnswers((current) => ({ ...current, ...patch }));
    setError(null);
  }
  async function save(input: OnboardingRequest) {
    const response = await fetch('/api/v1/organization/onboarding/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
      body: JSON.stringify(input),
    });
    if (response.status === 401) {
      setSessionExpired(true);
      throw new Error(
        'Your session expired. Sign in again to continue; your saved progress will be here.',
      );
    }
    const data = (await response.json().catch(() => null)) as {
      profile?: OnboardingProfile;
      error?: string;
    } | null;
    if (!response.ok || !data?.profile)
      throw new Error(data?.error ?? 'We couldn’t save your progress. Please try again.');
    return data.profile;
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSessionExpired(false);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function next() {
    void run(async () => {
      // Driven by the question list, so adding or splitting a screen cannot
      // leave the questionnaire finishing one screen early.
      const profile = await save(
        last
          ? { action: 'complete', answers }
          : { action: 'save', answers, step: ONBOARDING_QUESTIONS[index + 1] },
      );
      // The last answer is the end of the flow: there is no closing screen to
      // sit on, so finishing goes straight to the dashboard.
      if (last) {
        goToDashboard();
        return;
      }
      setAnswers(profile.answers);
      setStep(profile.step);
    });
  }
  function skip() {
    void run(async () => {
      // Keep whatever has been answered so far — a skipped questionnaire is
      // still worth the answers it already has.
      const draft = onboardingAnswersSchema.safeParse(answers);
      await save({ action: 'skip', ...(draft.success ? { answers: draft.data } : {}) });
      goToDashboard();
    });
  }

  const screen = SCREENS[step];

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background text-foreground">
      <Backdrop />

      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center gap-3 px-4 sm:px-6">
          <Image
            src="/logo.svg"
            alt="OtaKit"
            width={28}
            height={28}
            className="size-7 rounded-lg"
          />
          <span className="text-sm font-semibold tracking-tight">OtaKit</span>
          <span className="hidden min-w-0 border-l border-border pl-3 text-sm text-muted-foreground sm:block">
            <span className="block truncate">{organizationName}</span>
          </span>
        </div>
      </header>

      {/* Fills whatever is left under the header, so the page never ends in a
          short card floating over empty background. */}
      <main className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-10 sm:px-6 sm:py-14">
        {/* The card takes the height the page has, which is what puts Back and
            Continue on the bottom edge instead of halfway up the screen. */}
        <div className="relative flex flex-1 flex-col bg-card">
          <Frame />

          {/* Progress is the card's own top edge darkening from the left. There is
              no separate widget to reflow, and the eyebrow below says where you
              are exactly. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 z-20 h-px bg-foreground transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${((index + 1) / ONBOARDING_QUESTIONS.length) * 100}%` }}
          />

          <div className="flex flex-1 flex-col">
            <div className="px-6 py-8 sm:px-8">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Step {index + 1} of {ONBOARDING_QUESTIONS.length} · Optional
              </p>
              <h1
                ref={heading}
                tabIndex={-1}
                id="onboarding-title"
                className="mt-2 text-xl font-semibold tracking-tight outline-none sm:text-2xl"
              >
                {screen.title}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{screen.lead}</p>
            </div>

            <form
              noValidate
              className="flex flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                next();
              }}
            >
              <fieldset className="flex-1" disabled={busy}>
                {step === 'stage' && (
                  <Choices
                    id="app-stage"
                    value={answers.appStage}
                    onChange={(value) =>
                      update({ appStage: value as OnboardingAnswers['appStage'] })
                    }
                    options={[
                      ['live', 'Live with users'],
                      ['testing', 'Testing a native build'],
                      ['building', 'Still building'],
                      ['exploring', 'Just exploring'],
                    ]}
                  />
                )}

                {step === 'updates' && (
                  <Choices
                    id="ota-provider"
                    value={answers.otaProvider}
                    onChange={(value) =>
                      update({ otaProvider: value as OnboardingAnswers['otaProvider'] })
                    }
                    options={[
                      ['none', 'Not yet'],
                      ['appflow', 'Ionic Appflow'],
                      ['capgo', 'Capgo'],
                      ['capawesome', 'Capawesome'],
                      ['custom', 'Our own setup'],
                      ['other', 'Another provider'],
                      ['not_sure', 'Not sure'],
                    ]}
                  />
                )}

                {step === 'source' && (
                  <Choices
                    id="source"
                    value={answers.source}
                    onChange={(value) => update({ source: value as OnboardingAnswers['source'] })}
                    options={[
                      ['search', 'Search engine'],
                      ['ai', 'An AI assistant'],
                      ['community', 'Community or social'],
                      ['recommendation', 'Someone recommended it'],
                      ['launch_site', 'Product Hunt or a directory'],
                      ['ad', 'An ad'],
                      ['other', 'Somewhere else'],
                    ]}
                  />
                )}
              </fieldset>

              {error && (
                <div className="flex gap-2.5 border-t border-destructive/30 bg-destructive/5 px-6 py-3.5 sm:px-8">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  <p
                    id="onboarding-error"
                    ref={errorRef}
                    tabIndex={-1}
                    role="alert"
                    className="text-sm leading-relaxed text-destructive outline-none"
                  >
                    {error}
                    {sessionExpired && (
                      <a href="/login" className="ml-2 font-medium underline underline-offset-4">
                        Sign in again
                      </a>
                    )}
                  </p>
                </div>
              )}

              {/* Skip sits beside Continue, where the decision is actually made.
                  In the header it read as chrome and went unseen. */}
              <div className="mt-auto flex items-center gap-3 border-t border-border px-6 py-4 sm:px-8">
                {index > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 text-muted-foreground"
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setStep(ONBOARDING_QUESTIONS[index - 1]);
                    }}
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-muted-foreground"
                  disabled={busy}
                  onClick={skip}
                >
                  Skip, go to dashboard
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {last ? 'Finish' : 'Continue'}
                  {busy ? null : <ArrowRight className="size-4" />}
                </Button>
              </div>
            </form>
          </div>
        </div>

        <p className="pt-10 text-center text-sm text-muted-foreground">
          Stuck on something?{' '}
          <a href={SUPPORT_MAILTO} className="underline underline-offset-4 hover:text-foreground">
            Talk to us
          </a>
          .
        </p>
      </main>
    </div>
  );
}

/** The dot grid the login page stands on, so signing in and setting up match. */
function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1.5px,transparent_1.5px)] bg-[size:28px_28px] opacity-60" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

/**
 * The card's own frame: its two edges bleed the full width the way every rule
 * on the marketing site does, and the sides close it off like the bordered
 * containers there. The card reads as a slice of the page, not a floating box.
 */
function Frame() {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-10 h-px w-screen -translate-x-1/2 bg-border"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/2 z-10 h-px w-screen -translate-x-1/2 bg-border"
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border" />
    </>
  );
}

/** One question, one rule above it. Every band in the card is one of these. */
function Section({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-t border-border px-6 py-6 sm:px-8', className)}>
      {children}
    </section>
  );
}

/**
 * One line per option, whatever the control. A hint on some options and not
 * others made the tiles read as two different controls sharing a grid.
 */
function tile(selected: boolean) {
  return cn(
    'cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors',
    selected ? 'border-foreground/30 bg-muted/60' : 'border-border hover:bg-muted/30',
  );
}

/**
 * A single choice, where the screen title is the question the group answers.
 */
function Choices({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value?: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <Section>
      <RadioGroup
        value={value ?? ''}
        onValueChange={onChange}
        aria-labelledby="onboarding-title"
        className="grid gap-2 sm:grid-cols-2"
      >
        {options.map(([option, title]) => (
          <Label key={option} htmlFor={`${id}-${option}`} className={tile(value === option)}>
            <RadioGroupItem id={`${id}-${option}`} value={option} />
            <span className="text-sm font-medium leading-snug">{title}</span>
          </Label>
        ))}
      </RadioGroup>
    </Section>
  );
}
