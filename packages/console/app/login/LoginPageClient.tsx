'use client';

import Image from 'next/image';
import {
  type CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowLeft, LoaderCircle, Mail } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type LoginPageClientProps = {
  googleEnabled: boolean;
  appleEnabled: boolean;
  githubEnabled: boolean;
  siteUrl: string;
  /** Pending MCP authorization to return to after sign-in, if any. */
  authorizationPath: string | null;
  /** Why the last attempt came back here, when it came back here at all. */
  initialError: string | null;
};

type Step = 'email' | 'otp';
type SocialProvider = 'google' | 'apple' | 'github';

/** Codes are valid for five minutes; resending sooner rarely helps. */
const RESEND_COOLDOWN_SECONDS = 30;
const OTP_LENGTH = 6;

type LoginIcon = {
  src: string;
  top: string;
  left?: string;
  right?: string;
  size: number;
  opacity: number;
  rotate: number;
  // Independent drift: delta x/y (px), rotation delta (deg), duration (s).
  dx: number;
  dy: number;
  dr: number;
  dur: number;
};

const LOGIN_ICON_CLOUD: LoginIcon[] = [
  {
    src: '/app-icons/time-tracking.svg',
    top: '12%',
    left: '7%',
    size: 56,
    opacity: 0.1,
    rotate: -16,
    dx: 11,
    dy: -14,
    dr: 4,
    dur: 7.5,
  },
  {
    src: '/app-icons/ai-chat.svg',
    top: '23%',
    left: '21%',
    size: 62,
    opacity: 0.07,
    rotate: 12,
    dx: -10,
    dy: -9,
    dr: -4.5,
    dur: 9,
  },
  {
    src: '/app-icons/calorie-tracking.svg',
    top: '13%',
    right: '10%',
    size: 60,
    opacity: 0.09,
    rotate: -8,
    dx: 14,
    dy: 11,
    dr: 3,
    dur: 6.5,
  },
  {
    src: '/app-icons/recording.svg',
    top: '43%',
    right: '6%',
    size: 46,
    opacity: 0.08,
    rotate: 20,
    dx: -9,
    dy: 13,
    dr: 5,
    dur: 8.5,
  },
  {
    src: '/app-icons/fitness.svg',
    top: '60%',
    left: '6%',
    size: 84,
    opacity: 0.06,
    rotate: -18,
    dx: 15,
    dy: -11,
    dr: -3.5,
    dur: 7,
  },
  {
    src: '/app-icons/budget.svg',
    top: '74%',
    right: '21%',
    size: 50,
    opacity: 0.09,
    rotate: 10,
    dx: -13,
    dy: -10,
    dr: 4,
    dur: 8,
  },
  {
    src: '/app-icons/habit-tracker.svg',
    top: '80%',
    right: '9%',
    size: 70,
    opacity: 0.06,
    rotate: 14,
    dx: 10,
    dy: 14,
    dr: -3,
    dur: 6,
  },
];

/* Very gentle, endless drift + rotation for the login background icons only.
   The base position/rotation lives on each icon's wrapper; this only nudges it
   a couple of pixels and ~1.5deg. Disabled under prefers-reduced-motion. */
const FLOAT_STYLES = `
@keyframes login-float {
  0% { transform: translate(0px, 0px) rotate(0deg); }
  25% { transform: translate(var(--dx), 0px) rotate(var(--dr)); }
  50% { transform: translate(var(--dx), var(--dy)) rotate(0deg); }
  75% { transform: translate(0px, var(--dy)) rotate(calc(var(--dr) * -1)); }
  100% { transform: translate(0px, 0px) rotate(0deg); }
}
.login-float-icon {
  animation-name: login-float;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .login-float-icon { animation: none; }
}
`;

export function LoginPageClient({
  googleEnabled,
  appleEnabled,
  githubEnabled,
  siteUrl,
  authorizationPath,
  initialError,
}: LoginPageClientProps) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [error, setError] = useState<string | null>(initialError);
  const [busyAction, setBusyAction] = useState<'otp-send' | 'otp-verify' | SocialProvider | null>(
    null,
  );
  const [resendIn, setResendIn] = useState(0);
  // A complete code submits itself; this stops the click handler from racing it.
  const submittedCode = useRef<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const socialProviders = useMemo(
    () =>
      [
        googleEnabled
          ? { id: 'google' as const, label: 'Continue with Google', icon: GoogleMark }
          : null,
        githubEnabled
          ? { id: 'github' as const, label: 'Continue with GitHub', icon: GitHubMark }
          : null,
        appleEnabled
          ? { id: 'apple' as const, label: 'Continue with Apple', icon: AppleMark }
          : null,
      ].filter(
        (provider): provider is { id: SocialProvider; label: string; icon: typeof GoogleMark } =>
          Boolean(provider),
      ),
    [appleEnabled, githubEnabled, googleEnabled],
  );

  const busy = busyAction !== null;

  async function signInWith(provider: SocialProvider) {
    setError(null);
    setBusyAction(provider);
    try {
      const { data, error: signInError } = await authClient.signIn.social({
        provider,
        // A pending MCP authorization outranks the dashboard for both new and
        // returning users; otherwise this is unchanged.
        callbackURL: authorizationPath ?? '/dashboard',
        newUserCallbackURL: authorizationPath ?? '/dashboard?pricing=1',
        errorCallbackURL: '/login',
        disableRedirect: true,
      });
      if (signInError) {
        throw new Error(signInError.message ?? `Failed to sign in with ${provider}`);
      }
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      // Social sign-in with disableRedirect always answers with a provider URL.
      // Navigating to the dashboard on the strength of a reply that has none
      // just bounces off the session check and looks like a dead button.
      throw new Error(`${provider} did not return a sign-in URL. Please try again.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Failed to sign in with ${provider}`);
      setBusyAction(null);
    }
  }

  const requestCode = useCallback(async (address: string) => {
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email: address,
      type: 'sign-in',
    });
    if (sendError) throw new Error(sendError.message ?? 'Failed to send code');
    setResendIn(RESEND_COOLDOWN_SECONDS);
  }, []);

  async function sendOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Email is required');
      return;
    }

    setBusyAction('otp-send');
    try {
      await requestCode(trimmed);
      setStep('otp');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to send code');
    } finally {
      setBusyAction(null);
    }
  }

  async function resendOtp() {
    if (resendIn > 0 || busy) return;
    setError(null);
    setOtp('');
    submittedCode.current = null;
    setBusyAction('otp-send');
    try {
      await requestCode(email.trim().toLowerCase());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to send code');
    } finally {
      setBusyAction(null);
    }
  }

  const verifyCode = useCallback(
    async (code: string) => {
      setError(null);
      setBusyAction('otp-verify');
      try {
        const { data, error: signInError } = await authClient.signIn.emailOtp({
          email: email.trim().toLowerCase(),
          otp: code,
        });
        if (signInError) {
          throw new Error(signInError.message ?? 'Invalid code');
        }

        const oauthRedirect = (data as { url?: unknown } | null)?.url;
        if (typeof oauthRedirect === 'string' && oauthRedirect.length > 0) {
          window.location.href = oauthRedirect;
          return;
        }
        if (authorizationPath) {
          window.location.href = authorizationPath;
          return;
        }

        // Both timestamps come from the server, so this never depends on the
        // browser clock: a freshly inserted user still has updatedAt === createdAt.
        const isNewUser =
          typeof data?.user?.createdAt !== 'undefined' &&
          String(data.user.createdAt) === String(data.user.updatedAt);

        window.location.href = isNewUser ? '/dashboard?pricing=1' : '/dashboard';
      } catch (cause) {
        submittedCode.current = null;
        setError(cause instanceof Error ? cause.message : 'Invalid code');
        setBusyAction(null);
      }
    },
    [authorizationPath, email],
  );

  function onOtpChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(digits);
    if (error) setError(null);
    // Submit as soon as the code is complete, the way every other OTP field does.
    if (digits.length === OTP_LENGTH && submittedCode.current !== digits && !busy) {
      submittedCode.current = digits;
      void verifyCode(digits);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    const trimmed = otp.trim();
    if (trimmed.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code`);
      return;
    }
    if (submittedCode.current === trimmed && busy) return;
    submittedCode.current = trimmed;
    await verifyCode(trimmed);
  }

  function backToEmail() {
    setStep('email');
    setOtp('');
    setError(null);
    setResendIn(0);
    submittedCode.current = null;
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Joyful background — dot grid + floating app-icon cloud, matching the site hero */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <style>{FLOAT_STYLES}</style>
        <div className="absolute inset-0 bg-[radial-gradient(circle,var(--color-border)_1.5px,transparent_1.5px)] bg-[size:28px_28px] opacity-60" />
        {LOGIN_ICON_CLOUD.map((icon, index) => (
          <div
            key={index}
            className="absolute"
            style={{
              top: icon.top,
              left: icon.left,
              right: icon.right,
              opacity: icon.opacity,
              transform: `rotate(${icon.rotate}deg)`,
            }}
          >
            <Image
              src={icon.src}
              alt=""
              width={icon.size}
              height={icon.size}
              className="login-float-icon block select-none rounded-[22%]"
              style={
                {
                  animationDuration: `${icon.dur}s`,
                  animationDelay: `${-(index * 1.7)}s`,
                  '--dx': `${icon.dx}px`,
                  '--dy': `${icon.dy}px`,
                  '--dr': `${icon.dr}deg`,
                } as CSSProperties
              }
            />
          </div>
        ))}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* On the code step this goes back one step, not out to the marketing site. */}
      {step === 'otp' ? (
        <button
          type="button"
          onClick={backToEmail}
          className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:left-6 sm:top-6"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
      ) : (
        <a
          href={siteUrl}
          className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:left-6 sm:top-6"
        >
          <ArrowLeft className="size-4" />
          Back
        </a>
      )}

      <div className="relative flex min-h-screen items-center justify-center px-4 py-16">
        <div className="relative w-full max-w-md bg-card">
          {/* Full-bleed frame — 2 horizontal (full width) + 2 vertical (full height) */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 z-10 h-px w-screen -translate-x-1/2 bg-border"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-1/2 z-10 h-px w-screen -translate-x-1/2 bg-border"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-1/2 z-10 h-screen w-px -translate-y-1/2 bg-border"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-1/2 z-10 h-screen w-px -translate-y-1/2 bg-border"
          />

          <div className="px-6 py-9 sm:px-9">
            <div className="flex items-center gap-3.5">
              <Image
                src="/logo.svg"
                alt="OtaKit"
                width={44}
                height={44}
                className="size-11 shrink-0 rounded-2xl"
              />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight">Sign in to OtaKit</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step === 'email' ? (
                    'Sign in or create your account'
                  ) : (
                    <>
                      Enter the code sent to <span className="text-foreground">{email}</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="-mx-6 my-7 border-t border-border sm:-mx-9" />

            <div className="space-y-5">
              {step === 'email' && socialProviders.length > 0 ? (
                <>
                  <div className="space-y-2.5">
                    {socialProviders.map((provider) => (
                      <Button
                        key={provider.id}
                        type="button"
                        variant="outline"
                        className="h-11 w-full justify-center gap-3"
                        disabled={busy}
                        onClick={() => signInWith(provider.id)}
                      >
                        {busyAction === provider.id ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <provider.icon className="size-4" />
                        )}
                        {provider.label}
                      </Button>
                    ))}
                  </div>
                  <div className="relative">
                    <Separator />
                    <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                      Or
                    </span>
                  </div>
                </>
              ) : null}

              {step === 'email' ? (
                <form onSubmit={sendOtp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoFocus
                      autoComplete="email"
                      className="h-11"
                    />
                  </div>
                  <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
                    {busyAction === 'otp-send' ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Mail className="size-4" />
                    )}
                    {busyAction === 'otp-send' ? 'Sending code...' : 'Continue with email OTP'}
                  </Button>
                </form>
              ) : (
                <form onSubmit={verifyOtp} className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <Label htmlFor="login-otp">Verification code</Label>
                      <span className="text-xs text-muted-foreground">Expires in 5 minutes</span>
                    </div>
                    <Input
                      id="login-otp"
                      name="otp"
                      type="text"
                      inputMode="numeric"
                      // Lets iOS and Chrome offer the emailed code as a one-tap suggestion.
                      autoComplete="one-time-code"
                      maxLength={OTP_LENGTH}
                      value={otp}
                      onChange={(e) => onOtpChange(e.target.value)}
                      placeholder="000000"
                      autoFocus
                      className="h-12 text-center font-mono text-lg tracking-[0.45em]"
                    />
                  </div>
                  <Button type="submit" className="h-11 w-full" disabled={busy}>
                    {busyAction === 'otp-verify' ? (
                      <>
                        <LoaderCircle className="size-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Sign in'
                    )}
                  </Button>
                  <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => void resendOtp()}
                      disabled={busy || resendIn > 0}
                      className="transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:text-muted-foreground"
                    >
                      {busyAction === 'otp-send'
                        ? 'Sending...'
                        : resendIn > 0
                          ? `Resend in ${resendIn}s`
                          : 'Resend code'}
                    </button>
                    <span aria-hidden className="text-border">
                      |
                    </span>
                    <button
                      type="button"
                      onClick={backToEmail}
                      className="transition-colors hover:text-foreground"
                    >
                      Use a different email
                    </button>
                  </div>
                </form>
              )}

              {error ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}
            </div>

            <p className="mt-7 text-left text-xs leading-relaxed text-muted-foreground">
              By continuing, you agree to the{' '}
              <a
                href={`${siteUrl}/terms`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Terms of Use
              </a>{' '}
              and{' '}
              <a
                href={`${siteUrl}/policy`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <path
        d="M21.6 12.23c0-.68-.06-1.33-.17-1.95H12v3.69h5.39a4.63 4.63 0 0 1-2 3.04v2.52h3.24c1.9-1.75 2.97-4.32 2.97-7.3Z"
        fill="#4285F4"
      />
      <path
        d="M12 22c2.7 0 4.97-.9 6.63-2.47l-3.24-2.52c-.9.6-2.04.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.04v2.6A10 10 0 0 0 12 22Z"
        fill="#34A853"
      />
      <path
        d="M6.39 13.85A6.01 6.01 0 0 1 6.08 12c0-.64.11-1.26.31-1.85v-2.6H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.45l3.35-2.6Z"
        fill="#FBBC04"
      />
      <path
        d="M12 6.03c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.96 3.04 14.7 2 12 2a10 10 0 0 0-8.96 5.55l3.35 2.6c.79-2.36 3-4.12 5.61-4.12Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.78 12.52c.03 3.07 2.7 4.1 2.73 4.12-.02.07-.42 1.44-1.39 2.86-.84 1.23-1.71 2.46-3.08 2.48-1.34.03-1.78-.8-3.32-.8-1.54 0-2.03.78-3.29.83-1.32.05-2.33-1.32-3.18-2.55C3.5 17.64 2.14 14.3 3.94 11.2c.9-1.54 2.5-2.52 4.24-2.55 1.29-.03 2.5.88 3.32.88.82 0 2.35-1.08 3.96-.92.67.03 2.56.27 3.77 2.04-.1.06-2.25 1.31-2.45 3.87Zm-2.12-8.9c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.25.68-2.98 1.54-.66.76-1.23 1.98-1.08 3.14 1.14.09 2.29-.58 3-1.43Z" />
    </svg>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}
