'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  History,
  LoaderCircle,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Send,
  Slack,
  Trash2,
  Webhook,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  DEFAULT_EMAIL_EVENTS,
  FAILING_AFTER_FAILURES,
  MAX_DESTINATION_NAME_LENGTH,
  NOTIFICATION_EVENTS,
  notificationEventLabel,
  type NotificationEventType,
} from '@/lib/notifications/events';
import type {
  EmailRecipients,
  NotificationDeliveryView,
  NotificationDestinationView,
} from '@/lib/services/notifications';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

type DestinationType = NotificationDestinationView['type'];

type Settings = {
  destinations: NotificationDestinationView[];
  apps: Array<{ id: string; slug: string }>;
  members: Array<{ userId: string; email: string; role: string }>;
};

const DOCS_URL = 'https://otakit.app/docs/webhooks';

const TYPES: Array<{
  type: DestinationType;
  label: string;
  icon: typeof Mail;
  namePlaceholder: string;
  urlPlaceholder?: string;
  urlHint?: string;
}> = [
  {
    type: 'email',
    label: 'Email',
    icon: Mail,
    namePlaceholder: 'Release managers',
  },
  {
    type: 'slack',
    label: 'Slack',
    icon: Slack,
    namePlaceholder: '#releases',
    urlPlaceholder: 'https://hooks.slack.com/services/…',
    urlHint: 'In Slack, add an incoming webhook to the channel and paste its URL.',
  },
  {
    type: 'discord',
    label: 'Discord',
    icon: MessageSquare,
    namePlaceholder: '#releases',
    urlPlaceholder: 'https://discord.com/api/webhooks/…',
    urlHint: 'In Discord, open the channel settings → Integrations → Webhooks and copy the URL.',
  },
  {
    type: 'webhook',
    label: 'Webhook',
    icon: Webhook,
    namePlaceholder: 'CI pipeline',
    urlPlaceholder: 'https://example.com/webhooks/otakit',
    urlHint: 'Requests are JSON, signed per the Standard Webhooks spec.',
  },
];

const RELEASE_ACTIVITY: NotificationEventType[] = [
  'release.published',
  'release.rollout_updated',
  'release.reverted',
  'release.auto_reverted',
  'release.auto_revert_suppressed',
];

const EVENT_GROUPS = Array.from(new Set(NOTIFICATION_EVENTS.map((event) => event.group))).map(
  (group) => ({ group, events: NOTIFICATION_EVENTS.filter((event) => event.group === group) }),
);

function typeInfo(type: DestinationType) {
  return TYPES.find((item) => item.type === type) ?? TYPES[0];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? 'Request failed');
  return body;
}

function target(destination: NotificationDestinationView): string {
  if (destination.type !== 'email') {
    try {
      return new URL(destination.url ?? '').host;
    } catch {
      return destination.url ?? '';
    }
  }
  const recipients = destination.emailRecipients;
  if (recipients?.mode === 'members') {
    return `${recipients.userIds.length} member${recipients.userIds.length === 1 ? '' : 's'}`;
  }
  return 'Owners and admins';
}

function DestinationStatus({ destination }: { destination: NotificationDestinationView }) {
  if (!destination.enabled) {
    const reason =
      destination.disabledReason === 'endpoint_gone'
        ? 'Turned off: the endpoint answered 410 Gone'
        : destination.disabledReason === 'failing'
          ? 'Turned off after failing for 3 days'
          : 'Turned off';
    return (
      <Badge variant="outline" className="text-[10px] font-normal" title={reason}>
        Off
      </Badge>
    );
  }
  if (destination.consecutiveFailures >= FAILING_AFTER_FAILURES) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 text-[10px] font-normal text-amber-600 dark:text-amber-400"
        title={`${destination.consecutiveFailures} failed attempts in a row`}
      >
        Failing
      </Badge>
    );
  }
  return null;
}

/** Workspace notifications: where release, bundle and usage events are sent. */
export function NotificationsSection({ canManage }: { canManage: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<NotificationDestinationView | 'new' | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<NotificationDestinationView | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await request<Settings>('/api/v1/organization/notifications'));
      setLoadFailed(false);
    } catch (error) {
      setLoadFailed(true);
      toast.error(error instanceof Error ? error.message : 'Could not load notifications');
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  function replace(destination: NotificationDestinationView) {
    setSettings((current) =>
      current
        ? {
            ...current,
            destinations: current.destinations.some((item) => item.id === destination.id)
              ? current.destinations.map((item) =>
                  item.id === destination.id ? destination : item,
                )
              : [...current.destinations, destination],
          }
        : current,
    );
  }

  async function sendTest(destination: NotificationDestinationView) {
    setBusy(destination.id);
    try {
      const { delivery } = await request<{ delivery: NotificationDeliveryView }>(
        `/api/v1/organization/notifications/${destination.id}/test`,
        { method: 'POST' },
      );
      if (delivery.status === 'delivered') {
        toast.success(
          delivery.lastStatusCode
            ? `Test delivered (HTTP ${delivery.lastStatusCode})`
            : 'Test email sent',
        );
      } else {
        toast.error(`Test failed: ${delivery.lastError ?? 'unknown error'}`);
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send a test');
    } finally {
      setBusy(null);
    }
  }

  async function setEnabled(destination: NotificationDestinationView, enabled: boolean) {
    setBusy(destination.id);
    try {
      const { destination: updated } = await request<{
        destination: NotificationDestinationView;
      }>(`/api/v1/organization/notifications/${destination.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      replace(updated);
      toast.success(enabled ? `${destination.name} turned on` : `${destination.name} turned off`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the destination');
    } finally {
      setBusy(null);
    }
  }

  async function remove(destination: NotificationDestinationView) {
    if (!confirm(`Delete ${destination.name}? Its delivery history is deleted too.`)) return;
    setBusy(destination.id);
    try {
      await request(`/api/v1/organization/notifications/${destination.id}`, { method: 'DELETE' });
      setSettings((current) =>
        current
          ? {
              ...current,
              destinations: current.destinations.filter((item) => item.id !== destination.id),
            }
          : current,
      );
      toast.success(`${destination.name} deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the destination');
    } finally {
      setBusy(null);
    }
  }

  const appSlugs = useMemo(
    () => new Map((settings?.apps ?? []).map((app) => [app.id, app.slug])),
    [settings?.apps],
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-background px-5 pb-6 pt-8">
        <div className="flex items-center gap-3">
          <BellRing className="size-6 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold leading-tight">Notifications</h2>
            <p className="text-xs leading-tight text-muted-foreground">
              Email, Slack, Discord and webhooks
            </p>
          </div>
        </div>
        {canManage && settings ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-foreground"
            title="Add destination"
            onClick={() => setEditing('new')}
          >
            <Plus className="size-3.5" />
            <span className="sr-only">Add destination</span>
          </Button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="p-5 text-sm text-muted-foreground">
          Only owners and admins can manage notifications.
        </p>
      ) : !settings ? (
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          {loadFailed ? (
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          ) : (
            <LoaderCircle className="size-4 animate-spin" />
          )}
        </div>
      ) : settings.destinations.length === 0 ? (
        <div className="m-5 rounded-lg border border-dashed py-10 text-center">
          <BellRing className="mx-auto size-6 text-muted-foreground/40" />
          <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
            Get notified when releases go out, are reverted, or fail health checks.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing('new')}>
            <Plus className="size-3.5" />
            Add destination
          </Button>
        </div>
      ) : (
        <Table>
          <TableBody>
            {settings.destinations.map((destination) => {
              const info = typeInfo(destination.type);
              const scope = destination.appId
                ? (appSlugs.get(destination.appId) ?? 'One app')
                : 'All apps';
              return (
                <TableRow
                  key={destination.id}
                  className={`h-14 ${destination.enabled ? '' : 'opacity-60'}`}
                >
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-3 pl-5">
                      <info.icon className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm">{destination.name}</span>
                          <DestinationStatus destination={destination} />
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {info.label} · {target(destination)}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden w-44 text-right text-xs text-muted-foreground sm:table-cell">
                    <div>
                      {destination.events.length} event
                      {destination.events.length === 1 ? '' : 's'}
                    </div>
                    <div className="truncate">{scope}</div>
                  </TableCell>
                  <TableCell className="w-12 pr-5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-7 p-0"
                          disabled={busy === destination.id}
                          aria-label={`Actions for ${destination.name}`}
                        >
                          {busy === destination.id ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : (
                            <MoreHorizontal className="size-3.5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(destination)}>
                          <Pencil className="size-3.5" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void sendTest(destination)}>
                          <Send className="size-3.5" />
                          Send test
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeliveriesFor(destination)}>
                          <History className="size-3.5" />
                          Deliveries
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {destination.enabled ? (
                          <DropdownMenuItem onClick={() => void setEnabled(destination, false)}>
                            <PowerOff className="size-3.5" />
                            Turn off
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => void setEnabled(destination, true)}>
                            <Power className="size-3.5" />
                            Turn on
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => void remove(destination)}
                        >
                          <Trash2 className="size-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {settings && editing ? (
        <DestinationDialog
          key={editing === 'new' ? 'new' : editing.id}
          destination={editing === 'new' ? null : editing}
          settings={settings}
          onClose={() => setEditing(null)}
          onSaved={replace}
        />
      ) : null}
      {deliveriesFor ? (
        <DeliveriesDialog destination={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
      ) : null}
    </>
  );
}

function DestinationDialog({
  destination,
  settings,
  onClose,
  onSaved,
}: {
  destination: NotificationDestinationView | null;
  settings: Settings;
  onClose: () => void;
  onSaved: (destination: NotificationDestinationView) => void;
}) {
  const creating = destination === null;
  const [type, setType] = useState<DestinationType>(destination?.type ?? 'slack');
  const [name, setName] = useState(destination?.name ?? '');
  const [url, setUrl] = useState(destination?.url ?? '');
  const [appId, setAppId] = useState(destination?.appId ?? 'all');
  const [events, setEvents] = useState<Set<string>>(
    new Set(destination?.events ?? RELEASE_ACTIVITY),
  );
  const [recipients, setRecipients] = useState<EmailRecipients>(
    destination?.emailRecipients ?? { mode: 'owners_admins' },
  );
  const [saving, setSaving] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const info = typeInfo(type);

  function chooseType(next: DestinationType) {
    setType(next);
    // Email defaults to alerts; chat and webhooks default to release activity.
    setEvents(new Set(next === 'email' ? DEFAULT_EMAIL_EVENTS : RELEASE_ACTIVITY));
  }

  function toggleEvent(event: string, checked: boolean) {
    setEvents((current) => {
      const next = new Set(current);
      if (checked) next.add(event);
      else next.delete(event);
      return next;
    });
  }

  function toggleMember(userId: string, checked: boolean) {
    setRecipients((current) => {
      const userIds = new Set(current.mode === 'members' ? current.userIds : []);
      if (checked) userIds.add(userId);
      else userIds.delete(userId);
      return { mode: 'members', userIds: Array.from(userIds) };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const body = {
        name,
        events: NOTIFICATION_EVENTS.map((event) => event.type).filter((event) => events.has(event)),
        appId: appId === 'all' ? null : appId,
        ...(type === 'email' ? { emailRecipients: recipients } : { url }),
      };
      if (creating) {
        const result = await request<{
          destination: NotificationDestinationView;
          secret: string | null;
        }>('/api/v1/organization/notifications', {
          method: 'POST',
          body: JSON.stringify({ ...body, type }),
        });
        onSaved(result.destination);
        toast.success(`${result.destination.name} added`);
        if (result.secret) {
          setCreatedSecret(result.secret);
          return;
        }
      } else {
        const result = await request<{ destination: NotificationDestinationView }>(
          `/api/v1/organization/notifications/${destination.id}`,
          { method: 'PATCH', body: JSON.stringify(body) },
        );
        onSaved(result.destination);
        toast.success('Changes saved');
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const memberIds = recipients.mode === 'members' ? new Set(recipients.userIds) : new Set();
  const valid =
    name.trim().length > 0 &&
    events.size > 0 &&
    (type === 'email' ? recipients.mode === 'owners_admins' || memberIds.size > 0 : url.trim());

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <info.icon className="size-4" />
            {createdSecret
              ? 'Webhook added'
              : creating
                ? 'Add destination'
                : `Edit ${destination.name}`}
          </DialogTitle>
          <DialogDescription>
            {createdSecret
              ? 'Use this secret to verify that requests come from OtaKit.'
              : 'Choose where notifications go and which events they cover.'}
          </DialogDescription>
        </DialogHeader>

        {createdSecret ? (
          <SecretBox
            secret={createdSecret}
            note="Owners and admins can see it again in the webhook's settings."
          />
        ) : (
          <div className="space-y-5">
            {creating ? (
              <div className="space-y-2">
                <Label htmlFor="destination-type">Type</Label>
                <Select
                  value={type}
                  onValueChange={(value) => chooseType(value as DestinationType)}
                >
                  <SelectTrigger id="destination-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((item) => (
                      <SelectItem key={item.type} value={item.type}>
                        <item.icon className="size-3.5" />
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="destination-name">Name</Label>
              <Input
                id="destination-name"
                value={name}
                maxLength={MAX_DESTINATION_NAME_LENGTH}
                placeholder={info.namePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            {type === 'email' ? (
              <div className="space-y-2">
                <Label htmlFor="destination-recipients">Send to</Label>
                <Select
                  value={recipients.mode}
                  onValueChange={(value) =>
                    setRecipients(
                      value === 'members'
                        ? { mode: 'members', userIds: [] }
                        : { mode: 'owners_admins' },
                    )
                  }
                >
                  <SelectTrigger id="destination-recipients" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="owners_admins">Owners and admins</SelectItem>
                    <SelectItem value="members">Chosen members</SelectItem>
                  </SelectContent>
                </Select>
                {recipients.mode === 'members' ? (
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
                    {settings.members.map((member) => (
                      <label key={member.userId} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={memberIds.has(member.userId)}
                          onCheckedChange={(checked) =>
                            toggleMember(member.userId, checked === true)
                          }
                        />
                        <span className="truncate">{member.email}</span>
                        <span className="text-xs text-muted-foreground">{member.role}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="destination-url">URL</Label>
                <Input
                  id="destination-url"
                  type="url"
                  value={url}
                  placeholder={info.urlPlaceholder}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {info.urlHint}{' '}
                  <a
                    href={DOCS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Docs
                  </a>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="destination-app">Apps</Label>
              <Select value={appId} onValueChange={setAppId}>
                <SelectTrigger id="destination-app" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All apps</SelectItem>
                  {settings.apps.map((app) => (
                    <SelectItem key={app.id} value={app.id}>
                      {app.slug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>Events</Label>
              {EVENT_GROUPS.map(({ group, events: groupEvents }) => (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{group}</p>
                  {groupEvents.map((event) => (
                    <div key={event.type} className="flex items-start gap-2">
                      <Checkbox
                        id={`event-${event.type}`}
                        checked={events.has(event.type)}
                        onCheckedChange={(checked) => toggleEvent(event.type, checked === true)}
                      />
                      <div className="grid gap-1 leading-none">
                        <Label htmlFor={`event-${event.type}`} className="text-sm font-normal">
                          {event.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{event.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {!creating && destination.type === 'webhook' ? (
              <SigningSecret destinationId={destination.id} />
            ) : null}
          </div>
        )}

        <DialogFooter>
          {createdSecret ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void save()} disabled={saving || !valid}>
                {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {creating ? 'Add' : 'Save'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretBox({ secret, note }: { secret: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="text-xs text-muted-foreground">
        {note ? `${note} ` : null}
        <a
          href={`${DOCS_URL}#verify`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          How to verify
        </a>
      </p>
      <div className="mt-2 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all text-xs leading-relaxed">{secret}</code>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 shrink-0 p-0"
          title="Copy"
          onClick={() => {
            void navigator.clipboard.writeText(secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function SigningSecret({ destinationId }: { destinationId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/v1/organization/notifications/${destinationId}/secret`;

  async function load(method: 'GET' | 'POST') {
    if (
      method === 'POST' &&
      !confirm('Rotate the signing secret? The current secret keeps working for 24 hours.')
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ secret: string }>(url, { method });
      setSecret(result.secret);
      if (method === 'POST') toast.success('Secret rotated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the secret');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>Signing secret</Label>
      {secret ? (
        <SecretBox secret={secret} />
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs text-muted-foreground">whsec_••••••••••••</code>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load('GET')}>
            <Eye className="size-3.5" />
            Reveal
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        disabled={busy}
        onClick={() => void load('POST')}
      >
        <RotateCw className="size-3" />
        Rotate secret
      </Button>
    </div>
  );
}

function DeliveryStatus({ delivery }: { delivery: NotificationDeliveryView }) {
  const styles: Record<NotificationDeliveryView['status'], [string, string]> = {
    delivered: ['Delivered', 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40'],
    failed: ['Failed', 'text-destructive border-destructive/40'],
    sending: ['Sending', ''],
    pending: [delivery.attempts > 0 ? 'Retrying' : 'Queued', 'text-amber-600 dark:text-amber-400'],
  };
  const [label, className] = styles[delivery.status];
  return (
    <Badge variant="outline" className={`text-[10px] font-normal ${className}`}>
      {label}
    </Badge>
  );
}

function DeliveriesDialog({
  destination,
  onClose,
}: {
  destination: NotificationDestinationView;
  onClose: () => void;
}) {
  const [deliveries, setDeliveries] = useState<NotificationDeliveryView[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [redelivering, setRedelivering] = useState<string | null>(null);
  const base = `/api/v1/organization/notifications/${destination.id}`;

  const load = useCallback(async () => {
    try {
      const result = await request<{ deliveries: NotificationDeliveryView[] }>(
        `${base}/deliveries`,
      );
      setDeliveries(result.deliveries);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load deliveries');
      setDeliveries([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function redeliver(delivery: NotificationDeliveryView) {
    setRedelivering(delivery.id);
    try {
      const result = await request<{ delivery: NotificationDeliveryView }>(
        `${base}/deliveries/${delivery.id}/redeliver`,
        { method: 'POST' },
      );
      setDeliveries((current) =>
        (current ?? []).map((item) => (item.id === delivery.id ? result.delivery : item)),
      );
      if (result.delivery.status === 'delivered') toast.success('Delivered');
      else toast.error(result.delivery.lastError ?? 'Delivery failed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not redeliver');
    } finally {
      setRedelivering(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" />
            Deliveries to {destination.name}
          </DialogTitle>
          <DialogDescription>
            The last 50. Failed deliveries are retried for about a day.
          </DialogDescription>
        </DialogHeader>
        {deliveries === null ? (
          <div className="flex justify-center p-8">
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : deliveries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing sent yet. Use &ldquo;Send test&rdquo; to try it.
          </p>
        ) : (
          <Table>
            <TableBody>
              {deliveries.map((delivery) => {
                const open = expanded === delivery.id;
                return (
                  <Fragment key={delivery.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(open ? null : delivery.id)}
                    >
                      <TableCell className="w-6 pr-0">
                        {open ? (
                          <ChevronDown className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3.5 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {notificationEventLabel(delivery.eventType)}
                      </TableCell>
                      <TableCell>
                        <DeliveryStatus delivery={delivery} />
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                        {delivery.lastStatusCode ? `HTTP ${delivery.lastStatusCode}` : ''}
                        {delivery.attempts > 1 ? ` · ${delivery.attempts} attempts` : ''}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDate(delivery.createdAt)}
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={5} className="space-y-3 whitespace-normal bg-muted/30">
                          {delivery.lastError ? (
                            <p className="break-words text-xs text-destructive">
                              {delivery.lastError}
                            </p>
                          ) : null}
                          {delivery.nextAttemptAt && delivery.attempts > 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Next attempt {formatDate(delivery.nextAttemptAt)}
                            </p>
                          ) : null}
                          <pre className="max-h-64 overflow-auto rounded-md border bg-background p-3 text-[11px] leading-relaxed">
                            {JSON.stringify(delivery.payload, null, 2)}
                          </pre>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={redelivering !== null || delivery.status === 'sending'}
                              onClick={(event) => {
                                event.stopPropagation();
                                void redeliver(delivery);
                              }}
                            >
                              {redelivering === delivery.id ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : (
                                <RotateCw className="size-3.5" />
                              )}
                              Redeliver
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                void navigator.clipboard.writeText(
                                  JSON.stringify(delivery.payload, null, 2),
                                );
                                toast.success('Payload copied');
                              }}
                            >
                              <Copy className="size-3.5" />
                              Copy payload
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
