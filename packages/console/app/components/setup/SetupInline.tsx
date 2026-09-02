'use client';

import { SetupPanel } from './SetupPanel';
import { useSetupStatus } from './SetupStatusProvider';

/**
 * The same checklist the header badge opens, placed where a brand-new account
 * is already looking. Reads the shared snapshot, so it costs no extra request.
 */
export function SetupInline() {
  const { snapshot } = useSetupStatus();
  if (!snapshot || snapshot.complete) return null;

  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border bg-background text-left shadow-sm">
      <SetupPanel snapshot={snapshot} />
    </div>
  );
}
