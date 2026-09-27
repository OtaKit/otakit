import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { previewCampaign } from '@/lib/push/campaigns';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

/** Validates a message and counts who would receive it. Sends nothing. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  try {
    return NextResponse.json(
      await previewCampaign({ appId, payload: body.payload, audience: body.audience }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
