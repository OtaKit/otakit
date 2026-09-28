'use client';

import { useCallback, useEffect, useState } from 'react';

import { Ban, LoaderCircle, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { formatDateOnly, formatTimeOnly, StatusPill, TABLE_CLASS } from './SectionHeader';

type Campaign = {
  id: string;
  status: 'queued' | 'sending' | 'completed' | 'failed' | 'canceled';
  payload: { title: string; body: string; url?: string };
  audience: {
    platforms?: string[];
    topics?: string[];
    channels?: string[];
    userIds?: string[];
    deviceIds?: string[];
  };
  targeted: number;
  accepted: number;
  failed: number;
  invalidRemoved: number;
  errorSummary: Record<string, number> | null;
  failureReason: string | null;
  createdBy: string;
  createdAt: string;
};

const STATUS: Record<
  Campaign['status'],
  { tone: 'green' | 'blue' | 'red' | 'muted'; label: string }
> = {
  queued: { tone: 'blue', label: 'queued' },
  sending: { tone: 'blue', label: 'sending' },
  completed: { tone: 'green', label: 'sent' },
  failed: { tone: 'red', label: 'failed' },
  canceled: { tone: 'muted', label: 'canceled' },
};

function describeAudience(audience: Campaign['audience']): string {
  const parts: string[] = [];
  if (audience.platforms?.length === 1) {
    parts.push(audience.platforms[0] === 'ios' ? 'iOS' : 'Android');
  }
  if (audience.topics?.length) parts.push(`Topic: ${audience.topics.join(', ')}`);
  if (audience.channels?.length) parts.push(`Channel: ${audience.channels.join(', ')}`);
  if (audience.userIds?.length) {
    parts.push(
      audience.userIds.length === 1
        ? `User: ${audience.userIds[0]}`
        : `${audience.userIds.length} users`,
    );
  }
  if (audience.deviceIds?.length) parts.push(`${audience.deviceIds.length} devices`);
  return parts.length > 0 ? parts.join(' · ') : 'All devices';
}

function deliveryTitle(campaign: Campaign): string {
  return [
    `Accepted by Apple/Google: ${campaign.accepted}`,
    `Failed: ${campaign.failed}`,
    `Invalid tokens removed: ${campaign.invalidRemoved}`,
    ...Object.entries(campaign.errorSummary ?? {}).map(([reason, count]) => `${reason}: ${count}`),
  ].join('\n');
}

export function PushCampaigns({ appId, refreshKey }: { appId: string; refreshKey: number }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/campaigns?limit=50`);
      if (!response.ok) throw new Error('Failed to load notifications');
      const data = (await response.json()) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load notifications');
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
    if (response.ok) toast.success('Canceled');
    else toast.error('Could not cancel');
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
      <div className="p-5">
        <div className="rounded-lg border border-dashed py-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing sent yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <Table className={TABLE_CLASS} style={{ minWidth: '760px' }}>
        <colgroup>
          <col style={{ width: '110px' }} />
          <col />
          <col style={{ width: '200px' }} />
          <col style={{ width: '100px' }} />
          <col style={{ width: '110px' }} />
          <col style={{ width: '56px' }} />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Sent</TableHead>
            <TableHead>Notification</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((campaign) => {
            const status = STATUS[campaign.status];
            const inFlight = campaign.status === 'queued' || campaign.status === 'sending';
            return (
              <TableRow key={campaign.id}>
                <TableCell className="text-xs text-muted-foreground">
                  <div className="leading-tight">{formatDateOnly(campaign.createdAt)}</div>
                  <div className="leading-tight">{formatTimeOnly(campaign.createdAt)}</div>
                </TableCell>
                <TableCell>
                  <div className="truncate font-medium" title={campaign.payload.title}>
                    {campaign.payload.title}
                  </div>
                  {campaign.failureReason ? (
                    <div className="truncate text-destructive" title={campaign.failureReason}>
                      {campaign.failureReason}
                    </div>
                  ) : (
                    <div className="truncate text-muted-foreground" title={campaign.payload.body}>
                      {campaign.payload.body}
                    </div>
                  )}
                </TableCell>
                <TableCell className="truncate text-muted-foreground">
                  {describeAudience(campaign.audience ?? {})}
                </TableCell>
                <TableCell className="text-right tabular-nums" title={deliveryTitle(campaign)}>
                  {campaign.accepted.toLocaleString()} / {campaign.targeted.toLocaleString()}
                </TableCell>
                <TableCell>
                  <StatusPill tone={status.tone} pulse={inFlight}>
                    {status.label}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-right">
                  {inFlight ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="size-7 p-0">
                          <MoreHorizontal className="size-3.5" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => void cancel(campaign.id)}
                        >
                          <Ban className="size-3.5" />
                          Cancel remaining
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
  );
}
