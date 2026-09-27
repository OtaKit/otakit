import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getCampaign } from '@/lib/push/campaigns';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; campaignId: string }> },
) {
  const { appId, campaignId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);
  try {
    return NextResponse.json({ campaign: await getCampaign(appId, campaignId) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
