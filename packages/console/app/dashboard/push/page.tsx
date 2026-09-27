'use client';

import { PushDashboard } from '@/app/components/push/PushDashboard';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export default function DashboardPushPage() {
  const initialData = useDashboardData();
  return <PushDashboard initialData={initialData} />;
}
