'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BundleSummaryItem, ReleaseHistoryItem } from './dashboard-types';

type Action = {
  appId: string;
  url: string;
  title: string;
  operationKey: string;
  rnIntent: { version: 1; actorKey: string; preparedAt: string };
  expectedCurrentReleaseId: string | null;
  bundleId?: string;
  channel?: string | null;
  preparedAt: number;
  sentAt: number | null;
};

export function RNReleasesPanel({
  appId,
  bundles,
  releases,
  reload,
}: {
  appId: string;
  bundles: BundleSummaryItem[];
  releases: ReleaseHistoryItem[];
  reload: () => Promise<unknown>;
}) {
  const [channel, setChannel] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [receiptBlocked, setReceiptBlocked] = useState(false);
  const receiptKey = `otakit-rn-publication:${appId}`;
  useEffect(() => {
    setAction(null);
    setMessage('');
    setReviewOpen(false);
    setReceiptBlocked(false);
    try {
      const saved = localStorage.getItem(receiptKey);
      if (!saved) return;
      const value = JSON.parse(saved) as Action;
      const base = `/api/v1/apps/${encodeURIComponent(appId)}/releases`;
      if (
        value.appId !== appId ||
        typeof value.operationKey !== 'string' ||
        !value.operationKey ||
        !(
          value.url === base ||
          (typeof value.url === 'string' &&
            value.url.startsWith(`${base}/`) &&
            /^\/[^/]+\/revert$/.test(value.url.slice(base.length)))
        ) ||
        value.rnIntent?.version !== 1 ||
        typeof value.rnIntent.actorKey !== 'string' ||
        !Number.isFinite(Date.parse(value.rnIntent.preparedAt)) ||
        !Number.isFinite(value.preparedAt) ||
        !(
          value.sentAt === null ||
          (Number.isFinite(value.sentAt) && value.sentAt >= value.preparedAt)
        ) ||
        !(
          value.expectedCurrentReleaseId === null ||
          typeof value.expectedCurrentReleaseId === 'string'
        )
      )
        throw new Error('Invalid receipt');
      setAction(value);
    } catch {
      setReceiptBlocked(true);
      setMessage(
        'The saved operation cannot be read safely. Publishing is blocked; reconcile the release history and saved receipt first.',
      );
    }
  }, [appId, receiptKey]);

  async function prepare(bundle: BundleSummaryItem, release?: ReleaseHistoryItem) {
    if (action || busy || receiptBlocked) return;
    setBusy(true);
    setMessage('');
    try {
      const base = `/api/v1/apps/${encodeURIComponent(appId)}/releases`;
      const response = await fetch(
        release ? `${base}/${encodeURIComponent(release.id)}/prepare-revert` : `${base}/prepare`,
        release
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ bundleId: bundle.id, channel: channel.trim() || null }),
            },
      );
      const prepared = await response.json();
      if (!response.ok || !prepared.rnIntent)
        throw new Error(prepared.error ?? 'Could not prepare RN operation');
      if (
        prepared.platform !== bundle.platform ||
        prepared.runtimeVersion !== bundle.runtimeVersion ||
        prepared.rnIntent.version !== 1 ||
        typeof prepared.rnIntent.actorKey !== 'string' ||
        !Number.isFinite(Date.parse(prepared.rnIntent.preparedAt))
      )
        throw new Error(
          'The prepared operation does not match the selected RN target. Refresh the release history.',
        );
      const next: Action = {
        appId,
        url: release ? `${base}/${encodeURIComponent(release.id)}/revert` : base,
        title: `${release ? 'Revert' : 'Publish'} ${bundle.version} · ${bundle.platform} · ${prepared.channel ?? 'base'}`,
        operationKey: crypto.randomUUID(),
        rnIntent: prepared.rnIntent,
        expectedCurrentReleaseId: prepared.expectedCurrentReleaseId,
        ...(release ? {} : { bundleId: bundle.id, channel: prepared.channel }),
        preparedAt: Date.now(),
        sentAt: null,
      };
      localStorage.setItem(receiptKey, JSON.stringify(next));
      setAction(next);
      setReviewOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preparation failed');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!action || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const now = Date.now();
      if (
        now < (action.sentAt ?? action.preparedAt) ||
        now - action.preparedAt > 23 * 3600_000 ||
        Math.abs(Date.parse(action.rnIntent.preparedAt) - action.preparedAt) > 5 * 60_000
      )
        throw new Error(
          'Retry window or clock evidence is unsafe. Reconcile this operation with release history.',
        );
      const pending = { ...action, sentAt: now };
      localStorage.setItem(receiptKey, JSON.stringify(pending));
      setAction(pending);
      const response = await fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': action.operationKey },
        body: JSON.stringify({
          bundleId: action.bundleId,
          channel: action.channel,
          rnIntent: action.rnIntent,
          expectedCurrentReleaseId: action.expectedCurrentReleaseId,
          forceImmediate: false,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'RN operation failed');
      localStorage.removeItem(receiptKey);
      setAction(null);
      setReviewOpen(false);
      setMessage(
        result.publicationStatus === 'manifest_sync_pending'
          ? 'Saved; manifest synchronization is pending.'
          : 'Operation completed. Current releases are shown below.',
      );
      await reload();
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : 'Response unavailable'} The original operation is retained for reconciliation or retry.`,
      );
    } finally {
      setBusy(false);
    }
  }
  const grouped = new Map<string, BundleSummaryItem[]>();
  for (const bundle of bundles)
    grouped.set(bundle.version, [...(grouped.get(bundle.version) ?? []), bundle]);
  return (
    <section className="mx-auto max-w-screen-xl space-y-4 p-6">
      <h2 className="text-lg font-semibold">React Native updates</h2>
      <label className="block text-sm">
        Publication channel (empty for base)
        <Input
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
          disabled={busy || !!action}
        />
      </label>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {action && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
          <span>Saved operation: {action.title}</span>
          <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
            Review original operation
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void reload().catch(() => setMessage('Could not refresh release history.'))
            }
          >
            Refresh release history
          </Button>
        </div>
      )}
      {[...grouped].map(([version, variants]) => (
        <div key={version} className="rounded-md border p-4">
          <h3 className="font-medium">{version}</h3>
          {variants.map((bundle) => {
            const current = releases.filter(
              (release) =>
                release.bundleId === bundle.id &&
                !release.revertedAt &&
                bundle.currentTargets.some(
                  (target) =>
                    target.channel === release.channel &&
                    target.runtimeVersion === release.runtimeVersion,
                ),
            );
            return (
              <div key={bundle.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span>{bundle.platform}</span>
                <code className="break-all">{bundle.runtimeVersion}</code>
                <span>
                  {bundle.currentTargets.map((target) => target.channel ?? 'base').join(', ') ||
                    'Not current'}
                </span>
                <span>
                  {bundle.eventCounts.applied} applied · {bundle.eventCounts.rollbacks} rollbacks
                </span>
                <Button
                  size="sm"
                  disabled={busy || !!action || receiptBlocked}
                  onClick={() => void prepare(bundle)}
                >
                  Publish
                </Button>
                {current.map((release) => (
                  <Button
                    key={release.id}
                    size="sm"
                    variant="outline"
                    disabled={busy || !!action || receiptBlocked}
                    onClick={() => void prepare(bundle, release)}
                  >
                    Revert {release.channel ?? 'base'}
                  </Button>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      <Dialog open={reviewOpen && !!action} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action?.title}</DialogTitle>
            <DialogDescription>
              {action?.sentAt
                ? 'This operation may already have completed. Retry keeps its original identity and reviewed release state.'
                : 'This affects only the selected platform, runtime and channel.'}
            </DialogDescription>
          </DialogHeader>
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
          <DialogFooter>
            {action?.sentAt === null && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  try {
                    localStorage.removeItem(receiptKey);
                    setAction(null);
                    setReviewOpen(false);
                  } catch {
                    setMessage('The saved receipt could not be removed.');
                  }
                }}
              >
                Cancel preparation
              </Button>
            )}
            <Button disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Working…' : action?.sentAt ? 'Retry original operation' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
