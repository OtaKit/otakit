import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { deleteExperiment, getExperiment, updateExperiment } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; experimentId: string }> };

/** One A/B test, by ID or key. */
export async function GET(request: NextRequest, { params }: Params) {
  const { appId, experimentId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json({
      experiment: await getExperiment(
        { organizationId: access.access.organizationId, appId },
        experimentId,
      ),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/** Change a draft, or rename a test that started (the rest is locked while it runs). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { appId, experimentId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    return NextResponse.json({
      experiment: await updateExperiment(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        experimentId,
        body as Record<string, unknown>,
      ),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/** Delete a test that is not running, with its results. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { appId, experimentId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await deleteExperiment(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        experimentId,
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
