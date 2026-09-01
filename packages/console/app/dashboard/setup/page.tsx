import { redirect } from 'next/navigation';

import { SetupGuide } from '@/app/components/SetupGuide';
import { getOnboardingSnapshot } from '@/lib/services/onboarding';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ appId?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { appId } = await searchParams;
  const snapshot = await getOnboardingSnapshot({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    appId: appId?.trim() || undefined,
  });

  // Rendered on the server so the checklist paints already-resolved rather than
  // flashing five empty rows on every visit.
  return <SetupGuide initialSnapshot={snapshot} />;
}
