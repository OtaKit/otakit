'use client';

import { ProductDashboard } from '@/app/components/ProductDashboard';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export default function DashboardPage() {
  const initialData = useDashboardData();
  return <ProductDashboard initialData={initialData} />;
}
