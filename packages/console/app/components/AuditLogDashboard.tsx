'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { ArrowLeft, LoaderCircle, Lock, ScrollText } from 'lucide-react';
import { toast } from 'sonner';

import { DashboardHeader } from '@/app/components/DashboardHeader';
import type { ApiError, DashboardInitialData } from '@/app/components/dashboard-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

type AuditLogEntry = {
  id: string;
  actorType: 'user' | 'key' | 'system';
  actorLabel: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type AuditLogPayload = {
  entries: AuditLogEntry[];
  nextCursor: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  'organization.created': 'Workspace created',
  'organization.renamed': 'Workspace renamed',
  'app.created': 'App created',
  'bundle.uploaded': 'Bundle uploaded',
  'bundle.deleted': 'Bundle deleted',
  'release.created': 'Release created',
  'release.reverted': 'Release rolled back',
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
  'member.added': 'Member added',
  'member.removed': 'Member removed',
  'member.joined': 'Member joined',
  'invite.created': 'Invite sent',
  'invite.revoked': 'Invite revoked',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDetails(metadata: Record<string, unknown> | null): string {
  if (!metadata) return '';
  return Object.entries(metadata)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}

async function parseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function AuditLogDashboard({ initialData }: { initialData: DashboardInitialData }) {
  const canViewAuditLog =
    initialData.activeOrganization.role === 'owner' ||
    initialData.activeOrganization.role === 'admin';

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(canViewAuditLog);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchEntries = useCallback(async (cursor: string | null) => {
    const params = new URLSearchParams({ limit: '50' });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`/api/v1/organization/audit-log?${params.toString()}`);
    if (!response.ok) {
      const data = await parseJson<ApiError>(response).catch(() => null);
      throw new Error(data?.error ?? 'Failed to load audit log');
    }
    return parseJson<AuditLogPayload>(response);
  }, []);

  useEffect(() => {
    if (!canViewAuditLog) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchEntries(null);
        if (cancelled) return;
        setEntries(payload.entries);
        setNextCursor(payload.nextCursor);
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : 'Failed to load audit log');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canViewAuditLog, fetchEntries]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const payload = await fetchEntries(nextCursor);
      setEntries((current) => [...current, ...payload.entries]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load audit log');
    } finally {
      setLoadingMore(false);
    }
  }

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
                  <ScrollText className="size-6 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col gap-0.5">
                    <h2 className="text-[15px] font-semibold leading-tight">Audit log</h2>
                    <p className="text-xs leading-tight text-muted-foreground">
                      Activity in {initialData.activeOrganization.name}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-8" asChild>
                  <Link href="/dashboard/settings">
                    <ArrowLeft className="size-3.5" />
                    Settings
                  </Link>
                </Button>
              </div>

              {!canViewAuditLog ? (
                <div className="m-5 rounded-lg border border-dashed py-12 text-center">
                  <Lock className="mx-auto size-6 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">Admins only</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    Only workspace owners and admins can view the audit log.
                  </p>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-24">
                  <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : entries.length === 0 ? (
                <div className="m-5 rounded-lg border border-dashed py-12 text-center">
                  <ScrollText className="mx-auto size-6 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">No activity yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    Releases, uploads, API keys, and member changes will show up here.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden">
                  <Table>
                    <TableBody>
                      {entries.map((entry) => (
                        <TableRow key={entry.id} className="h-12">
                          <TableCell className="w-32 pl-5 text-xs text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </TableCell>
                          <TableCell className="w-44">
                            <div className="truncate text-sm">{entry.actorLabel}</div>
                          </TableCell>
                          <TableCell className="w-40">
                            <Badge variant="secondary" className="text-xs font-normal">
                              {ACTION_LABELS[entry.action] ?? entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                            <div
                              className="max-w-md truncate"
                              title={formatDetails(entry.metadata)}
                            >
                              {formatDetails(entry.metadata)}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {nextCursor ? (
                    <div className="flex justify-center border-t border-border py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void loadMore()}
                        disabled={loadingMore}
                      >
                        {loadingMore ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          'Load more'
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
