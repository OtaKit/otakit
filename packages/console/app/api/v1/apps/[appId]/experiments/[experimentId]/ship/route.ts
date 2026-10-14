import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { shipExperimentVariant } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; experimentId: string }> };

/**
 * Ship a variant of a running or stopped test: `{ variant }`. Its overrides
 * become part of the config for every device, and the test ends.
 */
export async function POST(request: NextRequest, { params }: Params) {
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
    return NextResponse.json(
      await shipExperimentVariant(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        experimentId,
        { variant: (body as { variant?: unknown }).variant },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
