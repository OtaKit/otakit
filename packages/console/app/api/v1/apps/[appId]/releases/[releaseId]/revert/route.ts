import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { isReleaseReliabilityEnabled } from '@/lib/release-features';
import { serviceErrorResponse } from '@/lib/services/http';
import { revertRelease, revertReleaseLegacy } from '@/lib/services/releases';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;
  const releaseId = routeParams.releaseId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // The body is optional (existing clients POST without one); when present it
  // may carry a forceImmediate override for the release that becomes current.
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const rawForceImmediate = body.forceImmediate;
  if (rawForceImmediate !== undefined && typeof rawForceImmediate !== 'boolean') {
    return NextResponse.json({ error: 'forceImmediate must be a boolean' }, { status: 400 });
  }

  const rawExpectedCurrentReleaseId = body.expectedCurrentReleaseId;
  if (
    rawExpectedCurrentReleaseId !== undefined &&
    rawExpectedCurrentReleaseId !== null &&
    (typeof rawExpectedCurrentReleaseId !== 'string' ||
      rawExpectedCurrentReleaseId.trim().length === 0)
  ) {
    return NextResponse.json(
      { error: 'expectedCurrentReleaseId must be a release ID or null' },
      { status: 400 },
    );
  }
  const expectedCurrentReleaseId =
    typeof rawExpectedCurrentReleaseId === 'string'
      ? rawExpectedCurrentReleaseId.trim()
      : rawExpectedCurrentReleaseId;

  const revertedBy = await resolveReleaseActor(access.access);
  try {
    const revert = isReleaseReliabilityEnabled() ? revertRelease : revertReleaseLegacy;
    const result = await revert({
      appId,
      releaseId,
      actor: await accessActor(access.access, revertedBy),
      organizationId: access.access.organizationId,
      forceImmediate: rawForceImmediate,
      expectedCurrentReleaseId,
      idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
    });

    return NextResponse.json(result, {
      status: result.publicationStatus === 'published' ? 200 : 202,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
