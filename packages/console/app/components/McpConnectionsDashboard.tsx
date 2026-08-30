'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Bot, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type { DashboardInitialData } from '@/app/components/dashboard-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

type Connection = {
  id: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  organization: { id: string; name: string } | null;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export function McpConnectionsDashboard({ initialData }: { initialData: DashboardInitialData }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(initialData.remoteMcpOAuthEnabled);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/v1/me/oauth-connections');
    const body = (await response.json().catch(() => null)) as {
      connections?: Connection[];
      error?: string;
    } | null;
    if (!response.ok) throw new Error(body?.error ?? 'Could not load agent connections');
    setConnections(body?.connections ?? []);
  }, []);

  useEffect(() => {
    if (!initialData.remoteMcpOAuthEnabled) return;
    void load()
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : 'Could not load connections'),
      )
      .finally(() => setLoading(false));
  }, [initialData.remoteMcpOAuthEnabled, load]);

  async function revoke(connection: Connection) {
    if (!confirm(`Revoke ${connection.clientName}? Its OtaKit MCP access will stop immediately.`)) {
      return;
    }
    setRevoking(connection.id);
    try {
      const response = await fetch(`/api/v1/me/oauth-connections/${connection.id}`, {
        method: 'DELETE',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? 'Could not revoke connection');
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      toast.success('Agent connection revoked');
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
                <h1 className="text-[15px] font-semibold">Agent connections</h1>
                <p className="text-xs text-muted-foreground">OAuth access granted to MCP clients</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/settings">
                <ArrowLeft className="size-3.5" /> Settings
              </Link>
            </Button>
          </div>

          {!initialData.remoteMcpOAuthEnabled ? (
            <div className="m-5 rounded-lg border border-dashed py-12 text-center">
              <Bot className="mx-auto size-6 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">Remote MCP OAuth is not enabled</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-24">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : connections.length === 0 ? (
            <div className="m-5 rounded-lg border border-dashed py-12 text-center">
              <Bot className="mx-auto size-6 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">No connected agents</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Connections appear here after you authorize an MCP client.
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
                        {connection.organization?.name ?? 'No organization'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {connection.scopes
                          .filter((scope) => scope.startsWith('otakit:'))
                          .map((scope) => (
                            <Badge
                              key={scope}
                              variant="secondary"
                              className="text-[10px] font-normal"
                            >
                              {scope}
                            </Badge>
                          ))}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={revoking === connection.id}
                      onClick={() => revoke(connection)}
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
    </div>
  );
}
