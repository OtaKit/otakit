import { redirect } from 'next/navigation';

import { getDashboardInitialData } from '@/app/dashboard/data';
import { SignupTracker } from '@/app/components/SignupTracker';
import { db } from '@/lib/db';
import { getOnboardingProfile } from '@/lib/services/onboarding-profile';
import { getPlanLimits } from '@/lib/billing/config';
import { OnboardingFlow } from './OnboardingFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect your app · OtaKit' };

export default async function OnboardingPage() {
  const data = await getDashboardInitialData();
  if (data.activeOrganization.role !== 'owner' && data.activeOrganization.role !== 'admin') {
    redirect('/dashboard');
  }
  const [profile, organization] = await Promise.all([
    getOnboardingProfile(data.activeOrganization.id),
    db.organization.findUniqueOrThrow({
      where: { id: data.activeOrganization.id },
      select: { planKey: true, isActive: true, freeDownloadsLimit: true },
    }),
  ]);
  if (data.apps.length > 0 && !profile?.connectedApp) redirect('/dashboard');

  return (
    <>
      <SignupTracker userId={data.user.id} createdAt={data.user.createdAt} />
      <OnboardingFlow
        key={data.activeOrganization.id}
        organizationId={data.activeOrganization.id}
        organizationName={data.activeOrganization.name}
        initialProfile={profile}
        billingEnabled={data.billingEnabled}
        currentPlan={organization.planKey}
        hasSubscription={organization.isActive || organization.planKey === 'enterprise'}
        freeDownloads={getPlanLimits('free', organization.freeDownloadsLimit).downloads}
      />
    </>
  );
}
