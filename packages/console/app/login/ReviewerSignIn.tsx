'use client';

import { FormEvent, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Password sign-in for pre-created app-directory reviewer accounts (OpenAI,
 * Anthropic), who cannot receive email codes. Rendered only when
 * OTAKIT_REVIEWER_LOGIN is on; password sign-up stays disabled either way.
 */
export function ReviewerSignIn({ authorizationPath }: { authorizationPath: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        Reviewer sign-in
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // On an OAuth sign-in page the auth client attaches the pending request, and
    // the response names where to continue, exactly as the email code flow does.
    const { data, error: signInError } = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) {
      setError('That email and password did not match.');
      setBusy(false);
      return;
    }
    const oauthRedirect = (data as { url?: unknown } | null)?.url;
    window.location.href =
      typeof oauthRedirect === 'string' && oauthRedirect.length > 0
        ? oauthRedirect
        : (authorizationPath ?? '/dashboard');
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-border pt-5">
      <div className="space-y-2">
        <Label htmlFor="reviewer-email">Reviewer email</Label>
        <Input
          id="reviewer-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
          className="h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="reviewer-password">Password</Label>
        <Input
          id="reviewer-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>
      <Button type="submit" variant="outline" className="h-11 w-full gap-2" disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
        Sign in as reviewer
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
