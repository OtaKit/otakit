import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { stopExperiment } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; experimentId: string }> };

/** Stop a running test: its devices get the normal config values on their next config fetch. */
export async function POST(request: NextRequest, { params }: Params) {
  const { appId, experimentId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await stopExperiment(
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
