import { redirect } from 'next/navigation';

import { ProductDashboard } from '@/app/components/ProductDashboard';
import { SetupLauncher } from '@/app/components/setup/SetupLauncher';
import { getDashboardInitialData } from '@/app/dashboard/data';
import { getOnboardingProfile } from '@/lib/services/onboarding-profile';
import { shouldShowOnboarding } from '@/lib/onboarding-profile';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [initialData, params] = await Promise.all([getDashboardInitialData(), searchParams]);
  const pricing = Array.isArray(params.pricing) ? params.pricing[0] : params.pricing;
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;
  // Only intercept the app dashboard. Settings and explicit billing links must
  // stay reachable while the business questionnaire is unfinished.
  const billingVisit = pricing === '1' || ['success', 'onboarding'].includes(checkout ?? '');
  if (
    !billingVisit &&
    initialData.apps.length === 0 &&
    initialData.activeOrganization.role === 'owner'
  ) {
    const profile = await getOnboardingProfile(initialData.activeOrganization.id);
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
    <>
      <ProductDashboard initialData={initialData} />
      {/* Only on the apps view: Settings already has a launcher in this corner. */}
      <SetupLauncher openOnEmpty={checkout !== 'onboarding'} />
    </>
  );
}
