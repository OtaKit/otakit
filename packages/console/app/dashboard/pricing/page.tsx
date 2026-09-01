import { redirect } from 'next/navigation';

export default function DashboardPricingPage() {
  redirect('/dashboard?pricing=1');
}
