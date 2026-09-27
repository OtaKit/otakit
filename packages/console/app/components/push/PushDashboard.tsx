'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  Bell,
  CheckCircle2,
  ChevronsUpDown,
  Cpu,
  History,
  LoaderCircle,
  Send,
  Settings2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type { ApiError, DashboardInitialData } from '@/app/components/dashboard-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

import { PushCampaigns } from './PushCampaigns';
import { PushComposer } from './PushComposer';
import { PushDevices } from './PushDevices';
import { SectionHeader } from './SectionHeader';
import { usePushAddon } from './use-push-addon';

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
const DOCS_URL = 'https://otakit.app/docs/push';

async function readError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  return data?.error ?? fallback;
}

function canManageWorkspace(initialData: DashboardInitialData): boolean {
  return (
    initialData.activeOrganization.role === 'owner' ||
    initialData.activeOrganization.role === 'admin'
  );
}

export function PushDashboard({ initialData }: { initialData: DashboardInitialData }) {
  if (!initialData.activeOrganization.pushEnabled) {
    return <PushAddonOff initialData={initialData} />;
  }
  return <PushWorkspace initialData={initialData} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <DashboardHeader activeSection="push" showPush />
      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">{children}</main>
    </div>
  );
}

function EmptyCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="rounded-lg border border-dashed border-border py-12 text-center">
        <Icon className="mx-auto size-6 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">{title}</p>
        <div className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function PushAddonOff({ initialData }: { initialData: DashboardInitialData }) {
  const { saving, setEnabled } = usePushAddon();
  return (
    <Shell>
      <section className="mx-auto w-full max-w-screen-xl">
        <EmptyCard icon={Bell} title="Push notifications are off">
          <p>Free push for your Capacitor apps on iOS and Android.</p>
          <div className="mt-5">
            {canManageWorkspace(initialData) ? (
              <Button size="sm" onClick={() => void setEnabled(true)} disabled={saving}>
                {saving && <LoaderCircle className="size-3.5 animate-spin" />}
                Turn on
              </Button>
            ) : (
              <p className="text-xs">Ask a workspace owner or admin to turn it on in Settings.</p>
            )}
          </div>
          <p className="mt-4">
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Read the docs
            </a>
          </p>
        </EmptyCard>
      </section>
    </Shell>
  );
}

function PushWorkspace({ initialData }: { initialData: DashboardInitialData }) {
  const apps = initialData.apps;
  const canManage = canManageWorkspace(initialData);

  const [appId, setAppId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [sentCount, setSentCount] = useState(0);

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

  const loadCredentials = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/v1/apps/${id}/push/credentials`);
      if (!response.ok) throw new Error(await readError(response, 'Failed to load keys'));
      const payload = (await response.json()) as { credentials: CredentialSummary[] };
      setCredentials(payload.credentials);
    } catch (error) {
      setCredentials([]);
      toast.error(error instanceof Error ? error.message : 'Failed to load keys');
    }
  }, []);

  useEffect(() => {
    if (!appId) return;
    try {
      localStorage.setItem(SELECTED_APP_KEY, appId);
    } catch {
      // Storage is optional.
    }
    void loadCredentials(appId);
  }, [appId, loadCredentials]);

  const selectedApp = apps.find((app) => app.id === appId) ?? null;
  const configured = (credentials?.length ?? 0) > 0;

  const setup = appId ? (
    <SetupContent
      appId={appId}
      bundleIdHint={selectedApp?.slug ?? ''}
      credentials={credentials ?? []}
      canManage={canManage}
      onChanged={() => void loadCredentials(appId)}
    />
  ) : null;

  return (
    <Shell>
      {/* App selector bar, as on the main dashboard */}
      <section className="border-b border-border">
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3 px-6 pb-5 pt-8">
          <h2 className="flex items-center gap-3 text-[15px] font-semibold">
            <Cpu className="size-6 shrink-0 text-muted-foreground" />
            App
          </h2>
          <div className="mx-1 h-4 w-px bg-border" />
          {apps.length > 0 ? (
            <Select
              value={appId ?? ''}
              onValueChange={(value) => {
                setCredentials(null);
                setAppId(value);
              }}
            >
              <SelectTrigger
                className="h-8 w-40 border-0 bg-transparent px-2 shadow-none hover:bg-accent sm:w-56"
                icon={<ChevronsUpDown className="size-4 opacity-50" />}
              >
                <SelectValue placeholder="Select app" />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.id} value={app.id}>
                    {app.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm text-muted-foreground">No apps yet</span>
          )}
          {configured ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-8 text-muted-foreground"
              onClick={() => setSetupOpen(true)}
            >
              <Settings2 className="size-3.5" />
              Setup
            </Button>
          ) : null}
        </div>
      </section>

      {apps.length === 0 ? (
        <section className="mx-auto w-full max-w-screen-xl">
          <EmptyCard icon={Cpu} title="Connect an app first">
            <p>Push notifications are sent per app. Create one on the dashboard.</p>
          </EmptyCard>
        </section>
      ) : !appId || credentials === null ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !configured ? (
        <section className="mx-auto w-full max-w-screen-xl bg-muted/30">
          <SectionHeader
            icon={Settings2}
            title="Set up push"
            subtitle="Add your Apple and Google keys, then register devices from your app"
          />
          {setup}
        </section>
      ) : (
        <>
          <section className="mx-auto w-full max-w-screen-xl bg-muted/30">
            <SectionHeader
              icon={Send}
              title="New notification"
              subtitle="Delivered right away to the devices you choose"
            />
            <PushComposer appId={appId} onSent={() => setSentCount((value) => value + 1)} />
          </section>
          <Separator />
          <section className="mx-auto w-full max-w-screen-xl bg-muted/30">
            <SectionHeader icon={History} title="Sent" subtitle="Recent notifications" />
            <PushCampaigns appId={appId} refreshKey={sentCount} />
          </section>
          <Separator />
          <section className="mx-auto w-full max-w-screen-xl flex-1 bg-muted/30">
            <PushDevices appId={appId} />
          </section>
          <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Push setup</DialogTitle>
                <DialogDescription>
                  Keys for {selectedApp?.slug ?? 'this app'} and the code for your app.
                </DialogDescription>
              </DialogHeader>
              <div className="-mx-6 -mb-6 border-t border-border">{setup}</div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </Shell>
  );
}

function SetupContent({
  appId,
  bundleIdHint,
  credentials,
  canManage,
  onChanged,
}: {
  appId: string;
  bundleIdHint: string;
  credentials: CredentialSummary[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const apns = credentials.find((credential) => credential.provider === 'apns') ?? null;
  const fcm = credentials.find((credential) => credential.provider === 'fcm') ?? null;
  return (
    <div className="divide-y divide-border">
      {canManage ? (
        <>
          <ApnsCard
            key={`apns:${appId}:${apns?.updatedAt ?? 'none'}`}
            appId={appId}
            defaultBundleId={bundleIdHint}
            credential={apns}
            onChanged={onChanged}
          />
          <FcmCard
            key={`fcm:${appId}:${fcm?.updatedAt ?? 'none'}`}
            appId={appId}
            credential={fcm}
            onChanged={onChanged}
          />
        </>
      ) : (
        <p className="px-6 py-5 text-sm text-muted-foreground">
          Only workspace owners and admins can add or change keys.
        </p>
      )}
      <InstallSnippet appId={appId} />
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
    <section className="space-y-4 px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Apple (APNs)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            APNs key from Apple Developer → Keys. The bundle ID needs Push Notifications enabled in
            the same team.
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
    <section className="space-y-4 px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Google (Firebase Cloud Messaging)</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Service account key from Firebase → Project settings → Service accounts.
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

function InstallSnippet({ appId }: { appId: string }) {
  const code = `npm install @capacitor/push-notifications @otakit/push

import { PushNotifications } from '@capacitor/push-notifications';
import { OtaKitPush } from '@otakit/push';

OtaKitPush.init({ appId: '${appId}' });
PushNotifications.addListener('registration', ({ value }) => OtaKitPush.syncToken(value));
if ((await PushNotifications.requestPermissions()).receive === 'granted') {
  await PushNotifications.register();
}`;
  return (
    <section className="space-y-2 px-6 py-6">
      <h3 className="text-sm font-semibold">Add it to your app</h3>
      <p className="text-xs text-muted-foreground">
        iOS needs the Push Notifications capability and two AppDelegate methods; Android needs
        google-services.json.{' '}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Full guide
        </a>
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border bg-background px-4 py-3 font-mono text-[11px] leading-5">
        {code}
      </pre>
    </section>
  );
}
