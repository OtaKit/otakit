import { after, NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { createCampaign, listCampaigns } from '@/lib/push/campaigns';
import { deliverDueBatches } from '@/lib/push/deliver';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Params = { params: Promise<{ appId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
    return NextResponse.json({ campaigns: await listCampaigns(appId, limit) });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const expectedAudience =
    typeof body.expectedAudience === 'number' ? body.expectedAudience : undefined;
  const idempotencyKey =
    request.headers.get('idempotency-key') ??
    (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined);

  try {
    const campaign = await createCampaign({
      organizationId: access.access.organizationId,
      appId,
      actor: await accessActor(access.access),
      payload: body.payload,
      audience: body.audience,
      expectedAudience,
      idempotencyKey,
    });
    // Start sending right away; the per-minute cron picks up anything left over.
    after(async () => {
      await deliverDueBatches({ budgetMs: 200_000 }).catch((error) =>
        console.error('[Push] immediate delivery failed', error),
      );
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
