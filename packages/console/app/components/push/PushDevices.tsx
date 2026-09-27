'use client';

import { useCallback, useEffect, useState } from 'react';

import { LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

function Meter({ label, value, limit }: { label: string; value: number; limit: number }) {
  const unlimited = limit >= Number.MAX_SAFE_INTEGER;
  const percent = unlimited ? 0 : Math.min(100, Math.round((value / limit) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span>
          {value.toLocaleString()}
          {unlimited ? '' : ` / ${limit.toLocaleString()}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-foreground/70" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

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

  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { overview, usage, devices } = data;
  return (
    <div className="space-y-5 px-5 py-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <p>
            <strong>{overview.total.toLocaleString()}</strong> devices · {overview.ios} iOS ·{' '}
            {overview.android} Android
          </p>
          {overview.iosSandbox > 0 && (
            <p className="text-xs text-muted-foreground">
              {overview.iosSandbox} iOS development builds (sandbox)
            </p>
          )}
          {overview.topics.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Topics: {overview.topics.map((t) => `${t.topic} (${t.count})`).join(', ')}
            </p>
          )}
        </div>
        <div className="space-y-3">
          <Meter label="Notifications this month" value={usage.sends} limit={usage.sendsLimit} />
          <Meter label="Registered devices" value={usage.devices} limit={usage.devicesLimit} />
        </div>
      </div>

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by user ID or token prefix"
      />

      {devices.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {search ? 'No matching devices.' : 'No devices yet. Install @otakit/push in your app.'}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="w-14 shrink-0 font-medium">
                {device.platform === 'ios' ? 'iOS' : 'Android'}
              </span>
              <span className="w-28 shrink-0 font-mono text-muted-foreground">
                {device.tokenPreview}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {[
                  device.externalUserId && `user ${device.externalUserId}`,
                  device.channel && `channel ${device.channel}`,
                  device.topics.length > 0 && device.topics.join(', '),
                  device.environment === 'sandbox' && 'sandbox',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span className="hidden text-muted-foreground sm:inline">
                {new Date(device.lastSeenAt).toLocaleDateString()}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Remove device"
                onClick={() => void remove(device.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
