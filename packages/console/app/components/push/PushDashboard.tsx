'use client';

import { useCallback, useEffect, useState } from 'react';

import { Bell, CheckCircle2, LoaderCircle, Lock, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type { ApiError, DashboardInitialData } from '@/app/components/dashboard-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

type Provider = 'apns' | 'fcm';

type CredentialSummary = {
  provider: Provider;
  apnsKeyId: string | null;
  apnsTeamId: string | null;
  apnsBundleId: string | null;
  fcmProjectId: string | null;
  fcmClientEmail: string | null;
  lastTestAt: string | null;
  lastTestResult: string | null;
  updatedAt: string;
};

type TestResult = { ok: boolean; result: string; message: string };

const SELECTED_APP_KEY = 'selectedAppId';

async function readError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  return data?.error ?? fallback;
}

export function PushDashboard({ initialData }: { initialData: DashboardInitialData }) {
  const apps = initialData.apps;
  const canManage =
    initialData.activeOrganization.role === 'owner' ||
    initialData.activeOrganization.role === 'admin';

  const [appId, setAppId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fromUrl = new URL(window.location.href).searchParams.get('app');
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SELECTED_APP_KEY);
    } catch {
      stored = null;
    }
    const preferred = [fromUrl, stored].find((id) => id && apps.some((app) => app.id === id));
    setAppId(preferred ?? apps[0]?.id ?? null);
  }, [apps]);

  const loadCredentials = useCallback(async (id: string, options: { quiet?: boolean } = {}) => {
    if (!options.quiet) setLoading(true);
    try {
      const response = await fetch(`/api/v1/apps/${id}/push/credentials`);
      if (!response.ok) throw new Error(await readError(response, 'Failed to load credentials'));
      const payload = (await response.json()) as { credentials: CredentialSummary[] };
      setCredentials(payload.credentials);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load credentials');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!appId) {
      setLoading(false);
      return;
    }
    try {
      localStorage.setItem(SELECTED_APP_KEY, appId);
    } catch {
      // Storage is optional.
    }
    void loadCredentials(appId);
  }, [appId, loadCredentials]);

  const selectedApp = apps.find((app) => app.id === appId) ?? null;
  const apns = credentials.find((credential) => credential.provider === 'apns') ?? null;
  const fcm = credentials.find((credential) => credential.provider === 'fcm') ?? null;

  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <DashboardHeader activeSection="push" />

      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="pointer-events-none absolute inset-0 z-10 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-3xl border-x border-border" />
        </div>
        <div className="relative mx-auto w-full max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pb-6 pt-8">
            <div className="flex items-center gap-3">
              <Bell className="size-6 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[15px] font-semibold leading-tight">Push notifications</h2>
                <p className="text-xs leading-tight text-muted-foreground">
                  Apple and Google credentials for sending
                </p>
              </div>
            </div>
            {apps.length > 0 && (
              <NativeSelect
                size="sm"
                value={appId ?? ''}
                onChange={(event) => setAppId(event.target.value)}
                aria-label="App"
              >
                {apps.map((app) => (
                  <NativeSelectOption key={app.id} value={app.id}>
                    {app.slug}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>

          {apps.length === 0 ? (
            <EmptyState title="No apps yet" body="Create an app in the dashboard first." />
          ) : !canManage ? (
            <EmptyState
              title="Admins only"
              body="Only workspace owners and admins can manage push credentials."
              locked
            />
          ) : loading || !appId ? (
            <div className="flex items-center justify-center py-24">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              <ApnsCard
                key={`apns:${appId}:${apns?.updatedAt ?? 'none'}`}
                appId={appId}
                defaultBundleId={selectedApp?.slug ?? ''}
                credential={apns}
                onChanged={() => loadCredentials(appId, { quiet: true })}
              />
              <FcmCard
                key={`fcm:${appId}:${fcm?.updatedAt ?? 'none'}`}
                appId={appId}
                credential={fcm}
                onChanged={() => loadCredentials(appId, { quiet: true })}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState({ title, body, locked }: { title: string; body: string; locked?: boolean }) {
  const Icon = locked ? Lock : Bell;
  return (
    <div className="m-5 rounded-lg border border-dashed py-12 text-center">
      <Icon className="mx-auto size-6 text-muted-foreground/40" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function StatusLine({ credential }: { credential: CredentialSummary | null }) {
  if (!credential) {
    return <p className="text-xs text-muted-foreground">Not set up</p>;
  }
  const tested = credential.lastTestResult;
  if (tested === 'ok') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600">
        <CheckCircle2 className="size-3.5" /> Verified
      </p>
    );
  }
  if (tested) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-destructive">
        <XCircle className="size-3.5" /> Test failed ({tested})
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Saved, not tested yet</p>;
}

function useCredentialActions(appId: string, provider: Provider, onChanged: () => void) {
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);

  async function save(body: Record<string, unknown>): Promise<boolean> {
    setBusy('save');
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/credentials/${provider}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not save'));
      toast.success('Saved. Testing it now…');
      onChanged();
      await test();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function test(): Promise<void> {
    setBusy('test');
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/credentials/${provider}/test`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(await readError(response, 'Test failed'));
      const result = (await response.json()) as TestResult;
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    setBusy('delete');
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/credentials/${provider}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not remove'));
      toast.success('Removed');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove');
    } finally {
      setBusy(null);
    }
  }

  return { busy, save, test, remove };
}

function ApnsCard({
  appId,
  defaultBundleId,
  credential,
  onChanged,
}: {
  appId: string;
  defaultBundleId: string;
  credential: CredentialSummary | null;
  onChanged: () => void;
}) {
  const { busy, save, test, remove } = useCredentialActions(appId, 'apns', onChanged);
  // The parent remounts this card (via `key`) when the stored credential changes,
  // so initial state is enough to reset the form.
  const [p8Pem, setP8Pem] = useState('');
  const [fileName, setFileName] = useState('');
  const [keyId, setKeyId] = useState(credential?.apnsKeyId ?? '');
  const [teamId, setTeamId] = useState(credential?.apnsTeamId ?? '');
  const [bundleId, setBundleId] = useState(credential?.apnsBundleId ?? defaultBundleId);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setP8Pem(await file.text());
    setFileName(file.name);
    // Apple names the file AuthKey_<KEYID>.p8.
    const match = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(file.name);
    if (match) setKeyId(match[1].toUpperCase());
  }

  return (
    <section className="space-y-4 px-5 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Apple (APNs)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            An APNs key from Apple Developer → Keys. One key works for every app in your team, so
            treat it like a password.
          </p>
        </div>
        <StatusLine credential={credential} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="apns-file">Key file (.p8)</Label>
          <Input
            id="apns-file"
            type="file"
            accept=".p8"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          {credential && !fileName && (
            <p className="text-xs text-muted-foreground">
              A key is stored. Upload a file only to replace it.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apns-key-id">Key ID</Label>
          <Input
            id="apns-key-id"
            value={keyId}
            onChange={(event) => setKeyId(event.target.value)}
            placeholder="ABC123DEFG"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apns-team-id">Team ID</Label>
          <Input
            id="apns-team-id"
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            placeholder="A1B2C3D4E5"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="apns-bundle-id">iOS bundle ID</Label>
          <Input
            id="apns-bundle-id"
            value={bundleId}
            onChange={(event) => setBundleId(event.target.value)}
            placeholder="com.example.app"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null || !p8Pem}
          onClick={() => void save({ p8Pem, keyId, teamId, bundleId })}
        >
          {busy === 'save' && <LoaderCircle className="size-3.5 animate-spin" />}
          {credential ? 'Replace key' : 'Save key'}
        </Button>
        {credential && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void test()}
            >
              {busy === 'test' && <LoaderCircle className="size-3.5 animate-spin" />}
              Test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function FcmCard({
  appId,
  credential,
  onChanged,
}: {
  appId: string;
  credential: CredentialSummary | null;
  onChanged: () => void;
}) {
  const { busy, save, test, remove } = useCredentialActions(appId, 'fcm', onChanged);
  const [json, setJson] = useState('');
  const [fileName, setFileName] = useState('');

  return (
    <section className="space-y-4 px-5 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Google (Firebase Cloud Messaging)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A service account key from Firebase → Project settings → Service accounts → Generate new
            private key.
          </p>
          {credential?.fcmProjectId && (
            <p className="mt-1 text-xs text-muted-foreground">
              Project <span className="font-mono">{credential.fcmProjectId}</span> ·{' '}
              <span className="font-mono">{credential.fcmClientEmail}</span>
            </p>
          )}
        </div>
        <StatusLine credential={credential} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fcm-file">Service account (.json)</Label>
        <Input
          id="fcm-file"
          type="file"
          accept=".json,application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setJson(await file.text());
            setFileName(file.name);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null || !json}
          onClick={() => void save({ serviceAccountJson: json })}
        >
          {busy === 'save' && <LoaderCircle className="size-3.5 animate-spin" />}
          {credential ? 'Replace service account' : 'Save service account'}
        </Button>
        {credential && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void test()}
            >
              {busy === 'test' && <LoaderCircle className="size-3.5 animate-spin" />}
              Test
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          </>
        )}
      </div>
      {fileName && <p className="text-xs text-muted-foreground">Selected: {fileName}</p>}
    </section>
  );
}
