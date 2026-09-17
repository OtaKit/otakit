import { ProductDashboard } from '@/app/components/ProductDashboard';
import { SetupLauncher } from '@/app/components/setup/SetupLauncher';
import { getDashboardInitialData } from '@/app/dashboard/data';

/**
 * The dashboard never sends anyone to the questions. Sign-up is the only route
 * to them, so reaching the dashboard — the first time or the hundredth — always
 * shows the dashboard.
 */
export default async function DashboardPage() {
  const initialData = await getDashboardInitialData();
  return (
    <>
      <ProductDashboard initialData={initialData} />
      {/* Only on the apps view: Settings already has a button in this corner. */}
      <SetupLauncher />
    </>
  );
}
