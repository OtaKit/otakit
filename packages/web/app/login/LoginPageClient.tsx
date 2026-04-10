'use client';

import Image from 'next/image';
import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, Mail } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

type LoginPageClientProps = {
  googleEnabled: boolean;
  appleEnabled: boolean;
};

type Step = 'email' | 'otp';
type SocialProvider = 'google' | 'apple';

export function LoginPageClient({ googleEnabled, appleEnabled }: LoginPageClientProps) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'otp-send' | 'otp-verify' | SocialProvider | null>(
    null,
  );

  const socialProviders = useMemo(
    () =>
      [
        googleEnabled
          ? { id: 'google' as const, label: 'Continue with Google', icon: GoogleMark }
          : null,
        appleEnabled
          ? { id: 'apple' as const, label: 'Continue with Apple', icon: AppleMark }
          : null,
      ].filter(
        (provider): provider is { id: SocialProvider; label: string; icon: typeof GoogleMark } =>
          Boolean(provider),
      ),
    [appleEnabled, googleEnabled],
  );

  const busy = busyAction !== null;

  async function signInWith(provider: SocialProvider) {
    setError(null);
    setBusyAction(provider);
    try {
      const { data, error: signInError } = await authClient.signIn.social({
        provider,
        callbackURL: '/dashboard',
        newUserCallbackURL: '/dashboard/settings?pricing=1',
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
      window.location.href = '/dashboard';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Failed to sign in with ${provider}`);
      setBusyAction(null);
    }
  }

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
      const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
        email: trimmed,
        type: 'sign-in',
      });
      if (sendError) {
        throw new Error(sendError.message ?? 'Failed to send code');
      }
      setStep('otp');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to send code');
    } finally {
      setBusyAction(null);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = otp.trim();
    if (trimmed.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }

    setBusyAction('otp-verify');
    try {
      const { data, error: signInError } = await authClient.signIn.emailOtp({
        email: email.trim().toLowerCase(),
        otp: trimmed,
      });
      if (signInError) {
        throw new Error(signInError.message ?? 'Invalid code');
      }

      const createdAt = data?.user?.createdAt
        ? new Date(data.user.createdAt).getTime()
        : Number.NaN;
      const isLikelyNewUser =
        Number.isFinite(createdAt) && Math.abs(Date.now() - createdAt) <= 5 * 60 * 1000;

      window.location.href = isLikelyNewUser ? '/dashboard/settings?pricing=1' : '/dashboard';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid code');
      setBusyAction(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-screen-xl border-x border-border">
        <div className="relative min-h-screen">
          <div className="pointer-events-none absolute inset-0 hidden lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
            <div />
            <div className="border-x border-border" />
            <div />
          </div>

          <div className="relative flex min-h-screen flex-col justify-center">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
              <div className="hidden lg:block" />
              <div className="p-5 border-t border-border flex items-center gap-2.5">
                <Image
                  src="/logo.svg"
                  alt="OtaKit"
                  width={24}
                  height={24}
                  className="size-6 rounded-md"
                />

                <h1 className="text-2xl font-semibold">Sign in or create an account</h1>
              </div>
              <div className="hidden lg:block" />
            </div>

            <div className="border-y border-border">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
                <div className="hidden lg:block" />
                <div className="">
                  <div className="p-5">
                    <div className="space-y-5">
                      {step === 'email' && socialProviders.length > 0 ? (
                        <>
                          <div className="space-y-3">
                            {socialProviders.map((provider) => (
                              <Button
                                key={provider.id}
                                type="button"
                                variant="outline"
                                className="h-11 w-full justify-center gap-3 rounded-full"
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
                            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                              Or email
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
                          <Button
                            type="submit"
                            className="h-11 w-full rounded-full gap-2"
                            disabled={busy}
                          >
                            {busyAction === 'otp-send' ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <Mail className="size-4" />
                            )}
                            {busyAction === 'otp-send' ? 'Sending code...' : 'Continue with email'}
                          </Button>
                        </form>
                      ) : (
                        <form onSubmit={verifyOtp} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="login-otp">Verification code</Label>
                            <Input
                              id="login-otp"
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={otp}
                              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                              placeholder="000000"
                              autoFocus
                              className="h-12 text-center font-mono text-lg tracking-[0.45em]"
                            />
                          </div>
                          <Button
                            type="submit"
                            className="h-11 w-full rounded-full"
                            disabled={busy}
                          >
                            {busyAction === 'otp-verify' ? (
                              <>
                                <LoaderCircle className="size-4 animate-spin" />
                                Verifying...
                              </>
                            ) : (
                              'Sign in'
                            )}
                          </Button>
                          <button
                            type="button"
                            onClick={() => {
                              setStep('email');
                              setOtp('');
                              setError(null);
                            }}
                            className="w-full text-sm text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Use a different email
                          </button>
                        </form>
                      )}

                      {error ? (
                        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                          {error}
                        </div>
                      ) : null}

                      <p className="text-center text-xs leading-relaxed text-muted-foreground">
                        By continuing, you agree to the{' '}
                        <Link
                          href="/terms"
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          Terms of Use
                        </Link>{' '}
                        and{' '}
                        <Link
                          href="/policy"
                          className="underline underline-offset-4 hover:text-foreground"
                        >
                          Privacy Policy
                        </Link>
                        .
                      </p>
                    </div>
                  </div>
                  <div className="hidden lg:block" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)_minmax(0,1fr)]">
              <div className="hidden lg:block" />
              <div className="p-6 border-b border-border">
                <Link
                  href="/"
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground flex items-center gap-2"
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Link>
              </div>
              <div className="hidden lg:block" />
            </div>
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
