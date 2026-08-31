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

type OrganizationChoice = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
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
      ? (initialOrganizationId ?? organizations[0].id)
      : organizations[0].id,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const duplicateNames = new Set(
    organizations
      .filter(
        (organization, index) =>
          organizations.findIndex((candidate) => candidate.name === organization.name) !== index,
      )
      .map((organization) => organization.name),
  );

  async function continueAuthorization() {
    setBusy(true);
    setError(null);
    try {
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
      setBusy(false);
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
                <Building2 className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {organization.name}
                    {duplicateNames.has(organization.name)
                      ? ` · ${organization.id.slice(0, 8)}`
                      : ''}
                  </span>
                  <span className="block text-xs capitalize text-muted-foreground">
                    {organization.role}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" disabled={busy || !selected} onClick={continueAuthorization}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Continue
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
