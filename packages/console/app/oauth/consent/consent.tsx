'use client';

import Image from 'next/image';
import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const SCOPE_LABELS: Record<string, string> = {
  'otakit:read': 'Read apps, bundles, releases, rollout events, and account status',
  'otakit:app:write': 'Create apps',
  'otakit:bundle:write': 'Delete unused bundles',
  'otakit:release:write': 'Publish and revert releases',
  offline_access: 'Stay connected until you revoke access',
};

export function OAuthConsent({
  client,
  organizationName,
  scopes,
}: {
  client: { name: string; uri: string | null };
  organizationName: string | null;
  scopes: string[];
}) {
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      const { data, error: consentError } = await authClient.oauth2.consent({ accept });
      if (consentError) throw new Error(consentError.message ?? 'Authorization failed');
      if (!data?.url) throw new Error('Authorization did not return a redirect');
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authorization failed');
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Image src="/logo.svg" alt="OtaKit" width={32} height={32} className="rounded-lg" />
            <span className="font-semibold">OtaKit MCP</span>
          </div>
          <CardTitle>Authorize {client.name}</CardTitle>
          <CardDescription>
            {client.uri ? <span className="block break-all">{client.uri}</span> : null}
            <span className={client.uri ? 'mt-1 block' : undefined}>
              {organizationName
                ? `Access is limited to ${organizationName}.`
                : 'Access is limited to the organization you selected.'}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-4">
            <p className="mb-3 text-sm font-medium">Requested access</p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              {scopes.map((scope) => (
                <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            You can revoke this connection at any time from Settings → MCP connections.
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => decide(false)}>
            {busy === 'deny' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Deny
          </Button>
          <Button disabled={busy !== null} onClick={() => decide(true)}>
            {busy === 'allow' ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Allow access
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
