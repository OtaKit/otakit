import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { createExperiment, listExperiments } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string }> };

/** The app's A/B tests: running first, then drafts, then the ones that ended. */
export async function GET(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json({
      experiments: await listExperiments({ organizationId: access.access.organizationId, appId }),
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/**
 * Create a draft: `{ key, name, channel?, audienceChannels?, runtimeVersions?,
 * trafficPercent?, variants, goalEvent, secondaryEvents? }`.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const experiment = await createExperiment(
      {
        organizationId: access.access.organizationId,
        actor: await accessActor(access.access),
        appId,
      },
      body as Record<string, unknown>,
    );
    return NextResponse.json({ experiment }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
