'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CircleAlert,
  Leaf,
  LoaderCircle,
  Rocket,
  Star,
} from 'lucide-react';

import { InfoHint } from '@/app/components/InfoHint';
import { PlanCard, type PlanKey } from '@/app/components/PricingDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SUPPORT_MAILTO } from '@/lib/support';
import { cn } from '@/lib/utils';
import {
  ONBOARDING_QUESTIONS,
  ONBOARDING_STEPS,
  PRO_DOWNLOADS,
  STARTER_DOWNLOADS,
  estimateMonthlyDownloads,
  LOCKED_TECHNOLOGY,
  onboardingAnswersSchema,
  onboardingStepError,
  onboardingUsageError,
  technologiesOf,
  recommendedPlan,
  type OnboardingAnswers,
  type OnboardingProfile,
  type OnboardingRequest,
  type OnboardingStep,
  type Technology,
} from '@/lib/onboarding-profile';

/**
 * The title asks the question, so nothing repeats it as a field label. The
 * line under it says why we are asking, which is the only reason a screen gets
 * a second sentence at all.
 */
const SCREENS: Record<OnboardingStep, { title: string; lead: string }> = {
  app: {
    title: 'What do you build with?',
    lead: 'OtaKit currently supports Capacitor apps. Tick anything else in your stack.',
  },
  stage: {
    title: 'Where is your app today?',
    lead: 'It decides whether we point you at a test device or a store release first.',
  },
  updates: {
    title: 'Are you shipping OTA updates today?',
    lead: 'So we know whether to set you up from scratch or help you move across.',
  },
  audience: {
    title: 'How much traffic do you expect?',
    lead: 'A rough estimate is enough — it only decides which plan we suggest.',
  },
  source: {
    title: 'How did you hear about us?',
    lead: 'It is how we know which channels are worth keeping.',
  },
  plans: {
    title: 'Pick a starting plan',
    lead: 'Every plan includes unlimited apps and updates. Usage counts update downloads — one device taking one update.',
  },
};

const PLAN_NAMES: Record<PlanKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const number = (value: number) => value.toLocaleString('en-US');

/** How long the card takes to change width. Kept in step with the class below. */
const RESIZE_MS = 280;

export function OnboardingFlow({
  organizationId,
  organizationName,
  initialProfile,
  billingEnabled,
  currentPlan,
  hasSubscription,
  freeDownloads,
}: {
  organizationId: string;
  organizationName: string;
  initialProfile: OnboardingProfile | null;
  billingEnabled: boolean;
  currentPlan: PlanKey;
  hasSubscription: boolean;
  freeDownloads: number;
}) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => {
    const saved = initialProfile?.answers ?? {};
    return { ...saved, technologies: technologiesOf(saved) };
  });
  const [step, setStep] = useState<OnboardingStep>(initialProfile?.step ?? 'app');
  const [completed, setCompleted] = useState(Boolean(initialProfile?.completedAt));
  const [busy, setBusy] = useState(false);
  const [checkingOut, setCheckingOut] = useState<'starter' | 'pro' | null>(null);
  const [invalidField, setInvalidField] = useState<'activeUsers' | 'updatesPerMonth' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const landed = useRef(false);
  const index = ONBOARDING_STEPS.indexOf(step);
  const lastQuestion = ONBOARDING_QUESTIONS[ONBOARDING_QUESTIONS.length - 1];
  const estimatedDownloads = estimateMonthlyDownloads(answers);
  const suggested = recommendedPlan(estimatedDownloads, freeDownloads);

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
    setInvalidField(null);
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
  async function checkout(plan: 'starter' | 'pro', interval: 'month' | 'year') {
    setCheckingOut(plan);
    try {
      const response = await fetch('/api/v1/organization/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
        body: JSON.stringify({ planKey: plan, interval, returnTo: 'dashboard' }),
      });
      const data = (await response.json().catch(() => null)) as {
        checkoutUrl?: string;
        error?: string;
      } | null;
      if (response.status === 401) setSessionExpired(true);
      if (!response.ok || !data?.checkoutUrl)
        throw new Error(
          `${data?.error ?? 'Checkout couldn’t start.'} Your answers are saved. Try again or continue to the dashboard on your current plan.`,
        );
      window.location.assign(data.checkoutUrl);
    } finally {
      setCheckingOut(null);
    }
  }
  function next() {
    if (step === 'plans') return;
    const validation = onboardingStepError(answers, step);
    if (validation) {
      setInvalidField(step === 'audience' ? (onboardingUsageError(answers)?.field ?? null) : null);
      setError(validation);
      return;
    }
    void run(async () => {
      const profile = await save(
        // Driven by the question list, so adding or splitting a screen cannot
        // leave the questionnaire finishing one screen early.
        step === lastQuestion
          ? { action: 'complete', answers }
          : { action: 'save', answers, step: ONBOARDING_QUESTIONS[index + 1] },
      );
      setAnswers(profile.answers);
      setStep(profile.step);
      setCompleted(Boolean(profile.completedAt));
      // An unsupported platform stops here on its own screen rather than being
      // dropped on the dashboard with no idea why the questions ended.
    });
  }
  function skip() {
    if (step === 'plans') {
      goToDashboard();
      return;
    }
    void run(async () => {
      // Skipping must work even when the current draft contains an invalid number.
      // Keep valid draft answers in the same request; otherwise retain the last save.
      const draft = onboardingAnswersSchema.safeParse(answers);
      await save({ action: 'skip', ...(draft.success ? { answers: draft.data } : {}) });
      goToDashboard();
    });
  }

  const finishing = step === 'plans' && !billingEnabled;
  const wide = step === 'plans' && !finishing;

  // Only the plan table needs the extra room, so the card changes width exactly
  // once. Reflowing four columns of prices live through that change is what
  // looked broken, so the content sits out the resize and fades back once the
  // width has settled: the frame glides, the text never re-wraps on screen.
  const [resizing, setResizing] = useState(false);
  const wasWide = useRef(wide);
  useEffect(() => {
    if (wasWide.current === wide) return;
    wasWide.current = wide;
    setResizing(true);
    const timer = setTimeout(() => setResizing(false), RESIZE_MS);
    return () => clearTimeout(timer);
  }, [wide]);
  const headline = finishing
    ? {
        title: 'You’re all set',
        lead: 'Your answers are saved. The dashboard walks you through connecting your app.',
      }
    : SCREENS[step];

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
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            disabled={busy}
            onClick={completed ? goToDashboard : skip}
          >
            {completed ? 'Go to dashboard' : 'Skip for now'}
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </header>

      <main
        className={cn(
          // Fills whatever is left under the header, so the page never ends in a
          // short card floating over empty background.
          'relative mx-auto flex w-full flex-1 flex-col px-4 py-10 sm:px-6 sm:py-14',
          'transition-[max-width] duration-[280ms] ease-out motion-reduce:transition-none',
          wide ? 'max-w-6xl' : 'max-w-2xl',
        )}
      >
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
            style={{ width: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }}
          />

          {/* Hidden outright while the width moves — no transition class, so it
              goes at once — then eased back in against a card that has stopped
              moving. */}
          <div
            className={cn(
              'flex flex-1 flex-col',
              resizing
                ? 'opacity-0'
                : 'opacity-100 transition-opacity duration-200 ease-out motion-reduce:transition-none',
            )}
          >
            <div className="px-6 py-8 sm:px-8">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Step {index + 1} of {ONBOARDING_STEPS.length}
              </p>
              <h1
                ref={heading}
                tabIndex={-1}
                id="onboarding-title"
                className="mt-2 text-xl font-semibold tracking-tight outline-none sm:text-2xl"
              >
                {headline.title}
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {headline.lead}
              </p>
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
                {step === 'app' && (
                  <Stack
                    value={answers.technologies ?? []}
                    onChange={(technologies) => update({ technologies })}
                    options={[
                      ['capacitor', 'Capacitor / Ionic'],
                      ['web', 'A web app'],
                      ['react_native', 'React Native / Expo'],
                      ['flutter', 'Flutter'],
                      ['native', 'Native iOS / Android'],
                    ]}
                  />
                )}

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

                {step === 'audience' && (
                  <>
                    <Section>
                      <div className="grid gap-6 sm:grid-cols-2">
                        <UsageInput
                          id="active-users"
                          label="Monthly active users"
                          hint="People who open your app in a typical month. Enter 0 if you haven’t launched, or leave it blank if you’re not sure."
                          placeholder="1000"
                          value={answers.activeUsers}
                          max={1_000_000_000}
                          invalid={invalidField === 'activeUsers'}
                          onChange={(value) => update({ activeUsers: value })}
                        />
                        <UsageInput
                          id="updates-month"
                          label="Updates per month"
                          hint="How often you expect to ship an OTA update. A rough number is enough."
                          placeholder="4"
                          value={answers.updatesPerMonth}
                          max={1_000}
                          invalid={invalidField === 'updatesPerMonth'}
                          onChange={(value) => update({ updatesPerMonth: value })}
                        />
                      </div>
                    </Section>
                    {estimatedDownloads !== null && (
                      <Section className="bg-muted/20">
                        <Readout
                          label="Estimated downloads"
                          value={`${number(estimatedDownloads)} / month`}
                          caption={`${number(answers.activeUsers!)} active users × ${number(answers.updatesPerMonth!)} updates.`}
                        />
                      </Section>
                    )}
                  </>
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

                {step === 'plans' &&
                  (finishing ? (
                    <Section>
                      <Button type="button" onClick={goToDashboard}>
                        Go to dashboard
                        <ArrowRight className="size-4" />
                      </Button>
                    </Section>
                  ) : hasSubscription ? (
                    <Section>
                      <p className="text-sm">
                        This workspace is already on{' '}
                        <span className="font-medium">{PLAN_NAMES[currentPlan]}</span>. You can
                        change it later from Billing in Settings.
                      </p>
                      <Button type="button" className="mt-4" onClick={goToDashboard}>
                        Continue on {PLAN_NAMES[currentPlan]}
                        <ArrowRight className="size-4" />
                      </Button>
                    </Section>
                  ) : (
                    <Section>
                      {estimatedDownloads !== null && (
                        <p className="mb-5 text-sm text-muted-foreground">
                          Your estimate is{' '}
                          <span className="font-medium text-foreground">
                            {number(estimatedDownloads)} downloads a month
                          </span>
                          {suggested ? `, which ${PLAN_NAMES[suggested]} covers.` : '.'}
                        </p>
                      )}
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <PlanCard
                          name="Free"
                          price="$0"
                          priceNote="No card required"
                          subtitle={`${number(freeDownloads)} downloads / month`}
                          features={[
                            'Unlimited apps and updates',
                            'Dashboard + CLI',
                            'Single-member workspace',
                            'Hard cap — no overage',
                          ]}
                          current={false}
                          actionLabel="Continue with Free"
                          actionIcon={Leaf}
                          disabled={busy}
                          onAction={goToDashboard}
                          tag={suggested === 'free' ? 'Fits your estimate' : undefined}
                          highlighted={suggested === 'free'}
                        />
                        <PlanCard
                          name="Starter"
                          price="$10"
                          priceNote="Billed monthly"
                          subtitle={`${number(STARTER_DOWNLOADS)} downloads / month`}
                          features={[
                            'Unlimited apps and updates',
                            'Dashboard + CLI',
                            'Single-member workspace',
                            'Hard cap — no overage',
                          ]}
                          current={false}
                          actionLabel={
                            freeDownloads >= STARTER_DOWNLOADS
                              ? 'Included in Free'
                              : 'Choose Starter'
                          }
                          actionIcon={Rocket}
                          disabled={busy || freeDownloads >= STARTER_DOWNLOADS}
                          loading={checkingOut === 'starter'}
                          onAction={() => void run(() => checkout('starter', 'month'))}
                          tag={suggested === 'starter' ? 'Fits your estimate' : undefined}
                          highlighted={suggested === 'starter'}
                        />
                        <PlanCard
                          name="Pro"
                          price="$25"
                          priceNote="Billed $300/year, or $50 monthly"
                          subtitle={`${number(PRO_DOWNLOADS)} downloads / month`}
                          features={[
                            'Everything in Free',
                            'Team members and roles',
                            `Optional overage: $50 / extra ${number(PRO_DOWNLOADS)}`,
                            'Priority support',
                          ]}
                          current={false}
                          actionLabel="Choose Pro"
                          actionIcon={Star}
                          disabled={busy}
                          loading={checkingOut === 'pro'}
                          actionItems={[
                            {
                              label: 'Yearly',
                              description: '$300/year · $25/month',
                              onSelect: () => void run(() => checkout('pro', 'year')),
                            },
                            {
                              label: 'Monthly',
                              description: '$50/month',
                              onSelect: () => void run(() => checkout('pro', 'month')),
                            },
                          ]}
                          tag={suggested === 'pro' ? 'Fits your estimate' : undefined}
                          highlighted={suggested === 'pro'}
                        />
                        <PlanCard
                          name="Enterprise"
                          price="Custom"
                          priceNote="Tailored to your volume"
                          subtitle="Custom download volume"
                          features={[
                            'Everything in Pro',
                            'Custom limits and contract',
                            'SSO and priority SLAs',
                            'Dedicated support',
                          ]}
                          current={false}
                          actionLabel="Contact sales"
                          actionIcon={Building2}
                          disabled={busy}
                          onAction={() => {
                            window.location.href = `${SUPPORT_MAILTO}?subject=OtaKit%20Enterprise`;
                          }}
                          tag={suggested === 'enterprise' ? 'Discuss your volume' : undefined}
                          highlighted={suggested === 'enterprise'}
                        />
                      </div>
                    </Section>
                  ))}
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
                      setInvalidField(null);
                      setStep(ONBOARDING_STEPS[index - 1]);
                    }}
                  >
                    <ArrowLeft className="size-3.5" />
                    Back
                  </Button>
                )}
                {step !== 'plans' && (
                  <Button type="submit" className="ml-auto" disabled={busy}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {step === lastQuestion ? 'Finish' : 'Continue'}
                    {busy ? null : <ArrowRight className="size-4" />}
                  </Button>
                )}
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

function FieldLabel({
  id,
  htmlFor,
  optional,
  hint,
  children,
}: {
  id?: string;
  htmlFor?: string;
  optional?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    // The ⓘ sits beside the label, never inside it: a button within a label
    // steals the click that should be putting the caret in the field.
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {htmlFor ? (
        <Label htmlFor={htmlFor}>{children}</Label>
      ) : (
        <span id={id} className="text-sm font-medium leading-none">
          {children}
        </span>
      )}
      {hint ? <InfoHint label={`About ${String(children).toLowerCase()}`}>{hint}</InfoHint> : null}
      {optional ? <span className="text-xs text-muted-foreground">Optional</span> : null}
    </div>
  );
}

/** A number the reader gave us, read back to them. */
function Readout({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums">{value}</span>
      </div>
      {caption ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{caption}</p>
      ) : null}
    </>
  );
}

/**
 * One line per option, whatever the control. A hint on some options and not
 * others made the tiles read as two different controls sharing a grid.
 */
function tile(selected: boolean, locked = false) {
  return cn(
    'items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors',
    locked ? 'cursor-default' : 'cursor-pointer',
    selected ? 'border-foreground/30 bg-muted/60' : 'border-border hover:bg-muted/30',
  );
}

/**
 * The stack question, which is a list rather than a choice: people ship a
 * Capacitor app and a native one, and saying so should not mean picking the
 * lesser truth. Capacitor is ticked and fixed because it is the thing OtaKit
 * updates — the screen says as much rather than warning anyone off afterwards.
 */
function Stack({
  value,
  options,
  onChange,
}: {
  value: Technology[];
  options: Array<[Technology, string]>;
  onChange: (value: Technology[]) => void;
}) {
  return (
    <Section>
      <div role="group" aria-labelledby="onboarding-title" className="grid gap-2 sm:grid-cols-2">
        {options.map(([option, title]) => {
          const locked = option === LOCKED_TECHNOLOGY;
          const checked = locked || value.includes(option);
          return (
            <Label key={option} htmlFor={`stack-${option}`} className={tile(checked, locked)}>
              <Checkbox
                id={`stack-${option}`}
                checked={checked}
                disabled={locked}
                // Locked, not greyed out: it is a true answer, not one that is
                // unavailable, and washing it out reads as an error.
                className={locked ? 'disabled:cursor-default disabled:opacity-100' : undefined}
                onCheckedChange={(next) =>
                  onChange(
                    next === true ? [...value, option] : value.filter((item) => item !== option),
                  )
                }
              />
              <span className="text-sm font-medium leading-snug">{title}</span>
              {locked ? (
                <span className="ml-auto text-[11px] text-muted-foreground">Required</span>
              ) : null}
            </Label>
          );
        })}
      </div>
    </Section>
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

function UsageInput({
  id,
  label,
  hint,
  placeholder,
  value,
  max,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: number | null | undefined;
  max: number;
  invalid: boolean;
  onChange: (value: number | null | undefined) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} hint={hint} optional>
        {label}
      </FieldLabel>
      <Input
        id={id}
        className="mt-3"
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={1}
        placeholder={placeholder}
        value={value == null || Number.isNaN(value) ? '' : value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'onboarding-error' : undefined}
        onChange={(event) =>
          onChange(
            event.target.validity.badInput
              ? NaN
              : event.target.value === ''
                ? undefined
                : Number(event.target.value),
          )
        }
      />
    </div>
  );
}
