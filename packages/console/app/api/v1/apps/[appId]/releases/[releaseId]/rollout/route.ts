import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { isReleaseReliabilityEnabled } from '@/lib/release-features';
import { serviceErrorResponse } from '@/lib/services/http';
import { isRolloutPercent } from '@/lib/rollouts';
import { rolloutsUnavailable, updateRollout } from '@/lib/services/releases';

export const runtime = 'nodejs';

/** Change an active rollout's percentage; `percent: 100` completes it. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const { appId, releaseId } = await params;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isRolloutPercent(body.percent)) {
    return NextResponse.json(
      { error: 'percent must be an integer between 1 and 100' },
      { status: 400 },
    );
  }
  if (body.expectedPercent !== undefined && !isRolloutPercent(body.expectedPercent)) {
    return NextResponse.json(
      { error: 'expectedPercent must be an integer between 1 and 100' },
      { status: 400 },
    );
  }

  if (!isReleaseReliabilityEnabled()) {
    return serviceErrorResponse(rolloutsUnavailable());
  }

  const actorLabel = await resolveReleaseActor(access.access);
  try {
    const result = await updateRollout({
      organizationId: access.access.organizationId,
      actor: await accessActor(access.access, actorLabel),
      appId,
      releaseId,
      percent: body.percent,
      expectedPercent: body.expectedPercent,
      idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
    });

    return NextResponse.json(result, {
      status: result.publicationStatus === 'published' ? 200 : 202,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
