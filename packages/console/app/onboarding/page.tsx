import { redirect } from 'next/navigation';

import { getDashboardInitialData } from '@/app/dashboard/data';
import { SignupTracker } from '@/app/components/SignupTracker';
import { getOnboardingProfile } from '@/lib/services/onboarding-profile';
import { OnboardingFlow } from './OnboardingFlow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome to OtaKit' };

export default async function OnboardingPage() {
  const data = await getDashboardInitialData();
  if (data.activeOrganization.role !== 'owner' && data.activeOrganization.role !== 'admin') {
    redirect('/dashboard');
  }
  const profile = await getOnboardingProfile(data.activeOrganization.id);
  if (data.apps.length > 0) {
    redirect('/dashboard');
  }

  return (
    <>
      <SignupTracker userId={data.user.id} createdAt={data.user.createdAt} />
      <OnboardingFlow
        key={data.activeOrganization.id}
        organizationId={data.activeOrganization.id}
        organizationName={data.activeOrganization.name}
        initialProfile={profile}
      />
    </>
  );
}
