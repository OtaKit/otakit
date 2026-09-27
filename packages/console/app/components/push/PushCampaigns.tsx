'use client';

import { useCallback, useEffect, useState } from 'react';

import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Campaign = {
  id: string;
  status: 'queued' | 'sending' | 'completed' | 'failed' | 'canceled';
  payload: { title: string; body: string; url?: string };
  targeted: number;
  accepted: number;
  failed: number;
  invalidRemoved: number;
  errorSummary: Record<string, number> | null;
  failureReason: string | null;
  createdBy: string;
  createdAt: string;
};

const STATUS_STYLE: Record<Campaign['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  sending: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  canceled: 'bg-muted text-muted-foreground',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function PushCampaigns({ appId, refreshKey }: { appId: string; refreshKey: number }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/campaigns?limit=50`);
      if (!response.ok) throw new Error('Failed to load campaigns');
      const data = (await response.json()) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load campaigns');
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Refresh while something is still being delivered.
  const active = campaigns?.some(
    (campaign) => campaign.status === 'queued' || campaign.status === 'sending',
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  async function cancel(id: string) {
    const response = await fetch(`/api/v1/apps/${appId}/push/campaigns/${id}/cancel`, {
      method: 'POST',
    });
    if (!response.ok) toast.error('Could not cancel');
    void load();
  }

  if (!campaigns) {
    return (
      <div className="flex justify-center py-16">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (campaigns.length === 0) {
    return (
      <p className="px-5 py-12 text-center text-sm text-muted-foreground">
        No notifications sent yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {campaigns.map((campaign) => (
        <li key={campaign.id} className="px-5 py-3">
          <button
            type="button"
            className="flex w-full items-center gap-3 text-left"
            onClick={() => setOpen(open === campaign.id ? null : campaign.id)}
          >
            <span className="w-28 shrink-0 text-xs text-muted-foreground">
              {formatDate(campaign.createdAt)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {campaign.payload.title}
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {campaign.accepted.toLocaleString()} / {campaign.targeted.toLocaleString()} delivered
            </span>
            <Badge className={STATUS_STYLE[campaign.status]}>{campaign.status}</Badge>
          </button>
          {open === campaign.id && (
            <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
              <p className="text-muted-foreground">{campaign.payload.body}</p>
              <p>
                Targeted {campaign.targeted} · Accepted by Apple/Google {campaign.accepted} · Failed{' '}
                {campaign.failed} · Invalid tokens removed {campaign.invalidRemoved}
              </p>
              {campaign.payload.url && <p>Opens {campaign.payload.url}</p>}
              {campaign.failureReason && (
                <p className="text-destructive">{campaign.failureReason}</p>
              )}
              {campaign.errorSummary && Object.keys(campaign.errorSummary).length > 0 && (
                <p className="font-mono text-muted-foreground">
                  {Object.entries(campaign.errorSummary)
                    .map(([reason, count]) => `${reason}: ${count}`)
                    .join(' · ')}
                </p>
              )}
              <p className="text-muted-foreground">Sent by {campaign.createdBy}</p>
              {(campaign.status === 'queued' || campaign.status === 'sending') && (
                <Button size="sm" variant="outline" onClick={() => void cancel(campaign.id)}>
                  Cancel remaining
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
