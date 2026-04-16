import { redirect } from 'next/navigation';

export default function DashboardPricingPage() {
  redirect('/dashboard/settings?pricing=1');
}
