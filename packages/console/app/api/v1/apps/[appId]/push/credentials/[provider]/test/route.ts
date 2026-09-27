import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { testPushCredential } from '@/lib/push/credentials';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; provider: string }> },
) {
  const { appId, provider } = await params;
  if (provider !== 'apns' && provider !== 'fcm') {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });
  }
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);

  try {
    return NextResponse.json(await testPushCredential({ access: access.access, appId, provider }));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
