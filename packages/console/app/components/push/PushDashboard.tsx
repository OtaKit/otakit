'use client';

import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';

import {
  Bell,
  Check,
  ChevronsUpDown,
  Copy,
  Cpu,
  Hash,
  KeyRound,
  LoaderCircle,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type { ApiError, DashboardInitialData } from '@/app/components/dashboard-types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

import { PushCampaigns } from './PushCampaigns';
import { PushDevices } from './PushDevices';
import { PushKeysDialog, type CredentialSummary } from './PushKeysDialog';
import { PushSendDialog } from './PushSendDialog';
import { PUSH_DOCS_URL, SectionHeader } from './SectionHeader';
import { usePushAddon } from './use-push-addon';

const SELECTED_APP_KEY = 'selectedAppId';

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
  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <DashboardHeader activeSection="push" showPush />
      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
        {/* Side borders around the content column, as on the main dashboard. */}
        <div className="pointer-events-none absolute inset-0 z-10 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-screen-xl border-x border-border" />
        </div>
        <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
          {initialData.activeOrganization.pushEnabled ? (
            <PushWorkspace initialData={initialData} />
          ) : (
            <PushAddonOff canManage={canManageWorkspace(initialData)} />
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  // Fills the rest of the page, like the empty Events box on the main dashboard.
  return (
    <div className="flex flex-1 p-5">
      <div className="flex min-h-64 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
        <Icon className="mx-auto size-6 text-muted-foreground/40" />
        <p className="mt-3 text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
        {action ? <div className="mt-5">{action}</div> : null}
        <p className="mt-4">
          <Link
            href={PUSH_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Read the push guide
          </Link>
        </p>
      </div>
    </div>
  );
}

function PushAddonOff({ canManage }: { canManage: boolean }) {
  const { saving, setEnabled } = usePushAddon();
  return (
    <section className="flex flex-1">
      <div className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col bg-muted/30">
        <EmptyState
          icon={Bell}
          title="Push notifications are off"
          description={
            canManage
              ? 'Free push for your Capacitor apps on iOS and Android.'
              : 'Ask a workspace owner or admin to turn them on in Settings.'
          }
          action={
            canManage ? (
              <Button size="sm" onClick={() => void setEnabled(true)} disabled={saving}>
                {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                Turn on
              </Button>
            ) : undefined
          }
        />
      </div>
    </section>
  );
}

function PushWorkspace({ initialData }: { initialData: DashboardInitialData }) {
  const apps = initialData.apps;
  const canManage = canManageWorkspace(initialData);

  const [appId, setAppId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[] | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [appIdCopied, setAppIdCopied] = useState(false);

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
      if (!response.ok) throw new Error(await readError(response, 'Failed to load push keys'));
      const payload = (await response.json()) as { credentials: CredentialSummary[] };
      setCredentials(payload.credentials);
    } catch (error) {
      setCredentials([]);
      toast.error(error instanceof Error ? error.message : 'Failed to load push keys');
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

  return (
    <>
      {/* App selector bar, as on the main dashboard */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-screen-xl">
          <div className="flex flex-wrap items-center gap-3 px-6 pb-5 pt-8">
            <h2 className="flex items-center gap-3 text-[15px] font-semibold">
              <Cpu className="size-6 shrink-0 text-muted-foreground" />
              App
            </h2>
            <div className="mx-1 h-4 w-px bg-border" />
            {apps.length > 0 ? (
              <>
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

                {selectedApp ? (
                  <div className="hidden items-center gap-3 sm:flex">
                    <Separator orientation="vertical" className="h-4" />
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Hash className="size-3" />
                      App ID:
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => {
                        void navigator.clipboard.writeText(selectedApp.id);
                        setAppIdCopied(true);
                        toast.success('App ID copied');
                        setTimeout(() => setAppIdCopied(false), 2000);
                      }}
                      title={selectedApp.id}
                    >
                      {`${selectedApp.id.slice(0, 16)}...`}
                      {appIdCopied ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <Link
                href="/dashboard"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Connect an app on the dashboard
              </Link>
            )}
          </div>
        </div>
      </section>

      {apps.length === 0 ? null : !appId || credentials === null ? (
        <div className="flex flex-1 items-center justify-center py-24">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <section className={configured ? '' : 'flex flex-1'}>
            <div
              className={
                configured
                  ? 'mx-auto max-w-screen-xl bg-muted/30'
                  : 'mx-auto flex w-full max-w-screen-xl flex-1 flex-col bg-muted/30'
              }
            >
              <SectionHeader
                icon={Bell}
                title="Notifications"
                subtitle={configured ? 'Sent to your users' : 'Not set up'}
              >
                {configured ? (
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      title="Push keys"
                      onClick={() => setKeysOpen(true)}
                    >
                      <KeyRound className="size-3.5" />
                      <span className="sr-only">Push keys</span>
                    </Button>
                    <Button size="sm" onClick={() => setSendOpen(true)}>
                      <Send className="size-3.5" />
                      Send
                    </Button>
                  </div>
                ) : null}
              </SectionHeader>

              {configured ? (
                <PushCampaigns appId={appId} refreshKey={sentCount} />
              ) : (
                <EmptyState
                  icon={Bell}
                  title={`Set up push for ${selectedApp?.slug ?? 'this app'}`}
                  description="Add your Apple and Google keys, then add @otakit/push to your app."
                  action={
                    <Button size="sm" onClick={() => setKeysOpen(true)}>
                      <KeyRound className="size-3.5" />
                      {canManage ? 'Add keys' : 'View keys'}
                    </Button>
                  }
                />
              )}
            </div>
          </section>

          {configured ? (
            <>
              <Separator />
              <section className="flex flex-1">
                <div className="mx-auto flex w-full max-w-screen-xl flex-1 flex-col bg-muted/30">
                  <PushDevices appId={appId} />
                </div>
              </section>
            </>
          ) : null}

          <PushKeysDialog
            appId={appId}
            appName={selectedApp?.slug ?? 'this app'}
            credentials={credentials}
            canManage={canManage}
            open={keysOpen}
            onOpenChange={setKeysOpen}
            onChanged={() => loadCredentials(appId)}
          />
          <PushSendDialog
            appId={appId}
            appName={selectedApp?.slug ?? 'this app'}
            open={sendOpen}
            onOpenChange={setSendOpen}
            onSent={() => setSentCount((value) => value + 1)}
          />
        </>
      )}
    </>
  );
}
