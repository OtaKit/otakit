'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CircleAlert, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ConnectAgentDialog } from '@/app/components/agents/ConnectAgentDialog';
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

const POLL_INTERVAL_MS = 5000;

type Connection = {
  id: string;
  clientName: string;
  clientUri: string | null;
  organization: { id: string; name: string } | null;
  scopes: string[];
  createdAt: string;
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

/**
 * Connecting an agent is a one-time task, so it lives in a dialog. What stays
 * here is the part worth managing over time: which remote clients currently
 * hold access, and the ability to take it away.
 */
export function AgentsSection({ remoteMcpOAuthEnabled }: { remoteMcpOAuthEnabled: boolean }) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(remoteMcpOAuthEnabled);
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

  // A connection authorized in another window shows up on its own. Paused when
  // the tab is hidden; nothing runs after unmount.
  useEffect(() => {
    if (!remoteMcpOAuthEnabled) return;
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
  }, [remoteMcpOAuthEnabled, load]);

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

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-background px-5 pb-6 pt-8">
        <div className="flex items-center gap-3">
          <Bot className="size-6 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold leading-tight">Agents</h2>
            <p className="text-xs leading-tight text-muted-foreground">
              Claude Code, Codex, VS Code, or CI
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setConnectOpen(true)}>
          Connect an agent
        </Button>
      </div>

      <div className="p-5">
        <h3 className="text-sm font-medium">Remote connections</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Agents that signed in through the browser to reach OtaKit over HTTPS.
        </p>

        {!remoteMcpOAuthEnabled ? (
          <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            Remote MCP is not enabled on this deployment. Connecting a local agent works regardless.
          </p>
        ) : loading ? (
          <div className="flex justify-center py-10">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : loadFailed ? (
          <div className="mt-4 rounded-lg border border-dashed border-border py-8 text-center">
            <CircleAlert className="mx-auto size-5 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">Could not load connections</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
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
          <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
            No remote connections yet.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {connections.map((connection) => (
              <div key={connection.id} className="flex items-start gap-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{connection.clientName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {/* Client names are self-declared at registration; the URI is
                        what actually distinguishes one client from a lookalike. */}
                    {connection.clientUri ? `${connection.clientUri} · ` : ''}
                    Connected {formatDate(connection.createdAt)}
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
                  className="shrink-0 text-muted-foreground hover:text-destructive"
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

      <ConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} />

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
    </>
  );
}
