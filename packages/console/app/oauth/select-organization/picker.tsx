'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Building2, LoaderCircle } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
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

  async function continueAuthorization() {
    setBusy(true);
    setError(null);
    try {
      const selection = await fetch('/api/v1/me/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: selected }),
      });
      if (!selection.ok) {
        const body = (await selection.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not select organization');
      }

      const { data, error: continueError } = await authClient.oauth2.continue({
        postLogin: true,
      });
      if (continueError)
        throw new Error(continueError.message ?? 'Authorization could not continue');
      if (data?.url) window.location.assign(data.url);
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
            This agent connection will stay bound to the organization you choose, even if you switch
            workspaces in the dashboard later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <RadioGroup value={selected} onValueChange={setSelected}>
            {organizations.map((organization) => (
              <Label
                key={organization.id}
                htmlFor={`organization-${organization.id}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-4"
              >
                <RadioGroupItem id={`organization-${organization.id}`} value={organization.id} />
                <Building2 className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{organization.name}</span>
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
