'use client';

import { useCallback, useEffect, useState } from 'react';

import { Hash, LoaderCircle, MoreHorizontal, Search, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { PlatformIcon } from '@/app/components/PlatformIcon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { formatDateOnly, formatTimeOnly, SectionHeader, TABLE_CLASS } from './SectionHeader';

type Device = {
  id: string;
  platform: 'ios' | 'android';
  environment: 'production' | 'sandbox';
  tokenPreview: string;
  externalUserId: string | null;
  topics: string[];
  channel: string | null;
  lastSeenAt: string;
};

export type DevicesPayload = {
  overview: {
    total: number;
    ios: number;
    android: number;
    channels: Array<{ channel: string | null; count: number }>;
    topics: Array<{ topic: string; count: number }>;
  };
  devices: Device[];
  usage: { sends: number; sendsLimit: number; devices: number; devicesLimit: number };
};

function subtitle(data: DevicesPayload | null): string {
  if (!data) return 'Registered for push';
  const { total } = data.overview;
  const { sends, sendsLimit } = data.usage;
  const registered = `${total.toLocaleString('en-US')} registered`;
  const sent =
    sendsLimit >= Number.MAX_SAFE_INTEGER
      ? `${sends.toLocaleString('en-US')} sent this month`
      : `${sends.toLocaleString('en-US')} of ${sendsLimit.toLocaleString('en-US')} sent this month`;
  return `${registered} · ${sent}`;
}

export function PushDevices({ appId }: { appId: string }) {
  const [data, setData] = useState<DevicesPayload | null>(null);
  const [platform, setPlatform] = useState('all');
  const [channel, setChannel] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (platform !== 'all') params.set('platform', platform);
      if (channel !== 'all') params.set('channel', channel);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/v1/apps/${appId}/push/devices?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to load devices');
      setData((await response.json()) as DevicesPayload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load devices');
    }
  }, [appId, platform, channel, search]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  async function remove(id: string) {
    const response = await fetch(`/api/v1/apps/${appId}/push/devices/${id}`, { method: 'DELETE' });
    if (response.ok) toast.success('Device removed');
    else toast.error('Could not remove device');
    void load();
  }

  const channels = (data?.overview.channels ?? [])
    .map((row) => row.channel)
    .filter((value): value is string => Boolean(value));
  const filtered = platform !== 'all' || channel !== 'all' || search.trim().length > 0;

  return (
    <>
      <SectionHeader icon={Smartphone} title="Devices" subtitle={subtitle(data)}>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-1 sm:flex-wrap sm:items-center">
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-1.5">
                  <Smartphone className="size-3.5 text-muted-foreground" />
                  All platforms
                </span>
              </SelectItem>
              <SelectItem value="ios">
                <span className="flex items-center gap-1.5">
                  <PlatformIcon platform="ios" className="size-4" /> iOS
                </span>
              </SelectItem>
              <SelectItem value="android">
                <span className="flex items-center gap-1.5">
                  <PlatformIcon platform="android" className="size-4" /> Android
                </span>
              </SelectItem>
            </SelectContent>
          </Select>

          {channels.length > 0 ? (
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="h-8 w-full text-xs sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="flex items-center gap-1.5">
                    <Hash className="size-3.5 text-muted-foreground" />
                    All channels
                  </span>
                </SelectItem>
                {channels.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="relative col-span-2 sm:col-span-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="User ID or token"
              className="h-8 w-full pl-8 text-xs md:text-xs sm:w-44"
            />
          </div>
        </div>
      </SectionHeader>

      {!data ? (
        <div className="flex justify-center py-16">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : data.devices.length === 0 ? (
        <div className="p-5">
          <div className="rounded-lg border border-dashed py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {filtered ? 'No matching devices' : 'No devices yet'}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-auto">
          <Table className={TABLE_CLASS} style={{ minWidth: '760px' }}>
            <colgroup>
              <col style={{ width: '120px' }} />
              <col style={{ width: '140px' }} />
              <col />
              <col style={{ width: '130px' }} />
              <col style={{ width: '160px' }} />
              <col style={{ width: '110px' }} />
              <col style={{ width: '56px' }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Topics</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.devices.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <PlatformIcon platform={device.platform} className="size-4" />
                      {device.platform === 'ios' ? 'iOS' : 'Android'}
                      {device.environment === 'sandbox' ? (
                        <span className="text-muted-foreground">dev</span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="truncate font-mono text-muted-foreground">
                    {device.tokenPreview}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {device.externalUserId ?? '—'}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {device.channel ?? 'base'}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {device.topics.length > 0 ? device.topics.join(', ') : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="leading-tight">{formatDateOnly(device.lastSeenAt)}</div>
                    <div className="leading-tight">{formatTimeOnly(device.lastSeenAt)}</div>
                  </TableCell>
                  <TableCell className="text-right">
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
                          onClick={() => void remove(device.id)}
                        >
                          <Trash2 className="size-3.5" />
                          Remove device
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
