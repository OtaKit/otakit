'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CircleAlert,
  Info,
  Leaf,
  LoaderCircle,
  Rocket,
  Star,
} from 'lucide-react';

import { InfoHint } from '@/app/components/InfoHint';
import { PlanCard, type PlanKey } from '@/app/components/PricingDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SUPPORT_MAILTO } from '@/lib/support';
import { cn } from '@/lib/utils';
import {
  ONBOARDING_QUESTIONS,
  ONBOARDING_STEPS,
  PRO_DOWNLOADS,
  STARTER_DOWNLOADS,
  estimateMonthlyDownloads,
  isUnsupportedTechnology,
  onboardingAnswersSchema,
  onboardingStepError,
  onboardingUsageError,
  recommendedPlan,
  type OnboardingAnswers,
  type OnboardingProfile,
  type OnboardingRequest,
  type OnboardingStep,
} from '@/lib/onboarding-profile';

/**
 * One line per step: the word on the progress rail, the question the step
 * actually asks, and why it is being asked. Anything that does not fit those
 * three slots is a note attached to the answer that earned it, not loose prose
 * dropped between sections.
 */
const STEPS: Record<OnboardingStep, { nav: string; title: string; lead: string }> = {
  app: {
    nav: 'Your app',
    title: 'Tell us about your app',
    lead: 'So the setup we hand you afterwards matches the stack you actually build on.',
  },
  updates: {
    nav: 'Updates',
    title: 'Where you are with OTA today',
    lead: 'This decides whether you start clean or migrate off another provider.',
  },
  audience: {
    nav: 'Scale',
    title: 'How much traffic to expect',
    lead: 'Used only to suggest a plan. A rough estimate is enough, and you can skip it.',
  },
  plans: {
    nav: 'Plan',
    title: 'Pick a starting plan',
    lead: 'Change it whenever you like. Nothing here blocks the dashboard.',
  },
};

const PLAN_NAMES: Record<PlanKey, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const number = (value: number) => value.toLocaleString('en-US');

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
  const [answers, setAnswers] = useState<OnboardingAnswers>(initialProfile?.answers ?? {});
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
  const unsupported = isUnsupportedTechnology(answers.technology);
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
        unsupported || step === 'audience'
          ? { action: 'complete', answers }
          : { action: 'save', answers, step: ONBOARDING_QUESTIONS[index + 1] },
      );
      setAnswers(profile.answers);
      setStep(profile.step);
      setCompleted(Boolean(profile.completedAt));
      if (isUnsupportedTechnology(profile.answers.technology) && profile.completedAt)
        goToDashboard();
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
  const headline = finishing
    ? {
        title: 'You’re all set',
        lead: 'Your answers are saved. Connect your app next — the dashboard walks you through it.',
      }
    : STEPS[step];

  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
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

      <main className="relative mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="relative bg-card">
          <Frame />

          <nav
            aria-label="Onboarding progress"
            className="border-b border-border px-6 py-4 sm:px-8"
          >
            <ol className="grid grid-cols-4 gap-2 sm:gap-3">
              {ONBOARDING_STEPS.map((item, position) => {
                const state =
                  position === index ? 'current' : position < index ? 'done' : 'upcoming';
                return (
                  <li key={item} aria-current={state === 'current' ? 'step' : undefined}>
                    <span
                      aria-hidden
                      className={cn(
                        'block h-0.5 w-full',
                        state === 'current'
                          ? 'bg-foreground'
                          : state === 'done'
                            ? 'bg-foreground/40'
                            : 'bg-border',
                      )}
                    />
                    <span
                      className={cn(
                        'mt-2 block truncate text-[11px] font-medium leading-none',
                        state === 'current' ? 'text-foreground' : 'text-muted-foreground',
                        state === 'upcoming' && 'opacity-70',
                      )}
                    >
                      {item === 'plans' && !billingEnabled ? 'Done' : STEPS[item].nav}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="px-6 py-7 sm:px-8">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Step {index + 1} of {ONBOARDING_STEPS.length}
            </p>
            <h1
              ref={heading}
              tabIndex={-1}
              className="mt-2 text-xl font-semibold tracking-tight outline-none sm:text-2xl"
            >
              {headline.title}
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
              {headline.lead}
            </p>
          </div>

          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              next();
            }}
          >
            <fieldset disabled={busy}>
              {step === 'app' && (
                <>
                  <Choices
                    id="technology"
                    label="What is your app built with?"
                    value={answers.technology}
                    onChange={(value) =>
                      update({
                        technology: value as OnboardingAnswers['technology'],
                        framework: undefined,
                        appStage: undefined,
                      })
                    }
                    options={[
                      ['capacitor', 'Capacitor / Ionic', 'An iOS or Android app using Capacitor'],
                      ['web', 'Web app', 'Adding iOS or Android with Capacitor'],
                      ['react_native', 'React Native / Expo'],
                      ['flutter', 'Flutter'],
                      ['native', 'Native iOS / Android', 'Swift, Objective-C, Java, or Kotlin'],
                      ['not_sure', 'Not sure yet'],
                    ]}
                  >
                    {unsupported ? (
                      <Note>
                        OtaKit updates the HTML, CSS, and JavaScript inside a Capacitor app, so it
                        cannot update React Native, Flutter, or native code. Look around anyway —
                        we’ll note the platform you asked for.
                      </Note>
                    ) : answers.technology === 'web' || answers.technology === 'not_sure' ? (
                      <Note>
                        You can explore now. The updater itself needs an iOS or Android build made
                        with Capacitor.
                      </Note>
                    ) : null}
                  </Choices>

                  {!unsupported &&
                    (answers.technology === 'capacitor' || answers.technology === 'web') && (
                      <Choices
                        id="framework"
                        columns={3}
                        label="Which web framework?"
                        value={answers.framework}
                        onChange={(value) =>
                          update({ framework: value as OnboardingAnswers['framework'] })
                        }
                        options={[
                          ['react', 'React'],
                          ['vue', 'Vue'],
                          ['angular', 'Angular'],
                          ['svelte', 'Svelte'],
                          ['other', 'Another one'],
                          ['not_sure', 'Not sure'],
                        ]}
                      />
                    )}

                  {!unsupported && answers.technology && (
                    <Choices
                      id="app-stage"
                      label="Where is your app today?"
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
                </>
              )}

              {step === 'updates' && (
                <>
                  <Choices
                    id="ota-provider"
                    label="Are you shipping OTA updates today?"
                    value={answers.otaProvider}
                    onChange={(value) =>
                      update({
                        otaProvider: value as OnboardingAnswers['otaProvider'],
                        otherProvider: undefined,
                      })
                    }
                    options={[
                      ['none', 'Not yet', 'Everything ships through the app stores'],
                      ['appflow', 'Ionic Appflow'],
                      ['capgo', 'Capgo'],
                      ['capawesome', 'Capawesome'],
                      ['custom', 'Something we built'],
                      ['other', 'Another provider'],
                      ['not_sure', 'Not sure'],
                    ]}
                  >
                    {answers.otaProvider === 'other' && (
                      <Followup
                        htmlFor="other-provider"
                        label="Which provider?"
                        className="mt-4"
                        optional
                      >
                        <Input
                          id="other-provider"
                          className="sm:max-w-sm"
                          maxLength={120}
                          value={answers.otherProvider ?? ''}
                          onChange={(event) => update({ otherProvider: event.target.value })}
                        />
                      </Followup>
                    )}
                    {answers.otaProvider === 'none' ? (
                      <Note>
                        A device starts receiving OtaKit updates once it runs a build that includes
                        the plugin. Test that locally first, then ship one store release.
                      </Note>
                    ) : answers.otaProvider && answers.otaProvider !== 'not_sure' ? (
                      <Note>
                        Moving from another provider takes one store release: install OtaKit, test
                        it in a separate build, then ship it to your existing users.
                      </Note>
                    ) : null}
                  </Choices>

                  <Choices
                    id="goal"
                    label="What do you want to get done first?"
                    optional
                    value={answers.goal}
                    onChange={(value) => update({ goal: value as OnboardingAnswers['goal'] })}
                    options={[
                      ['start', 'Ship my first OTA update'],
                      ['migrate', 'Switch providers'],
                      ['cost', 'Cut update costs'],
                      ['explore', 'Compare the options'],
                    ]}
                  />

                  <Section>
                    <FieldLabel id="source-label" optional>
                      How did you find OtaKit?
                    </FieldLabel>
                    <Select
                      value={answers.source ?? ''}
                      onValueChange={(value) =>
                        update({
                          source: value as OnboardingAnswers['source'],
                          sourceDetail: undefined,
                        })
                      }
                    >
                      <SelectTrigger
                        id="source"
                        aria-labelledby="source-label source"
                        className="mt-3 w-full sm:max-w-sm"
                      >
                        <SelectValue placeholder="Choose one" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="search">Search engine</SelectItem>
                        <SelectItem value="ai">AI assistant</SelectItem>
                        <SelectItem value="community">Community or social media</SelectItem>
                        <SelectItem value="recommendation">Someone recommended it</SelectItem>
                        <SelectItem value="launch_site">Product Hunt or a directory</SelectItem>
                        <SelectItem value="ad">An ad</SelectItem>
                        <SelectItem value="other">Somewhere else</SelectItem>
                      </SelectContent>
                    </Select>
                    {answers.source && (
                      <Followup
                        htmlFor="source-detail"
                        label="Which one?"
                        className="mt-4"
                        optional
                      >
                        <Input
                          id="source-detail"
                          className="sm:max-w-sm"
                          maxLength={120}
                          placeholder="Google, Claude, Reddit, Product Hunt…"
                          value={answers.sourceDetail ?? ''}
                          onChange={(event) => update({ sourceDetail: event.target.value })}
                        />
                      </Followup>
                    )}
                  </Section>
                </>
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
                  <Section className="bg-muted/20">
                    <Readout
                      label="Estimated downloads"
                      value={
                        estimatedDownloads === null ? '—' : `${number(estimatedDownloads)} / month`
                      }
                      caption={
                        estimatedDownloads === null
                          ? 'Fill in both numbers and we’ll suggest a plan on the next step.'
                          : `${number(answers.activeUsers!)} active users × ${number(answers.updatesPerMonth!)} updates. Real usage depends on how many devices download each one.`
                      }
                    />
                  </Section>
                </>
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
                      <span className="font-medium">{PLAN_NAMES[currentPlan]}</span>. You can change
                      it later from Billing in Settings.
                    </p>
                    <Button type="button" className="mt-4" onClick={goToDashboard}>
                      Continue on {PLAN_NAMES[currentPlan]}
                      <ArrowRight className="size-4" />
                    </Button>
                  </Section>
                ) : (
                  <>
                    {estimatedDownloads !== null && (
                      <Section className="bg-muted/20">
                        <Readout
                          label="Your estimate"
                          value={`${number(estimatedDownloads)} downloads / month`}
                          caption={
                            suggested
                              ? `${PLAN_NAMES[suggested]} is the smallest plan that covers it.`
                              : undefined
                          }
                        />
                      </Section>
                    )}
                    <Section>
                      <div className="grid gap-4 sm:grid-cols-2">
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
                      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                        Free and Starter stop serving updates at their included limits; Pro overage
                        is optional. Choosing a paid plan opens checkout — you can also start Free
                        and upgrade later.
                        {suggested === 'enterprise' &&
                          ' Your estimate is past Pro’s included volume, so enable paid overage on Pro or talk to us about Enterprise.'}
                      </p>
                    </Section>
                  </>
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

            <div className="flex items-center gap-3 border-t border-border px-6 py-4 sm:px-8">
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
                  {unsupported
                    ? 'Save and explore'
                    : step === 'audience'
                      ? billingEnabled
                        ? 'See plans'
                        : 'Finish'
                      : 'Continue'}
                  {busy ? null : <ArrowRight className="size-4" />}
                </Button>
              )}
            </div>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
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

/** A question that only exists because of the answer above it. */
function Followup({
  htmlFor,
  label,
  optional,
  className,
  children,
}: {
  htmlFor: string;
  label: string;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <FieldLabel htmlFor={htmlFor} optional={optional}>
        {label}
      </FieldLabel>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * A caveat earns its place by hanging off the answer that raised it, which is
 * why this is only ever rendered inside the question it belongs to.
 */
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 flex gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
      <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
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

function Choices({
  id,
  label,
  optional,
  value,
  options,
  onChange,
  columns = 2,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  value?: string;
  options: Array<[string, string, string?]>;
  onChange: (value: string) => void;
  columns?: 2 | 3;
  /** Follow-ups and notes that belong to this question. */
  children?: ReactNode;
}) {
  // One shape for every option in a group: a hint on one of them would
  // otherwise drag its neighbours' text off the shared baseline.
  const hinted = options.some(([, , hint]) => hint);
  return (
    <Section>
      <FieldLabel id={`${id}-label`} optional={optional}>
        {label}
      </FieldLabel>
      <RadioGroup
        value={value ?? ''}
        onValueChange={onChange}
        aria-labelledby={`${id}-label`}
        className={cn(
          'mt-3 grid gap-2',
          columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        {options.map(([option, title, hint]) => (
          <Label
            key={option}
            htmlFor={`${id}-${option}`}
            className={cn(
              'cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
              hinted ? 'items-start' : 'items-center',
              value === option
                ? 'border-foreground/30 bg-muted/60'
                : 'border-border hover:bg-muted/30',
            )}
          >
            <RadioGroupItem
              id={`${id}-${option}`}
              value={option}
              className={hinted ? 'mt-0.5' : undefined}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-snug">{title}</span>
              {hint ? (
                <span className="mt-1 block text-xs leading-relaxed font-normal text-muted-foreground">
                  {hint}
                </span>
              ) : null}
            </span>
          </Label>
        ))}
      </RadioGroup>
      {children}
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
