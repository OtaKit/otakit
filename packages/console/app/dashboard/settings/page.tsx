'use client';

import { SettingsDashboard } from '@/app/components/SettingsDashboard';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export default function DashboardSettingsPage() {
  const initialData = useDashboardData();
  return <SettingsDashboard initialData={initialData} />;
}
