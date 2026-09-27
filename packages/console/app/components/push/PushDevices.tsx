'use client';

import { useCallback, useEffect, useState } from 'react';

import { LoaderCircle, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { SectionHeader, TABLE_CLASS } from './SectionHeader';

type Device = {
  id: string;
  platform: 'ios' | 'android';
  environment: 'production' | 'sandbox';
  tokenPreview: string;
  externalUserId: string | null;
  topics: string[];
  channel: string | null;
  bundleVersion: string | null;
  lastSeenAt: string;
};

type Payload = {
  overview: {
    total: number;
    ios: number;
    android: number;
    iosSandbox: number;
    channels: Array<{ channel: string | null; count: number }>;
    topics: Array<{ topic: string; count: number }>;
  };
  devices: Device[];
  usage: { sends: number; sendsLimit: number; devices: number; devicesLimit: number };
};

export function PushDevices({ appId }: { appId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(
    async (query: string) => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (query.trim()) params.set('search', query.trim());
        const response = await fetch(`/api/v1/apps/${appId}/push/devices?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to load devices');
        setData((await response.json()) as Payload);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load devices');
      }
    },
    [appId],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(search), 300);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function remove(id: string) {
    const response = await fetch(`/api/v1/apps/${appId}/push/devices/${id}`, { method: 'DELETE' });
    if (!response.ok) toast.error('Could not remove device');
    void load(search);
  }

  const header = (
    <SectionHeader
      icon={Smartphone}
      title="Devices"
      subtitle={
        data
          ? `${data.overview.total.toLocaleString()} registered (${data.overview.ios} iOS, ${data.overview.android} Android) · ${usageText(data.usage)}`
          : 'Loading…'
      }
    >
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search user ID or token"
        className="h-8 w-56 text-xs"
      />
    </SectionHeader>
  );

  if (!data) {
    return (
      <>
        {header}
        <div className="flex justify-center py-16">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  const { devices } = data;
  return (
    <>
      {header}
      {devices.length === 0 ? (
        <p className="px-6 py-10 text-sm text-muted-foreground">
          {search ? 'No matching devices.' : 'No devices yet. Add @otakit/push to your app.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className={TABLE_CLASS}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Platform</TableHead>
                <TableHead className="w-32">Token</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Topics</TableHead>
                <TableHead className="w-28">Last seen</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>
                    {device.platform === 'ios' ? 'iOS' : 'Android'}
                    {device.environment === 'sandbox' ? (
                      <span className="text-muted-foreground"> · dev</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {device.tokenPreview}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {device.externalUserId ?? '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{device.channel ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {device.topics.length > 0 ? device.topics.join(', ') : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(device.lastSeenAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground/60 hover:text-foreground"
                      aria-label="Remove device"
                      onClick={() => void remove(device.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

function usageText(usage: Payload['usage']): string {
  const unlimited = usage.sendsLimit >= Number.MAX_SAFE_INTEGER;
  return unlimited
    ? `${usage.sends.toLocaleString()} notifications this month`
    : `${usage.sends.toLocaleString()} of ${usage.sendsLimit.toLocaleString()} notifications this month`;
}
