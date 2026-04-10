import { ProductDashboard } from '@/app/components/ProductDashboard';
import {
  dashboardPreviewData,
  dashboardPreviewInitialData,
} from '@/app/dashboard-preview/mock-data';

export const metadata = {
  title: 'Dashboard Preview — OtaKit',
  description: 'Screenshot-ready mock dashboard preview.',
};

export default function DashboardPreviewPage() {
  return (
    <ProductDashboard
      initialData={dashboardPreviewInitialData}
      previewData={dashboardPreviewData}
      shellClassName="m-0 min-h-screen border-0 bg-background"
      brandHref="/dashboard-preview"
      dashboardHref="/dashboard-preview"
      settingsHref="/dashboard-preview"
      docsHref="/docs"
    />
  );
}
