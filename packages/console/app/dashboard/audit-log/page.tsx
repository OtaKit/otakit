'use client';

import { AuditLogDashboard } from '@/app/components/AuditLogDashboard';
import { useDashboardData } from '@/app/dashboard/DashboardDataProvider';

export default function DashboardAuditLogPage() {
  const initialData = useDashboardData();
  return <AuditLogDashboard initialData={initialData} />;
}
