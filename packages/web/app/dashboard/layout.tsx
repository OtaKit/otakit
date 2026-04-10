import type { ReactNode } from 'react';

import { DashboardDataProvider } from '@/app/dashboard/DashboardDataProvider';
import { getDashboardInitialData } from '@/app/dashboard/data';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const initialData = await getDashboardInitialData();

  return <DashboardDataProvider initialData={initialData}>{children}</DashboardDataProvider>;
}
