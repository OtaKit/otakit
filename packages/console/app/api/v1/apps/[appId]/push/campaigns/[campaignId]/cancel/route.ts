import { NextRequest, NextResponse } from 'next/server';

import { auditPush, pushErrorResponse, requirePushAccess } from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; campaignId: string }> },
) {
  const { appId, campaignId } = await params;
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;
  try {
    const { campaign, canceled } = await push.cancelCampaign({ appId, campaignId });
    if (canceled) {
      await auditPush(
        gate.access,
        'push_campaign.canceled',
        { type: 'push_campaign', id: campaign.id },
        { appId },
      );
    }
    return NextResponse.json({ campaign });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
