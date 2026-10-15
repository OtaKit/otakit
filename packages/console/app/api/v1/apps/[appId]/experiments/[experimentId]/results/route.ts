import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getExperimentResults } from '@/lib/services/experiments';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; experimentId: string }> };

/** Devices per variant, conversion, probabilities, guardrails, the verdict and a daily series. */
export async function GET(request: NextRequest, { params }: Params) {
  const { appId, experimentId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  try {
    return NextResponse.json(
      await getExperimentResults(
        { organizationId: access.access.organizationId, appId },
        experimentId,
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
