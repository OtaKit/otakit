'use client';

import { useEffect, useMemo, useState } from 'react';

import { LoaderCircle, Send } from 'lucide-react';
import { toast } from 'sonner';

import type { ApiError } from '@/app/components/dashboard-types';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type AudienceCount = { total: number; ios: number; android: number };

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PushComposer({ appId, onSent }: { appId: string; onSent: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [ios, setIos] = useState(true);
  const [android, setAndroid] = useState(true);
  const [topics, setTopics] = useState('');
  const [userIds, setUserIds] = useState('');
  const [channels, setChannels] = useState('');
  const [count, setCount] = useState<AudienceCount | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [counting, setCounting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const audience = useMemo(() => {
    const platforms = [ios && 'ios', android && 'android'].filter(Boolean) as string[];
    const value: Record<string, string[]> = {};
    if (platforms.length === 1) value.platforms = platforms;
    if (splitList(topics).length) value.topics = splitList(topics);
    if (splitList(userIds).length) value.userIds = splitList(userIds);
    if (splitList(channels).length) value.channels = splitList(channels);
    return value;
  }, [ios, android, topics, userIds, channels]);

  const noPlatform = !ios && !android;

  // Count who would receive it. The payload is only a placeholder here, so the
  // count works before the message is written.
  useEffect(() => {
    if (noPlatform) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setCounting(true);
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
        if (!controller.signal.aborted) {
          setCount(null);
          setWarnings([error instanceof Error ? error.message : 'Could not count devices']);
        }
      } finally {
        if (!controller.signal.aborted) setCounting(false);
      }
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [appId, audience, noPlatform]);

  const canSend = title.trim() && body.trim() && !noPlatform && (count?.total ?? 0) > 0 && !sending;

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
      toast.success(`Sending to ${data.campaign.targeted.toLocaleString()} devices`);
      setTitle('');
      setBody('');
      setUrl('');
      setIdempotencyKey(crypto.randomUUID());
      onSent();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send');
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="grid gap-6 px-5 py-6 md:grid-cols-[1fr_260px]">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="push-title">Title</Label>
          <Input
            id="push-title"
            value={title}
            maxLength={100}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Your order is on its way"
          />
        </div>
        <div className="space-y-1.5">
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
        <div className="space-y-1.5">
          <Label htmlFor="push-url">Open in the app (optional)</Label>
          <Input
            id="push-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="/orders/latest"
          />
          <p className="text-xs text-muted-foreground">
            Sent as <code>data.url</code>; handle it in <code>pushNotificationActionPerformed</code>
            .
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Audience</p>
          <div className="flex gap-5">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={ios} onCheckedChange={(value) => setIos(value === true)} /> iOS
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={android} onCheckedChange={(value) => setAndroid(value === true)} />{' '}
              Android
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="push-topics">Topics</Label>
              <Input
                id="push-topics"
                value={topics}
                onChange={(event) => setTopics(event.target.value)}
                placeholder="news, offers"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="push-channels">OTA channels</Label>
              <Input
                id="push-channels"
                value={channels}
                onChange={(event) => setChannels(event.target.value)}
                placeholder="beta"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="push-users">User IDs</Label>
              <Input
                id="push-users"
                value={userIds}
                onChange={(event) => setUserIds(event.target.value)}
                placeholder="user_1, user_2"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave filters empty to reach every device. Filters of different kinds must all match.
          </p>
          <p className="text-sm">
            {noPlatform ? (
              <span className="text-destructive">Choose at least one platform.</span>
            ) : counting || !count ? (
              <span className="text-muted-foreground">Counting devices…</span>
            ) : (
              <>
                <strong>{count.total.toLocaleString()}</strong> devices ({count.ios} iOS,{' '}
                {count.android} Android)
              </>
            )}
          </p>
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-600">
              {warning}
            </p>
          ))}
        </div>

        <Button disabled={!canSend} onClick={() => setConfirming(true)}>
          <Send className="size-3.5" />
          Send
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Preview</p>
        <div className="rounded-2xl border border-border bg-muted/50 p-3 shadow-sm">
          <p className="text-[13px] font-semibold leading-tight">{title || 'Title'}</p>
          <p className="mt-0.5 line-clamp-4 text-[13px] leading-snug text-muted-foreground">
            {body || 'Your message'}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Long text is shortened on the lock screen. Keep the first line meaningful.
        </p>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send to {count?.total.toLocaleString() ?? 0} devices?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” will be delivered right away. This cannot be undone once devices receive it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={sending}
              onClick={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              {sending && <LoaderCircle className="size-3.5 animate-spin" />}
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
