'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { DashboardInitialData } from '@/app/components/dashboard-types';

const DashboardDataContext = createContext<DashboardInitialData | null>(null);

export function DashboardDataProvider({
  initialData,
  children,
}: {
  initialData: DashboardInitialData;
  children: ReactNode;
}) {
  return (
    <DashboardDataContext.Provider value={initialData}>{children}</DashboardDataContext.Provider>
  );
}

export function useDashboardData(): DashboardInitialData {
  const data = useContext(DashboardDataContext);
  if (!data) {
    throw new Error('useDashboardData must be used within DashboardDataProvider');
  }
  return data;
}
