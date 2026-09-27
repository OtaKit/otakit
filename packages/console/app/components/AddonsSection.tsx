'use client';

import Link from 'next/link';

import { Bell, Blocks } from 'lucide-react';

import { usePushAddon } from '@/app/components/push/use-push-addon';
import { Switch } from '@/components/ui/switch';

/** Optional products a workspace switches on. Each one adds its own menu item. */
export function AddonsSection({
  pushEnabled,
  canManage,
}: {
  pushEnabled: boolean;
  canManage: boolean;
}) {
  const { saving, setEnabled } = usePushAddon();

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border bg-background px-5 pb-6 pt-8">
        <Blocks className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold leading-tight">Add-ons</h2>
          <p className="text-xs leading-tight text-muted-foreground">
            Optional tools for this workspace
          </p>
        </div>
      </div>
      <div className="flex items-start gap-4 p-5">
        <Bell className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-medium">Push notifications</div>
          <p className="text-xs text-muted-foreground">
            Free push for your Capacitor apps on iOS and Android: send from the dashboard, API, CLI
            or an AI agent. Adds a Push menu item.
            {pushEnabled ? (
              <>
                {' '}
                <Link href="/dashboard/push" className="underline underline-offset-2">
                  Open Push
                </Link>
              </>
            ) : null}
          </p>
          {pushEnabled ? (
            <p className="text-xs text-muted-foreground">
              Turning it off keeps your keys and devices, and new devices are not registered.
            </p>
          ) : null}
        </div>
        <Switch
          checked={pushEnabled}
          onCheckedChange={(checked) => void setEnabled(checked)}
          disabled={!canManage || saving}
          aria-label="Push notifications"
        />
      </div>
    </>
  );
}
