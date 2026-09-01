'use client';

import { ProductDashboard } from '@/app/components/ProductDashboard';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export function DashboardClient() {
  const initialData = useDashboardData();
  return <ProductDashboard initialData={initialData} />;
}
