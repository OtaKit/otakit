'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';

import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { TABLE_CLASS } from './SectionHeader';

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
    return <p className="px-6 py-10 text-sm text-muted-foreground">Nothing sent yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table className={TABLE_CLASS}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">Sent</TableHead>
            <TableHead>Notification</TableHead>
            <TableHead className="w-28 text-right">Delivered</TableHead>
            <TableHead className="w-28">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((campaign) => (
            <Fragment key={campaign.id}>
              <TableRow
                className="cursor-pointer"
                onClick={() => setOpen(open === campaign.id ? null : campaign.id)}
              >
                <TableCell className="text-muted-foreground">
                  {formatDate(campaign.createdAt)}
                </TableCell>
                <TableCell className="max-w-0 truncate">
                  <span className="font-medium">{campaign.payload.title}</span>
                  <span className="text-muted-foreground"> · {campaign.payload.body}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {campaign.accepted.toLocaleString()} / {campaign.targeted.toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLE[campaign.status]}>{campaign.status}</Badge>
                </TableCell>
              </TableRow>
              {open === campaign.id ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="whitespace-normal">
                    <CampaignDetails
                      campaign={campaign}
                      onCancel={() => void cancel(campaign.id)}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CampaignDetails({ campaign, onCancel }: { campaign: Campaign; onCancel: () => void }) {
  const active = campaign.status === 'queued' || campaign.status === 'sending';
  return (
    <div className="space-y-1.5 py-2 text-xs text-muted-foreground">
      <p className="text-foreground">{campaign.payload.body}</p>
      <p>
        Targeted {campaign.targeted} · accepted by Apple/Google {campaign.accepted} · failed{' '}
        {campaign.failed} · invalid tokens removed {campaign.invalidRemoved}
        {campaign.payload.url ? ` · opens ${campaign.payload.url}` : ''}
      </p>
      {campaign.failureReason ? <p className="text-destructive">{campaign.failureReason}</p> : null}
      {campaign.errorSummary && Object.keys(campaign.errorSummary).length > 0 ? (
        <p className="font-mono">
          {Object.entries(campaign.errorSummary)
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(' · ')}
        </p>
      ) : null}
      <p>Sent by {campaign.createdBy}</p>
      {active ? (
        <Button size="sm" variant="outline" className="mt-1" onClick={onCancel}>
          Cancel remaining
        </Button>
      ) : null}
    </div>
  );
}
