import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resolveReleaseActor } from '@/lib/release-audit';
import { serviceErrorResponse } from '@/lib/services/http';
import { updateReleaseNotes } from '@/lib/services/releases';

export const runtime = 'nodejs';

/**
 * Change a release's notes: `{ notes: string | null }`. The release's lane is
 * republished, so phones that update from now on get the new text.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const { appId, releaseId } = await params;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('notes' in body)) {
    return NextResponse.json({ error: 'Body must be { "notes": string | null }' }, { status: 400 });
  }

  const actorLabel = await resolveReleaseActor(access.access);
  try {
    return NextResponse.json(
      await updateReleaseNotes({
        organizationId: access.access.organizationId,
        actor: await accessActor(access.access, actorLabel),
        appId,
        releaseId,
        // Validated and normalised by the service.
        notes: (body as { notes: unknown }).notes as string | null,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
