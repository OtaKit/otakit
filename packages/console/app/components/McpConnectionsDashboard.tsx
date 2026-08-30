'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bot, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type { DashboardInitialData } from '@/app/components/dashboard-types';
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
import { Separator } from '@/components/ui/separator';

type Connection = {
  id: string;
  clientName: string;
  organization: { id: string; name: string } | null;
  scopes: string[];
  createdAt: string;
};

const SCOPE_LABELS: Record<string, string> = {
  'otakit:read': 'Read data',
  'otakit:app:write': 'Create apps',
  'otakit:bundle:write': 'Delete bundles',
  'otakit:release:write': 'Publish & revert',
  offline_access: 'Stay connected',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function McpConnectionsDashboard({ initialData }: { initialData: DashboardInitialData }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(initialData.remoteMcpOAuthEnabled);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Connection | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/me/oauth-connections');
    const body = (await response.json().catch(() => null)) as {
      connections?: Connection[];
      error?: string;
    } | null;
    if (!response.ok) throw new Error(body?.error ?? 'Could not load MCP connections');
    setConnections(body?.connections ?? []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load MCP connections';
      setLoadFailed(true);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!initialData.remoteMcpOAuthEnabled) return;
    void refresh();
  }, [initialData.remoteMcpOAuthEnabled, refresh]);

  async function revoke(connection: Connection) {
    setRevoking(connection.id);
    try {
      const response = await fetch(`/api/v1/me/oauth-connections/${connection.id}`, {
        method: 'DELETE',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? 'Could not revoke connection');
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      toast.success('MCP connection revoked');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke connection');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="m-3 min-h-screen border border-border bg-background">
      <DashboardHeader activeSection="settings" />
      <main className="relative min-h-[calc(100vh-3.5rem)]">
        <div className="pointer-events-none absolute inset-0 z-10 hidden justify-center sm:flex">
          <div className="h-full w-full max-w-3xl border-x border-border" />
        </div>
        <section className="relative mx-auto max-w-3xl bg-muted/30">
          <div className="flex items-center justify-between border-b bg-background px-5 pb-6 pt-8">
            <div className="flex items-center gap-3">
              <Bot className="size-6 text-muted-foreground" />
              <div>
                <h1 className="text-[15px] font-semibold leading-tight">MCP connections</h1>
                <p className="text-xs leading-tight text-muted-foreground">Coding-agent access</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-8" asChild>
              <Link href="/dashboard/settings">
                <ArrowLeft className="size-3.5" /> Settings
              </Link>
            </Button>
          </div>

          {!initialData.remoteMcpOAuthEnabled ? (
            <div className="m-5 rounded-lg border border-dashed py-12 text-center">
              <Bot className="mx-auto size-6 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">MCP connections are not enabled</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-24">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : loadFailed ? (
            <div className="m-5 rounded-lg border border-dashed py-12 text-center">
              <CircleAlert className="mx-auto size-6 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Could not load MCP connections</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Check your connection and try again.
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          ) : connections.length === 0 ? (
            <div className="m-5 rounded-lg border border-dashed py-12 text-center">
              <Bot className="mx-auto size-6 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">No MCP connections</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Connections appear after you authorize Codex, Claude Code, or another MCP client.
              </p>
            </div>
          ) : (
            <div className="p-5">
              {connections.map((connection, index) => (
                <div key={connection.id}>
                  {index > 0 ? <Separator /> : null}
                  <div className="flex items-start gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{connection.clientName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {connection.organization?.name ?? 'Unknown organization'} · Connected{' '}
                        {formatDate(connection.createdAt)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {connection.scopes.map((scope) => (
                          <Badge
                            key={scope}
                            variant="secondary"
                            className="text-[10px] font-normal"
                          >
                            {SCOPE_LABELS[scope] ?? scope}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={revoking !== null}
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
                </div>
              ))}
            </div>
          )}
        </section>
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
              {revokeTarget?.organization?.name ?? 'this OtaKit organization'}. You can connect it
              again later.
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
