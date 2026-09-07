import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { DashboardDataProvider } from '@/app/dashboard/DashboardDataProvider';
import { getDashboardInitialData } from '@/app/dashboard/data';
import { SignupTracker } from '@/app/components/SignupTracker';
import { SetupStatusProvider } from '@/app/components/setup/SetupStatusProvider';
import { getOnboardingProfile } from '@/lib/services/onboarding-profile';
import { shouldShowOnboarding } from '@/lib/onboarding-profile';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const initialData = await getDashboardInitialData();
  if (initialData.apps.length === 0 && initialData.activeOrganization.role === 'owner') {
    const profile = await getOnboardingProfile(initialData.activeOrganization.id);
    // Business onboarding ends when the questions are completed or skipped.
    // Connecting an app is a separate flow in the dashboard's setup panel.
    if (
      shouldShowOnboarding({
        appCount: initialData.apps.length,
        role: initialData.activeOrganization.role,
        profile,
      })
    ) {
      redirect('/onboarding');
    }
  }

  return (
    <DashboardDataProvider initialData={initialData}>
      <SignupTracker userId={initialData.user.id} createdAt={initialData.user.createdAt} />
      <SetupStatusProvider>{children}</SetupStatusProvider>
    </DashboardDataProvider>
  );
}
