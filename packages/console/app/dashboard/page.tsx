'use client';

import { ProductDashboard } from '@/app/components/ProductDashboard';
import { SetupLauncher } from '@/app/components/setup/SetupLauncher';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export default function DashboardPage() {
  const initialData = useDashboardData();
  return (
    <>
      <ProductDashboard initialData={initialData} />
      {/* Only on the apps view: Settings already has a launcher in this corner. */}
      <SetupLauncher />
    </>
  );
}
