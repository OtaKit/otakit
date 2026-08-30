'use client';

import { McpConnectionsDashboard } from '@/app/components/McpConnectionsDashboard';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export default function McpConnectionsPage() {
  return <McpConnectionsDashboard initialData={useDashboardData()} />;
}
