'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Copy,
  Leaf,
  LoaderCircle,
  Rocket,
  Star,
} from 'lucide-react';

import { PlanCard, type PlanKey } from '@/app/components/PricingDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SUPPORT_MAILTO } from '@/lib/support';
import { trackConversion } from '@/lib/gtag';
import {
  ONBOARDING_STEPS,
  appIdentifierError,
  estimateMonthlyDownloads,
  isUnsupportedTechnology,
  onboardingStepError,
  type OnboardingAnswers,
  type OnboardingProfile,
  type OnboardingRequest,
  type OnboardingStep,
} from '@/lib/onboarding-profile';

const STEP_LABELS = ['Your app', 'Updates', 'Audience', 'Plan', 'Connect'];
const TITLES: Record<OnboardingStep, [string, string]> = {
  app: [
    'Let’s start with your app.',
    'A few details will help us show you the right setup and pricing.',
  ],
  updates: [
    'How do you ship updates today?',
    'We’ll use this to guide your first release or migration.',
  ],
  audience: [
    'How many people use your app?',
    'An estimate is enough. This helps you compare plans by expected usage.',
  ],
  plans: [
    'Choose your starting plan.',
    'Every plan includes unlimited apps and updates. Usage is measured by downloaded updates.',
  ],
  connect: [
    'Connect your app to OtaKit.',
    'First, give it an identifier. Then install the plugin in your project.',
  ],
};

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
  const [connectedApp, setConnectedApp] = useState(initialProfile?.connectedApp ?? null);
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [checkoutReturned, setCheckoutReturned] = useState(false);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const index = ONBOARDING_STEPS.indexOf(step);
  const unsupported = isUnsupportedTechnology(answers.technology);
  const estimatedDownloads = estimateMonthlyDownloads(answers);
  const needsCheckout =
    billingEnabled &&
    !hasSubscription &&
    (answers.selectedPlan === 'starter' || answers.selectedPlan === 'pro');
  const dashboardHref = connectedApp
    ? `/dashboard?app=${encodeURIComponent(connectedApp.id)}`
    : '/dashboard';

  useEffect(() => {
    heading.current?.focus();
  }, [step, connectedApp]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    setCheckoutReturned(new URLSearchParams(window.location.search).get('checkout') === 'success');
  }, []);

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
      profile?: OnboardingProfile & { appCreated?: boolean };
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

  async function checkout(plan: OnboardingAnswers['selectedPlan'] = answers.selectedPlan) {
    const response = await fetch('/api/v1/organization/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-otakit-organization-id': organizationId },
      body: JSON.stringify({
        planKey: plan,
        interval: answers.billingInterval ?? 'month',
        returnTo: 'onboarding',
      }),
    });
    const data = (await response.json().catch(() => null)) as {
      checkoutUrl?: string;
      error?: string;
    } | null;
    if (response.status === 401) setSessionExpired(true);
    if (!response.ok || !data?.checkoutUrl)
      throw new Error(
        data?.error ??
          'Checkout couldn’t start. Your app is saved; you can retry or continue to setup.',
      );
    window.location.assign(data.checkoutUrl);
  }

  function next(nextAnswers = answers) {
    const validation = onboardingStepError(nextAnswers, step);
    if (validation) {
      setError(validation);
      return;
    }
    void run(async () => {
      const nextStep = ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)];
      const profile = await save({ action: 'save', answers: nextAnswers, step: nextStep });
      setAnswers(profile.answers);
      setStep(profile.step);
    });
  }

  function finish() {
    if (!unsupported) {
      const validation = appIdentifierError(slug);
      if (validation) {
        setError(validation);
        return;
      }
    }
    void run(async () => {
      const profile = await save({
        action: 'complete',
        answers,
        ...(unsupported ? {} : { slug: slug.trim() }),
      });
      if (unsupported) {
        window.location.assign('/dashboard');
        return;
      }
      if (!profile.connectedApp) throw new Error('We couldn’t connect your app. Please try again.');
      setConnectedApp(profile.connectedApp);
      try {
        const key = `otakit:app-tracked:${profile.connectedApp.id}`;
        if (profile.appCreated && !localStorage.getItem(key)) {
          localStorage.setItem(key, '1');
          trackConversion('app_created');
        }
      } catch {
        /* Storage is optional; the database records the app regardless. */
      }
      if (needsCheckout) await checkout();
    });
  }

  function skip() {
    void run(async () => {
      await save({ action: 'save', answers, step });
      await save({ action: 'skip' });
      window.location.assign('/dashboard');
    });
  }

  function choosePlan(
    plan: NonNullable<OnboardingAnswers['selectedPlan']>,
    interval: 'month' | 'year' = 'month',
  ) {
    next({ ...answers, selectedPlan: plan, billingInterval: interval });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/logo.svg" width={28} height={28} alt="" />
            <span className="text-lg font-semibold tracking-tight">OtaKit</span>
            <span className="hidden truncate border-l pl-3 text-sm text-muted-foreground sm:block">
              {organizationName}
            </span>
          </div>
          {connectedApp ? (
            <Link href={dashboardHref} className="text-sm underline underline-offset-4">
              Go to dashboard
            </Link>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={skip}>
              Skip for now
            </Button>
          )}
        </div>
      </header>

      <main
        className={`mx-auto px-5 py-8 sm:px-8 sm:py-12 ${step === 'plans' && !connectedApp ? 'max-w-6xl' : 'max-w-3xl'}`}
      >
        {!connectedApp && (
          <nav aria-label="Setup progress" className="mb-10">
            <ol className="grid grid-cols-5 gap-2 sm:gap-4">
              {ONBOARDING_STEPS.map((item, position) => (
                <li key={item} aria-current={item === step ? 'step' : undefined}>
                  <div
                    className={`mb-2 h-1 rounded-full ${position <= index ? 'bg-foreground' : 'bg-muted'}`}
                  />
                  <span
                    className={`text-xs sm:text-sm ${position === index ? 'font-medium' : 'text-muted-foreground'}`}
                  >
                    <span className="hidden sm:inline">{position + 1}. </span>
                    {STEP_LABELS[position]}
                  </span>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <h1
          ref={heading}
          tabIndex={-1}
          className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
        >
          {connectedApp ? 'Your app is registered. Let’s finish connecting it.' : TITLES[step][0]}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          {connectedApp
            ? 'Install and configure the updater so your app can receive its first update.'
            : TITLES[step][1]}
        </p>
        {error && (
          <p
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive outline-none"
          >
            {error}
            {sessionExpired && (
              <Link href="/login" className="ml-2 font-medium underline underline-offset-4">
                Sign in again
              </Link>
            )}
          </p>
        )}

        {connectedApp ? (
          <div className="mt-8 space-y-6">
            {(checkoutReturned || hasSubscription) && (
              <Notice>
                {hasSubscription
                  ? `Your workspace is on ${currentPlan === 'pro' ? 'Pro' : currentPlan === 'starter' ? 'Starter' : 'Enterprise'}.`
                  : 'Checkout completed. Your plan will appear in Billing once payment is confirmed.'}
              </Notice>
            )}
            {needsCheckout && !checkoutReturned && (
              <Notice>
                <p>
                  Your app is saved. Finish checkout for{' '}
                  {answers.selectedPlan === 'pro' ? 'Pro' : 'Starter'}, or continue setting up on
                  your current plan.
                </p>
                <Button className="mt-3" disabled={busy} onClick={() => void run(() => checkout())}>
                  {busy && <LoaderCircle className="size-4 animate-spin" />}Continue to checkout
                </Button>
              </Notice>
            )}
            <div className="rounded-xl border border-border p-5">
              <p className="text-sm text-muted-foreground">{connectedApp.slug} · OtaKit app ID</p>
              <CopyCode text={connectedApp.id} />
              <p className="mt-3 text-sm text-muted-foreground">
                Use this ID in <code>plugins.OtaKit.appId</code>. Keep your existing native{' '}
                <code>appId</code> unchanged.
              </p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-medium">1. Install the updater in your project</h2>
              <CopyCode text={'npm install @otakit/capacitor-updater\nnpx cap sync'} />
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-medium">2. Configure it and confirm app startup</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Add the app ID to your Capacitor configuration and call{' '}
                <code>OtaKit.notifyAppReady()</code> once your app has loaded. The setup guide walks
                through both changes.
              </p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-medium">3. Build and test on a device</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Make a native build with the plugin installed. A local test build is enough to try
                OTA. Existing users need a new App Store or Google Play build containing OtaKit
                before they can receive its updates.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 border-t pt-6">
              <Button asChild>
                <a href="https://otakit.com/docs/setup" target="_blank" rel="noreferrer">
                  Open setup guide
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button asChild variant="outline">
                <Link href={dashboardHref}>Go to dashboard</Link>
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="mt-8"
            onSubmit={(event) => {
              event.preventDefault();
              if (step === 'connect' || unsupported) finish();
              else if (step !== 'plans') next();
            }}
          >
            <fieldset disabled={busy} className="space-y-8 disabled:opacity-70">
              {step === 'app' && (
                <>
                  <Choices
                    name="technology"
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
                      ['web', 'Web app', 'Planning to add iOS or Android with Capacitor'],
                      ['react_native', 'React Native / Expo'],
                      ['flutter', 'Flutter'],
                      ['native', 'Native iOS / Android', 'Swift, Objective-C, Java, or Kotlin'],
                      ['not_sure', 'Not sure yet'],
                    ]}
                  />
                  {unsupported ? (
                    <Notice>
                      <strong>OtaKit currently supports Capacitor apps.</strong>
                      <p className="mt-2">
                        It updates the HTML, CSS, and JavaScript inside a Capacitor app. It cannot
                        update React Native, Flutter, or native app code. You can still explore the
                        dashboard; we’ll save your interest in this platform.
                      </p>
                    </Notice>
                  ) : (
                    <>
                      {(answers.technology === 'capacitor' || answers.technology === 'web') && (
                        <Choices
                          name="framework"
                          label="Which web framework do you use?"
                          value={answers.framework}
                          onChange={(value) =>
                            update({ framework: value as OnboardingAnswers['framework'] })
                          }
                          compact
                          options={[
                            ['react', 'React'],
                            ['vue', 'Vue'],
                            ['angular', 'Angular'],
                            ['svelte', 'Svelte'],
                            ['other', 'Another framework'],
                            ['not_sure', 'Not sure'],
                          ]}
                        />
                      )}
                      {answers.technology && (
                        <Choices
                          name="appStage"
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
                      {(answers.technology === 'web' || answers.technology === 'not_sure') && (
                        <Notice>
                          You can explore OtaKit now. Before installing the updater, your project
                          needs an iOS or Android app built with Capacitor.
                        </Notice>
                      )}
                    </>
                  )}
                </>
              )}

              {step === 'updates' && (
                <>
                  <Choices
                    name="otaProvider"
                    label="Are you already using over-the-air updates?"
                    value={answers.otaProvider}
                    onChange={(value) =>
                      update({
                        otaProvider: value as OnboardingAnswers['otaProvider'],
                        otherProvider: undefined,
                      })
                    }
                    options={[
                      ['none', 'No OTA yet', 'I ship updates through the app stores'],
                      ['appflow', 'Ionic Appflow'],
                      ['capgo', 'Capgo'],
                      ['capawesome', 'Capawesome'],
                      ['custom', 'Built our own'],
                      ['other', 'Another provider'],
                      ['not_sure', 'Not sure'],
                    ]}
                  />
                  {answers.otaProvider === 'other' && (
                    <div className="space-y-2">
                      <Label htmlFor="other-provider">
                        Provider name <span className="text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="other-provider"
                        value={answers.otherProvider ?? ''}
                        maxLength={120}
                        onChange={(event) => update({ otherProvider: event.target.value })}
                      />
                    </div>
                  )}
                  <Choices
                    name="goal"
                    label="What brought you to OtaKit? (optional)"
                    value={answers.goal}
                    onChange={(value) => update({ goal: value as OnboardingAnswers['goal'] })}
                    options={[
                      ['start', 'Ship my first OTA update'],
                      ['migrate', 'Switch providers'],
                      ['cost', 'Reduce update costs'],
                      ['explore', 'Compare options'],
                    ]}
                  />
                  {answers.otaProvider && !['none', 'not_sure'].includes(answers.otaProvider) && (
                    <Notice>
                      <strong>Switching providers needs one native release.</strong>
                      <p className="mt-2">
                        Install OtaKit and test it in a separate build first. Your existing users
                        will receive OtaKit updates after installing a store build that includes its
                        plugin.
                      </p>
                    </Notice>
                  )}
                </>
              )}

              {step === 'audience' && (
                <>
                  <UsageInput
                    id="active-users"
                    label="Monthly active users"
                    hint="People who open your app in a typical month. Enter 0 if you haven’t launched."
                    value={answers.activeUsers}
                    max={1_000_000_000}
                    onChange={(value) => update({ activeUsers: value })}
                  />
                  <UsageInput
                    id="updates-month"
                    label="OTA updates you expect to ship each month"
                    hint="A rough estimate helps translate your audience into downloaded updates."
                    value={answers.updatesPerMonth}
                    max={1_000}
                    onChange={(value) => update({ updatesPerMonth: value })}
                  />
                  <div className="space-y-2">
                    <Label htmlFor="source">
                      How did you hear about OtaKit?{' '}
                      <span className="text-muted-foreground">(optional)</span>
                    </Label>
                    <select
                      id="source"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={answers.source ?? ''}
                      onChange={(event) =>
                        update({
                          source: (event.target.value || undefined) as OnboardingAnswers['source'],
                          sourceDetail: undefined,
                        })
                      }
                    >
                      <option value="">Choose a source</option>
                      <option value="search">Search engine</option>
                      <option value="ai">AI assistant</option>
                      <option value="community">Community or social media</option>
                      <option value="recommendation">Someone recommended it</option>
                      <option value="launch_site">Product Hunt or a directory</option>
                      <option value="ad">An ad</option>
                      <option value="other">Somewhere else</option>
                    </select>
                  </div>
                  {answers.source && (
                    <div className="space-y-2">
                      <Label htmlFor="source-detail">
                        Which one? <span className="text-muted-foreground">(optional)</span>
                      </Label>
                      <Input
                        id="source-detail"
                        maxLength={120}
                        placeholder="e.g. Google, Claude, Reddit, Product Hunt"
                        value={answers.sourceDetail ?? ''}
                        onChange={(event) => update({ sourceDetail: event.target.value })}
                      />
                    </div>
                  )}
                </>
              )}

              {step === 'plans' && (
                <>
                  <Notice>
                    {estimatedDownloads === null ? (
                      'One download means one device downloading one update. You can start Free and change plans later.'
                    ) : (
                      <>
                        Your estimate:{' '}
                        <strong>
                          {answers.activeUsers!.toLocaleString('en-US')} active users ×{' '}
                          {answers.updatesPerMonth} updates ≈{' '}
                          {estimatedDownloads.toLocaleString('en-US')} downloads/month.
                        </strong>{' '}
                        Actual usage depends on active devices and how many updates each device
                        downloads.
                      </>
                    )}
                  </Notice>
                  {hasSubscription ? (
                    <div className="rounded-xl border p-6">
                      <h2 className="text-lg font-medium">
                        Your workspace already has{' '}
                        {currentPlan === 'pro'
                          ? 'Pro'
                          : currentPlan === 'starter'
                            ? 'Starter'
                            : 'Enterprise'}
                        .
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Your current subscription covers this app. You can manage it in Billing.
                      </p>
                      <Button className="mt-5" onClick={() => choosePlan(currentPlan)}>
                        Continue with current plan
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      {!billingEnabled && (
                        <Notice>
                          Billing is not enabled on this instance. Continue with the included plan
                          to set up your app.
                        </Notice>
                      )}
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <PlanCard
                          name="Free"
                          price="$0"
                          priceNote="No card required"
                          subtitle={`${freeDownloads.toLocaleString('en-US')} downloads / month`}
                          features={[
                            'Unlimited apps and updates',
                            'Dashboard + CLI',
                            'Single-member workspace',
                            'Hard cap — no overage',
                          ]}
                          current={false}
                          actionLabel="Start Free"
                          actionIcon={Leaf}
                          disabled={busy}
                          onAction={() => choosePlan('free')}
                          highlighted={
                            estimatedDownloads !== null && estimatedDownloads <= freeDownloads
                          }
                        />
                        <PlanCard
                          name="Starter"
                          price="$10"
                          priceNote="Billed monthly"
                          subtitle="100,000 downloads / month"
                          features={[
                            'Unlimited apps and updates',
                            'Dashboard + CLI',
                            'Single-member workspace',
                            'Hard cap — no overage',
                          ]}
                          current={false}
                          actionLabel="Choose Starter"
                          actionIcon={Rocket}
                          disabled={busy || !billingEnabled || freeDownloads >= 100_000}
                          onAction={() => choosePlan('starter')}
                          highlighted={
                            estimatedDownloads !== null &&
                            estimatedDownloads > freeDownloads &&
                            estimatedDownloads <= 100_000
                          }
                        />
                        <PlanCard
                          name="Pro"
                          price="$25"
                          priceNote="Billed $300/year, or $50 monthly"
                          subtitle="1,000,000 downloads / month"
                          features={[
                            'Everything in Free',
                            'Team members and roles',
                            'Optional overage: $50 / extra 1M',
                            'Priority support',
                          ]}
                          current={false}
                          actionLabel="Choose Pro"
                          actionIcon={Star}
                          disabled={busy || !billingEnabled}
                          actionItems={[
                            {
                              label: 'Yearly',
                              description: '$300/year · $25/month',
                              onSelect: () => choosePlan('pro', 'year'),
                            },
                            {
                              label: 'Monthly',
                              description: '$50/month',
                              onSelect: () => choosePlan('pro', 'month'),
                            },
                          ]}
                          highlighted={estimatedDownloads !== null && estimatedDownloads > 100_000}
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
                          disabled={busy || !billingEnabled}
                          onAction={() => {
                            window.location.href = `${SUPPORT_MAILTO}?subject=OtaKit%20Enterprise`;
                          }}
                        />
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Free and Starter stop serving updates at their included limits. Pro overage
                        is optional. Paid plans open checkout after you register your app; selecting
                        a plan here does not charge you.
                      </p>
                    </>
                  )}
                </>
              )}

              {step === 'connect' && (
                <>
                  <div className="space-y-3">
                    <Label htmlFor="app-identifier">App identifier</Label>
                    <Input
                      id="app-identifier"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      maxLength={120}
                      placeholder="my-app"
                      value={slug}
                      onChange={(event) => {
                        setSlug(event.target.value);
                        setError(null);
                      }}
                      aria-describedby="identifier-help"
                      aria-invalid={Boolean(error)}
                      className="h-12 text-base"
                    />
                    <p id="identifier-help" className="text-sm leading-6 text-muted-foreground">
                      Choose any unique label within this workspace, such as <code>my-app</code> or{' '}
                      <code>acme-mobile</code>. It does not need to match your App Store, Android,
                      or Capacitor app ID. Use 3–120 letters, numbers, dots, underscores, or
                      hyphens.
                    </p>
                  </div>
                  <Notice>
                    <strong>
                      {hasSubscription
                        ? `Covered by your current ${currentPlan} plan.`
                        : answers.selectedPlan === 'free'
                          ? 'Starting on Free. No credit card required.'
                          : `Selected: ${answers.selectedPlan === 'pro' ? `Pro — ${answers.billingInterval === 'year' ? '$300/year' : '$50/month'}` : 'Starter — $10/month'}.`}
                    </strong>
                    <p className="mt-2">
                      This registers your app in OtaKit. Next, we’ll show you the plugin
                      installation and your OtaKit app ID. Registering here does not change your
                      existing app or publish an update.
                    </p>
                  </Notice>
                </>
              )}
            </fieldset>
            <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
              {index > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep(ONBOARDING_STEPS[index - 1]);
                  }}
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Progress saves when you continue.
                </span>
              )}
              {step !== 'plans' && (
                <Button
                  type="submit"
                  disabled={busy}
                  className="ml-auto h-auto min-h-9 max-w-full shrink-0 whitespace-normal py-2"
                >
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {unsupported
                    ? 'Save and explore dashboard'
                    : step === 'connect'
                      ? needsCheckout
                        ? 'Connect and continue to checkout'
                        : 'Connect your app'
                      : 'Continue'}
                  {!busy && <ArrowRight className="size-4" />}
                </Button>
              )}
            </div>
          </form>
        )}
        <p className="mt-10 text-sm text-muted-foreground">
          Need a hand?{' '}
          <a href={SUPPORT_MAILTO} className="underline underline-offset-4 hover:text-foreground">
            Contact us
          </a>
          .
        </p>
      </main>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm leading-6">
      {children}
    </div>
  );
}

function Choices({
  name,
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  name: string;
  label: string;
  value?: string;
  options: Array<[string, string, string?]>;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-medium">{label}</legend>
      <div className={`grid gap-3 ${compact ? 'grid-cols-2 sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {options.map(([id, title, hint]) => (
          <label
            key={id}
            className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring ${value === id ? 'border-foreground bg-muted/50' : 'border-border hover:border-foreground/40'}`}
          >
            <input
              className="mt-0.5 size-4 shrink-0 accent-foreground"
              type="radio"
              name={name}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
            />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              {hint && (
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{hint}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function UsageInput({
  id,
  label,
  hint,
  value,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: number | null | undefined;
  max: number;
  onChange: (value: number | null | undefined) => void;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor={id}>{label}</Label>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {hint}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Input
          id={id}
          className="max-w-52"
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          placeholder="e.g. 1000"
          value={value ?? ''}
          aria-describedby={`${id}-hint`}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={value === null}
            onChange={(event) => onChange(event.target.checked ? null : undefined)}
          />
          Not sure yet
        </label>
      </div>
    </div>
  );
}

function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="mt-3">
      <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
        <pre
          tabIndex={0}
          className="min-w-0 flex-1 overflow-x-auto rounded-sm text-sm leading-6 focus-visible:outline-2 focus-visible:outline-ring"
        >
          <code>{text}</code>
        </pre>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy to clipboard"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground" role="status">
        {copyError ? 'Select and copy the text above.' : copied ? 'Copied' : ''}
      </span>
    </div>
  );
}
