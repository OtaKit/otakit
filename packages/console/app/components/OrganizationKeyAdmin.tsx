'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, KeyRound, MoreHorizontal, Plus, RefreshCcw, ShieldOff } from 'lucide-react';

import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

type OrganizationApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Props = {
  initialKeys: OrganizationApiKey[];
};

type CreateKeyResponse = {
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
    createdAt: string;
  };
  secretKey: string;
};

type RevokeKeyResponse = {
  id: string;
  revokedAt: string | null;
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function OrganizationKeyAdmin({ initialKeys }: Props) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [keys, setKeys] = useState<OrganizationApiKey[]>(initialKeys);
  const [latestSecret, setLatestSecret] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeKeyCount = useMemo(() => keys.filter((key) => key.revokedAt === null).length, [keys]);

  useEffect(() => {
    setKeys(initialKeys);
    setLatestSecret(null);
    setKeyName('');
    setCopied(false);
  }, [initialKeys]);

  async function createKey() {
    setBusyAction('create-key');
    try {
      const response = await fetch('/api/v1/organization/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName.trim() || 'default' }),
      });
      const payload = (await response.json()) as CreateKeyResponse | { error?: string };
      if (!response.ok) {
        throw new Error(payload && 'error' in payload ? payload.error : 'Create key failed');
      }
      if (!('apiKey' in payload) || !('secretKey' in payload)) {
        throw new Error('Invalid create key response');
      }
      setKeys((prev) => [{ ...payload.apiKey, lastUsedAt: null, revokedAt: null }, ...prev]);
      setLatestSecret(payload.secretKey);
      setCopied(false);
      toast.success('API key created');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Create key failed');
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeKey(keyId: string) {
    setBusyAction(`revoke:${keyId}`);
    try {
      const response = await fetch(`/api/v1/organization/keys/${keyId}/revoke`, {
        method: 'POST',
      });
      const payload = (await response.json()) as RevokeKeyResponse | { error?: string };
      if (!response.ok) {
        throw new Error(payload && 'error' in payload ? payload.error : 'Revoke failed');
      }
      if (!('id' in payload) || !('revokedAt' in payload)) {
        throw new Error('Invalid revoke response');
      }
      setKeys((prev) =>
        prev.map((key) => (key.id === keyId ? { ...key, revokedAt: payload.revokedAt } : key)),
      );
      toast.success('Key revoked');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Revoke failed');
    } finally {
      setBusyAction(null);
    }
  }

  function copySecret() {
    if (!latestSecret) return;
    void navigator.clipboard.writeText(latestSecret);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCreateDialogOpenChange(open: boolean) {
    setCreateDialogOpen(open);
    if (open) {
      setKeyName('');
      setLatestSecret(null);
      setCopied(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <KeyRound className="size-4 text-muted-foreground" />
          API Keys
        </h2>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-16 justify-center"
          onClick={() => handleCreateDialogOpenChange(true)}
        >
          <Plus className="size-3.5" />
          New
        </Button>
      </div>

      {/* Key list */}
      {keys.length === 0 ? (
        <div className="p-5">
          <div className="rounded-lg border border-dashed py-8 text-center">
            <p className="text-sm text-muted-foreground">No API keys yet</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden">
          <Table>
            <TableBody>
              {keys.map((key) => {
                const isRevoked = key.revokedAt !== null;
                const busy = busyAction === `revoke:${key.id}`;
                return (
                  <TableRow key={key.id} className={`h-12 ${isRevoked ? 'opacity-50' : ''}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 pl-5">
                        <span className="text-sm font-medium">{key.name}</span>
                        <code className="text-xs text-muted-foreground">{key.keyPrefix}...</code>
                        {isRevoked ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] font-normal text-destructive"
                          >
                            revoked
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden w-36 text-right text-xs text-muted-foreground sm:table-cell">
                      {isRevoked
                        ? `Revoked ${formatDate(key.revokedAt)}`
                        : `Used ${formatDate(key.lastUsedAt)}`}
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {!isRevoked ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-7 p-0"
                              disabled={busy}
                            >
                              {busy ? (
                                <RefreshCcw className="size-3.5 animate-spin" />
                              ) : (
                                <MoreHorizontal className="size-3.5" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void revokeKey(key.id)}
                            >
                              <ShieldOff className="size-3.5" />
                              Revoke key
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4" />
              Create API key
            </DialogTitle>
            <DialogDescription>Use this key for CLI automation.</DialogDescription>
          </DialogHeader>

          {latestSecret ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="text-xs text-muted-foreground">
                  Copy this secret now. It is shown only once.
                </p>
                <div className="mt-2 flex items-start gap-2">
                  <code className="min-w-0 flex-1 overflow-hidden break-all text-xs leading-relaxed">
                    {latestSecret}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 shrink-0 p-0"
                    onClick={copySecret}
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder="ci-release"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createKey();
                }}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {latestSecret ? 'Done' : 'Cancel'}
            </Button>
            {!latestSecret ? (
              <Button onClick={() => void createKey()} disabled={busyAction === 'create-key'}>
                {busyAction === 'create-key' ? (
                  <>
                    <RefreshCcw className="size-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="size-3.5" />
                    Create
                  </>
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
