'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/** Switches the push add-on for the active workspace and refreshes dashboard data. */
export function usePushAddon() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function setEnabled(enabled: boolean) {
    setSaving(true);
    try {
      const response = await fetch('/api/v1/organization/addons/push', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? 'Could not update push notifications');
      toast.success(enabled ? 'Push notifications turned on' : 'Push notifications turned off');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update push notifications');
    } finally {
      setSaving(false);
    }
  }

  return { saving, setEnabled };
}
