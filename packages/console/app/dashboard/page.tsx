import { redirect } from 'next/navigation';

import { DashboardClient } from '@/app/dashboard/DashboardClient';
import { db } from '@/lib/db';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // An organization with no app has nothing to show here, so send it to the
  // guide rather than to three stacked empty states.
  const ctx = await getSessionContext();
  if (ctx) {
    const apps = await db.app.count({ where: { organizationId: ctx.organizationId } });
    if (apps === 0) redirect('/dashboard/setup');
  }

  return <DashboardClient />;
}
