import { after, NextRequest, NextResponse } from 'next/server';

import { auditPush, pushActorLabel, pushErrorResponse, requirePushAccess } from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Params = { params: Promise<{ appId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 50);
    return NextResponse.json({ campaigns: await push.listCampaigns(appId, limit) });
  } catch (error) {
    return pushErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const expectedAudience =
    typeof body.expectedAudience === 'number' ? body.expectedAudience : undefined;
  const idempotencyKey =
    request.headers.get('idempotency-key') ??
    (typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined);

  try {
    const { campaign, created } = await push.createCampaign({
      organizationId: gate.access.organizationId,
      appId,
      actorLabel: await pushActorLabel(gate.access),
      payload: body.payload,
      audience: body.audience,
      expectedAudience,
      idempotencyKey,
    });
    if (created) {
      await auditPush(
        gate.access,
        'push_campaign.created',
        { type: 'push_campaign', id: campaign.id },
        { appId, targeted: campaign.targeted, title: campaign.payload.title },
      );
      // Start sending right away; the per-minute cron picks up anything left over.
      after(async () => {
        await push
          .deliverDueBatches({ budgetMs: 200_000 })
          .catch((error) => console.error('[Push] immediate delivery failed', error));
      });
    }
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
