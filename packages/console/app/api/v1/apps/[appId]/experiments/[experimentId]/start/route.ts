import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { startExperiment } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; experimentId: string }> };

/** Start a draft: devices that read its config get their variant on their next config fetch. */
export async function POST(request: NextRequest, { params }: Params) {
  const { appId, experimentId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await startExperiment(
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
