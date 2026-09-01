'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Building2, LoaderCircle } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import {
  OTAKIT_OAUTH_ORGANIZATION_HEADER,
  OTAKIT_OAUTH_ORGANIZATION_QUERY,
} from '@/lib/mcp/oauth-organization-shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type OrganizationChoice = {
  id: string;
  name: string;
  /** Human-readable line: role, plan, size, apps. */
  detail: string;
};

export function OAuthOrganizationPicker({
  initialOrganizationId,
  organizations,
}: {
  initialOrganizationId: string | null;
  organizations: OrganizationChoice[];
}) {
  const [selected, setSelected] = useState(
    organizations.some((organization) => organization.id === initialOrganizationId)
      ? (initialOrganizationId ?? organizations[0]?.id)
      : organizations[0]?.id,
  );
  const [busy, setBusy] = useState<'continue' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(accept ? 'continue' : 'cancel');
    setError(null);
    try {
      if (!accept) {
        // Deny the pending authorization outright, the same way the consent
        // step does, so the client gets an answer instead of hanging.
        const { data, error: denyError } = await authClient.oauth2.consent(
          { accept: false },
          { headers: { [OTAKIT_OAUTH_ORGANIZATION_HEADER]: selected } },
        );
        if (denyError) throw new Error(denyError.message ?? 'Could not cancel');
        window.location.assign(data?.url ?? '/dashboard');
        return;
      }

      const { data, error: continueError } = await authClient.oauth2.continue(
        { postLogin: true },
        { headers: { [OTAKIT_OAUTH_ORGANIZATION_HEADER]: selected } },
      );
      if (continueError)
        throw new Error(continueError.message ?? 'Authorization could not continue');
      if (!data?.url) throw new Error('Authorization did not return a redirect');
      const consentUrl = new URL(data.url, window.location.origin);
      if (
        consentUrl.origin === window.location.origin &&
        consentUrl.pathname === '/oauth/consent'
      ) {
        consentUrl.searchParams.set(OTAKIT_OAUTH_ORGANIZATION_QUERY, selected);
      }
      window.location.assign(consentUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authorization could not continue');
      setBusy(null);
    }
  }

  if (organizations.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Brand />
            <CardTitle>No organization available</CardTitle>
            <CardDescription>
              This account is not a member of an OtaKit organization yet, so there is nothing to
              connect an agent to. Create one in the dashboard, then start the connection again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => window.location.assign('/dashboard')}>
              Go to dashboard
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Brand />
          <CardTitle>Select an organization</CardTitle>
          <CardDescription>
            Choose which organization this MCP connection can access. It stays connected to that
            organization if you switch workspaces later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RadioGroup value={selected} onValueChange={setSelected}>
            {organizations.map((organization) => (
              <Label
                key={organization.id}
                htmlFor={`organization-${organization.id}`}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50',
                  selected === organization.id && 'border-foreground/20 bg-muted/50',
                )}
              >
                <RadioGroupItem id={`organization-${organization.id}`} value={organization.id} />
                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{organization.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {organization.detail}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void decide(false)}
            >
              {busy === 'cancel' ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={busy !== null || !selected}
              onClick={() => void decide(true)}
            >
              {busy === 'continue' ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function Brand() {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Image src="/logo.svg" alt="OtaKit" width={32} height={32} className="rounded-lg" />
      <span className="font-semibold">OtaKit MCP</span>
    </div>
  );
}
