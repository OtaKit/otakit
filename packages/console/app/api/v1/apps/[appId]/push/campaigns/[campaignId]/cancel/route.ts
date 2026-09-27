import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { cancelCampaign } from '@/lib/push/campaigns';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; campaignId: string }> },
) {
  const { appId, campaignId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);
  try {
    const campaign = await cancelCampaign({
      organizationId: access.access.organizationId,
      appId,
      campaignId,
      actor: await accessActor(access.access),
    });
    return NextResponse.json({ campaign });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
