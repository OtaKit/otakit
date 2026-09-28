'use client';

import { useRef, useState } from 'react';

import {
  ArrowUpRight,
  Check,
  Copy,
  FlaskConical,
  KeyRound,
  LoaderCircle,
  MoreHorizontal,
  RefreshCcw,
  Trash2,
  Upload,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { PUSH_DOCS_URL, StatusPill } from './SectionHeader';

export type Provider = 'apns' | 'fcm';

export type CredentialSummary = {
  provider: Provider;
  apnsKeyId: string | null;
  apnsTeamId: string | null;
  apnsBundleId: string | null;
  fcmProjectId: string | null;
  fcmClientEmail: string | null;
  lastTestAt: string | null;
  lastTestResult: string | null;
  updatedAt: string;
};

type TestResult = { ok: boolean; result: string; message: string };

const PROVIDERS: Array<{ provider: Provider; name: string; platform: 'ios' | 'android' }> = [
  { provider: 'apns', name: 'Apple (APNs)', platform: 'ios' },
  { provider: 'fcm', name: 'Google (Firebase)', platform: 'android' },
];

async function readError(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as ApiError | null;
  return data?.error ?? fallback;
}

function detail(credential: CredentialSummary): string {
  return credential.provider === 'apns'
    ? [credential.apnsBundleId, credential.apnsKeyId, credential.apnsTeamId]
        .filter(Boolean)
        .join(' · ')
    : (credential.fcmProjectId ?? '');
}

function CredentialStatus({ credential }: { credential: CredentialSummary | null }) {
  if (!credential) return <StatusPill tone="muted">not set up</StatusPill>;
  if (credential.lastTestResult === 'ok') return <StatusPill tone="green">verified</StatusPill>;
  if (credential.lastTestResult) return <StatusPill tone="red">test failed</StatusPill>;
  return <StatusPill tone="muted">not tested</StatusPill>;
}

export function PushKeysDialog({
  appId,
  appName,
  credentials,
  canManage,
  open,
  onOpenChange,
  onChanged,
}: {
  appId: string;
  appName: string;
  credentials: CredentialSummary[];
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Provider | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function close(next: boolean) {
    if (!next) setEditing(null);
    onOpenChange(next);
  }

  async function test(provider: Provider) {
    setBusy(`test:${provider}`);
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/credentials/${provider}/test`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(await readError(response, 'Test failed'));
      const result = (await response.json()) as TestResult;
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  }

  async function remove(provider: Provider) {
    setBusy(`remove:${provider}`);
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/credentials/${provider}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not remove'));
      toast.success('Key removed');
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove');
    } finally {
      setBusy(null);
    }
  }

  async function save(provider: Provider, body: Record<string, unknown>): Promise<boolean> {
    setBusy(`save:${provider}`);
    try {
      const response = await fetch(`/api/v1/apps/${appId}/push/credentials/${provider}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readError(response, 'Could not save'));
      setEditing(null);
      await onChanged();
      await test(provider);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const byProvider = (provider: Provider) =>
    credentials.find((credential) => credential.provider === provider) ?? null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {editing === 'apns' ? (
          <ApnsForm
            credential={byProvider('apns')}
            bundleIdHint={appName}
            saving={busy === 'save:apns'}
            onBack={() => setEditing(null)}
            onSave={(body) => save('apns', body)}
          />
        ) : editing === 'fcm' ? (
          <FcmForm
            saving={busy === 'save:fcm'}
            onBack={() => setEditing(null)}
            onSave={(body) => save('fcm', body)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4" />
                Push keys
              </DialogTitle>
              <DialogDescription>
                Used to deliver notifications to {appName}. Stored encrypted.
              </DialogDescription>
            </DialogHeader>

            <div className="divide-y divide-border rounded-lg border border-border">
              {PROVIDERS.map(({ provider, name, platform }) => {
                const credential = byProvider(provider);
                const rowBusy = busy?.endsWith(`:${provider}`) ?? false;
                return (
                  <div key={provider} className="flex h-14 items-center gap-3 px-4">
                    <PlatformIcon platform={platform} className="size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{name}</div>
                      {credential ? (
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {detail(credential)}
                        </div>
                      ) : null}
                    </div>
                    <CredentialStatus credential={credential} />
                    {canManage ? (
                      credential ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-7 p-0"
                              disabled={rowBusy}
                            >
                              {rowBusy ? (
                                <RefreshCcw className="size-3.5 animate-spin" />
                              ) : (
                                <MoreHorizontal className="size-3.5" />
                              )}
                              <span className="sr-only">Key actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => void test(provider)}>
                              <FlaskConical className="size-3.5" />
                              Test
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditing(provider)}>
                              <Upload className="size-3.5" />
                              Replace
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => void remove(provider)}
                            >
                              <Trash2 className="size-3.5" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => setEditing(provider)}
                        >
                          Add
                        </Button>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>

            {!canManage ? (
              <p className="text-xs text-muted-foreground">
                Only workspace owners and admins can change keys.
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-mono transition-colors hover:text-foreground"
                title="Copy the app ID for OtaKitPush.init()"
                onClick={() => {
                  void navigator.clipboard.writeText(appId);
                  setCopied(true);
                  toast.success('App ID copied');
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                App ID {appId.slice(0, 13)}…
                {copied ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </button>
              <a
                href={PUSH_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              >
                Setup guide
                <ArrowUpRight className="size-3" />
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FilePicker({
  accept,
  label,
  fileName,
  onFile,
}: {
  accept: string;
  label: string;
  fileName: string;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        <Upload className="size-3.5" />
        {label}
      </Button>
      <span className="truncate text-xs text-muted-foreground">{fileName || 'No file chosen'}</span>
    </div>
  );
}

function ApnsForm({
  credential,
  bundleIdHint,
  saving,
  onBack,
  onSave,
}: {
  credential: CredentialSummary | null;
  bundleIdHint: string;
  saving: boolean;
  onBack: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [p8Pem, setP8Pem] = useState('');
  const [fileName, setFileName] = useState('');
  const [keyId, setKeyId] = useState(credential?.apnsKeyId ?? '');
  const [teamId, setTeamId] = useState(credential?.apnsTeamId ?? '');
  const [bundleId, setBundleId] = useState(credential?.apnsBundleId ?? bundleIdHint);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PlatformIcon platform="ios" className="size-4" />
          Apple (APNs) key
        </DialogTitle>
        <DialogDescription>
          From Apple Developer → Keys, with Apple Push Notifications service enabled.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Key file</Label>
          <FilePicker
            accept=".p8"
            label="Choose .p8 file"
            fileName={fileName}
            onFile={async (file) => {
              setP8Pem(await file.text());
              setFileName(file.name);
              // Apple names the file AuthKey_<KEYID>.p8.
              const match = /AuthKey_([A-Z0-9]{10})\.p8$/i.exec(file.name);
              if (match) setKeyId(match[1].toUpperCase());
            }}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="apns-key-id">Key ID</Label>
            <Input
              id="apns-key-id"
              value={keyId}
              onChange={(event) => setKeyId(event.target.value)}
              placeholder="ABC123DEFG"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="apns-team-id">Team ID</Label>
            <Input
              id="apns-team-id"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              placeholder="A1B2C3D4E5"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="apns-bundle-id">Bundle ID</Label>
          <Input
            id="apns-bundle-id"
            value={bundleId}
            onChange={(event) => setBundleId(event.target.value)}
            placeholder="com.example.app"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button
          onClick={() => void onSave({ p8Pem, keyId, teamId, bundleId })}
          disabled={saving || !p8Pem || !keyId.trim() || !teamId.trim() || !bundleId.trim()}
        >
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Save and test
        </Button>
      </DialogFooter>
    </>
  );
}

function FcmForm({
  saving,
  onBack,
  onSave,
}: {
  saving: boolean;
  onBack: () => void;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [json, setJson] = useState('');
  const [fileName, setFileName] = useState('');

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PlatformIcon platform="android" className="size-4" />
          Google (Firebase) key
        </DialogTitle>
        <DialogDescription>
          From Firebase → Project settings → Service accounts → Generate new private key.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label>Service account file</Label>
        <FilePicker
          accept=".json,application/json"
          label="Choose .json file"
          fileName={fileName}
          onFile={async (file) => {
            setJson(await file.text());
            setFileName(file.name);
          }}
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button
          onClick={() => void onSave({ serviceAccountJson: json })}
          disabled={saving || !json}
        >
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          Save and test
        </Button>
      </DialogFooter>
    </>
  );
}
