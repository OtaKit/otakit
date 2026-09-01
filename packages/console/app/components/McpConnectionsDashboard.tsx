'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import { CopyButton } from '@/app/components/CopyButton';
import type { DashboardInitialData } from '@/app/components/dashboard-types';
import { scopeLabel } from '@/lib/mcp/scope-labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Connection = {
  id: string;
  clientName: string;
  clientUri: string | null;
  organization: { id: string; name: string } | null;
  scopes: string[];
  createdAt: string;
};

const HOSTED_ORIGIN = 'https://console.otakit.app';
const POLL_INTERVAL_MS = 5000;

type ClientId = 'claude' | 'codex' | 'vscode' | 'ci';
type Step = { label: string; command: string };

const CLIENT_TABS: { id: ClientId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'vscode', label: 'VS Code' },
  { id: 'ci', label: 'CI' },
];

/**
 * Local stdio is what these commands set up on purpose: it is the only mode
 * that can inspect the project, check native compatibility, and upload a
 * bundle. Remote MCP covers account and release operations without local files.
 */
function stepsFor(client: ClientId, origin: string): Step[] {
  const selfHosted = origin !== HOSTED_ORIGIN;
  const serverFlag = selfHosted ? ` --server ${origin}` : '';
  const login = {
    label: 'Sign in once',
    command: `npx -y @otakit/cli@latest login${serverFlag}`,
  };

  switch (client) {
    case 'claude':
      return [
        login,
        {
          label: 'Add the server to this project',
          command: `claude mcp add --transport stdio --scope project otakit -- \\\n  npx -y @otakit/cli@latest mcp --project-root '\${CLAUDE_PROJECT_DIR:-.}'`,
        },
      ];
    case 'codex':
      return [
        login,
        {
          label: 'Add the server to this project',
          command: `codex mcp add otakit -- \\\n  npx -y @otakit/cli@latest mcp --project-root .`,
        },
      ];
    case 'vscode':
      return [
        login,
        {
          label: 'Create .vscode/mcp.json',
          command: `{
  "servers": {
    "otakit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@otakit/cli@latest", "mcp", "--project-root", "\${workspaceFolder}"]
    }
  }
}`,
        },
      ];
    case 'ci':
      return [
        {
          label: 'Create an organization key in API keys, then export it',
          command: `export OTAKIT_TOKEN=otakit_sk_...\nexport OTAKIT_APP_ID=<your app id>`,
        },
        {
          label: 'Run the server without an interactive login',
          command: `npx -y @otakit/cli@latest mcp --project-root .`,
        },
      ];
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function CommandBlock({ step }: { step: Step }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{step.label}</p>
        <CopyButton value={step.command} label={step.label} />
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed">
        <code>{step.command}</code>
      </pre>
    </div>
  );
}

export function McpConnectionsDashboard({ initialData }: { initialData: DashboardInitialData }) {
  const [client, setClient] = useState<ClientId>('claude');
  // Read from the build-time public URL, which is identical on the server and
  // the client. window.location would either differ across hydration or, from
  // an effect, paint hosted commands for a frame that a self-hosted user could
  // copy in between.
  const origin = (process.env.NEXT_PUBLIC_APP_URL?.trim() || HOSTED_ORIGIN).replace(/\/+$/, '');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(initialData.remoteMcpOAuthEnabled);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Connection | null>(null);
  const seenIds = useRef<Set<string> | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/v1/me/oauth-connections', { signal });
    const body = (await response.json().catch(() => null)) as {
      connections?: Connection[];
      error?: string;
    } | null;
    if (!response.ok) throw new Error(body?.error ?? 'Could not load MCP connections');
    return body?.connections ?? [];
  }, []);

  // While this page is open, a connection that lands in another window shows up
  // on its own. Paused when the tab is hidden; nothing runs after unmount.
  useEffect(() => {
    if (!initialData.remoteMcpOAuthEnabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async (initial: boolean) => {
      if (stopped) return;
      if (document.visibilityState === 'visible' || initial) {
        try {
          const next = await load(controller.signal);
          if (stopped) return;
          if (seenIds.current) {
            const arrived = next.find((item) => !seenIds.current?.has(item.id));
            if (arrived) toast.success(`${arrived.clientName} connected`);
          }
          seenIds.current = new Set(next.map((item) => item.id));
          setConnections(next);
          setLoadFailed(false);
        } catch (error) {
          if (controller.signal.aborted || stopped) return;
          if (initial) {
            setLoadFailed(true);
            toast.error(error instanceof Error ? error.message : 'Could not load MCP connections');
          }
        } finally {
          if (!stopped && initial) setLoading(false);
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(false), POLL_INTERVAL_MS);
    };

    void tick(true);
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [initialData.remoteMcpOAuthEnabled, load]);

  async function revoke(connection: Connection) {
    setRevoking(connection.id);
    try {
      const response = await fetch(`/api/v1/me/oauth-connections/${connection.id}`, {
        method: 'DELETE',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? 'Could not revoke connection');
      seenIds.current?.delete(connection.id);
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      toast.success('MCP connection revoked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke connection');
    } finally {
      setRevoking(null);
    }
  }

  const steps = stepsFor(client, origin);

  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <DashboardHeader activeSection="settings" />
      <main className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
        <div className="pointer-events-none absolute inset-0 z-10 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-3xl border-x border-border" />
        </div>
        <div className="relative flex min-h-[calc(100vh-3.5rem)] flex-col">
          <section>
            <div className="mx-auto max-w-3xl bg-muted/30">
              <div className="flex items-center justify-between border-b border-border bg-background px-5 pb-6 pt-8">
                <div className="flex items-center gap-3">
                  <Bot className="size-6 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col gap-0.5">
                    <h1 className="text-[15px] font-semibold leading-tight">Agents</h1>
                    <p className="text-xs leading-tight text-muted-foreground">
                      Connect a coding agent to {initialData.activeOrganization.name}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-8" asChild>
                  <Link href="/dashboard/settings">
                    <ArrowLeft className="size-3.5" /> Settings
                  </Link>
                </Button>
              </div>

              {/* Connect */}
              <div className="border-b border-border p-5">
                <div className="mb-4 flex flex-wrap gap-1">
                  {CLIENT_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setClient(tab.id)}
                      className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        client === tab.id
                          ? 'bg-accent font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-4">
                  {steps.map((step) => (
                    <CommandBlock key={step.label} step={step} />
                  ))}
                </div>

                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  {client === 'ci' ? (
                    <>
                      Create the key under{' '}
                      <Link
                        href="/dashboard/settings"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        API keys
                      </Link>
                      . Keep it in your CI secret store, never in project files.
                    </>
                  ) : (
                    <>
                      This runs OtaKit in your repository, so the agent can inspect the project,
                      check native compatibility, and upload bundles. It signs in with your CLI
                      login, so it does not appear in the list below.{' '}
                      <a
                        href="https://otakit.app/docs/agents"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Setup guide
                      </a>
                    </>
                  )}
                </p>
              </div>

              {/* Authorized remote connections */}
              <div className="p-5">
                <h2 className="text-sm font-medium">Authorized remote connections</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Agents that signed in through the browser to reach OtaKit over HTTPS.
                </p>

                {!initialData.remoteMcpOAuthEnabled ? (
                  <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    Remote MCP is not enabled on this deployment. The setup above works regardless.
                  </p>
                ) : loading ? (
                  <div className="flex justify-center py-12">
                    <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : loadFailed ? (
                  <div className="mt-4 rounded-lg border border-dashed border-border py-10 text-center">
                    <CircleAlert className="mx-auto size-6 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">Could not load connections</p>
                    <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                      Check your connection and try again.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => {
                        setLoading(true);
                        setLoadFailed(false);
                        void load()
                          .then((next) => {
                            seenIds.current = new Set(next.map((item) => item.id));
                            setConnections(next);
                          })
                          .catch(() => setLoadFailed(true))
                          .finally(() => setLoading(false));
                      }}
                    >
                      Try again
                    </Button>
                  </div>
                ) : connections.length === 0 ? (
                  <div className="mt-4 flex items-center justify-center gap-2.5 rounded-lg border border-dashed border-border py-10 text-sm text-muted-foreground">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-muted-foreground/40" />
                      <span className="relative inline-flex size-2 rounded-full bg-muted-foreground/60" />
                    </span>
                    Waiting for your first connection…
                  </div>
                ) : (
                  <div className="mt-3 divide-y divide-border">
                    {connections.map((connection) => (
                      <div key={connection.id} className="flex items-start gap-4 py-4">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{connection.clientName}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {/* Client names are self-declared at registration; the URI is
                                what actually distinguishes one client from a lookalike. */}
                            {connection.clientUri ? `${connection.clientUri} · ` : ''}
                            {connection.organization?.name ?? 'Unknown organization'} · Connected{' '}
                            {formatDate(connection.createdAt)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {connection.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="secondary"
                                className="text-[10px] font-normal"
                                title={scopeLabel(scope).description}
                              >
                                {scopeLabel(scope).title}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={revoking === connection.id}
                          onClick={() => setRevokeTarget(connection)}
                        >
                          {revoking === connection.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Keeps the column rules and tint running to the bottom of the page. */}
          <section className="flex-1">
            <div className="mx-auto h-full max-w-3xl bg-muted/30" />
          </section>
        </div>
      </main>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke access for {revokeTarget?.clientName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This disconnects the client from{' '}
              {revokeTarget?.organization?.name ?? 'this OtaKit organization'} and invalidates its
              tokens immediately. You can connect it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (revokeTarget) void revoke(revokeTarget);
              }}
            >
              Revoke access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
