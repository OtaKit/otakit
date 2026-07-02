import type { ReactNode } from 'react';

import { DashboardDataProvider } from '@/app/dashboard/DashboardDataProvider';
import { getDashboardInitialData } from '@/app/dashboard/data';
import { SignupTracker } from '@/app/components/SignupTracker';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const initialData = await getDashboardInitialData();

  return (
    <DashboardDataProvider initialData={initialData}>
      <SignupTracker userId={initialData.user.id} createdAt={initialData.user.createdAt} />
      {children}
    </DashboardDataProvider>
  );
}
