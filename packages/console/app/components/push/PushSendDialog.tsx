'use client';

import { useEffect, useMemo, useState } from 'react';

import { Hash, LoaderCircle, Send, Smartphone, Tag } from 'lucide-react';
import { toast } from 'sonner';

import { PlatformIcon } from '@/app/components/PlatformIcon';
import type { ApiError } from '@/app/components/dashboard-types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import type { DevicesPayload } from './PushDevices';
import { deviceCount } from './SectionHeader';

type AudienceCount = { total: number; ios: number; android: number };

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PushSendDialog({
  appId,
  appName,
  open,
  onOpenChange,
  onSent,
}: {
  appId: string;
  appName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remounted on every open, so the form always starts empty. */}
        {open ? (
          <SendForm
            appId={appId}
            appName={appName}
            onClose={() => onOpenChange(false)}
            onSent={onSent}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SendForm({
  appId,
  appName,
  onClose,
  onSent,
}: {
  appId: string;
  appName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [platform, setPlatform] = useState('all');
  const [topic, setTopic] = useState('all');
  const [channel, setChannel] = useState('all');
  const [userIds, setUserIds] = useState('');
  const [options, setOptions] = useState<{ topics: string[]; channels: string[] }>({
    topics: [],
    channels: [],
  });
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Topics and channels that devices of this app actually use.
  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/v1/apps/${appId}/push/devices?limit=1`);
      if (!response.ok) return;
      const data = (await response.json()) as DevicesPayload;
      setOptions({
        topics: data.overview.topics.map((row) => row.topic),
        channels: data.overview.channels
          .map((row) => row.channel)
          .filter((value): value is string => Boolean(value)),
      });
    })();
  }, [appId]);

  const audience = useMemo(() => {
    const value: Record<string, string[]> = {};
    if (platform !== 'all') value.platforms = [platform];
    if (topic !== 'all') value.topics = [topic];
    if (channel !== 'all') value.channels = [channel];
    if (splitList(userIds).length) value.userIds = splitList(userIds);
    return value;
  }, [platform, topic, channel, userIds]);

  // Count who would receive it; the payload is a placeholder so this works before typing.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/apps/${appId}/push/audience`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload: { title: 'count', body: 'count' }, audience }),
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          audienceCount?: AudienceCount;
          warnings?: string[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? 'Could not count devices');
        setCount(data.audienceCount ?? null);
        setWarnings(data.warnings ?? []);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCount(null);
        setWarnings([error instanceof Error ? error.message : 'Could not count devices']);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [appId, audience]);

  const total = count?.total ?? 0;
  const canSend = title.trim() !== '' && body.trim() !== '' && total > 0 && !sending;

  async function send() {
    setSending(true);
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/campaigns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          payload: {
            title: title.trim(),
            body: body.trim(),
            ...(url.trim() ? { url: url.trim() } : {}),
          },
          audience,
          expectedAudience: total,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | (ApiError & { nextStep?: string })
          | null;
        throw new Error(
          [data?.error, data?.nextStep].filter(Boolean).join(' ') || 'Could not send',
        );
      }
      const data = (await response.json()) as { campaign: { targeted: number } };
      toast.success(`Sending to ${deviceCount(data.campaign.targeted)}`);
      onSent();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Send className="size-4" />
          Send notification
        </DialogTitle>
        <DialogDescription>Delivered right away to {appName} devices.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="push-title">Title</Label>
          <Input
            id="push-title"
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Your order is on its way"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="push-body">Message</Label>
          <Textarea
            id="push-body"
            value={body}
            maxLength={1000}
            rows={3}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Track it in the app."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="push-url">
            Link <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="push-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="/orders/latest"
          />
        </div>

        <div className="space-y-2">
          <Label>Audience</Label>
          <div className="grid grid-cols-2 gap-2">
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="h-8 w-full text-xs">
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

            {options.topics.length > 0 ? (
              <Select value={topic} onValueChange={setTopic}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-1.5">
                      <Tag className="size-3.5 text-muted-foreground" />
                      All topics
                    </span>
                  </SelectItem>
                  {options.topics.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {options.channels.length > 0 ? (
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-1.5">
                      <Hash className="size-3.5 text-muted-foreground" />
                      All channels
                    </span>
                  </SelectItem>
                  {options.channels.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <Input
              value={userIds}
              onChange={(event) => setUserIds(event.target.value)}
              placeholder="User IDs (optional)"
              className="h-8 text-xs md:text-xs"
            />
          </div>
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void send()} disabled={!canSend}>
          {sending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          {count ? `Send to ${deviceCount(total)}` : 'Send'}
        </Button>
      </DialogFooter>
    </>
  );
}
