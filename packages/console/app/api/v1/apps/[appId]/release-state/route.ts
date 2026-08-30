import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { getReleaseState } from '@/lib/services/releases';
import {
  isValidChannelName,
  isValidRuntimeVersion,
  normalizeOptionalChannel,
} from '@/lib/validation';

export const runtime = 'nodejs';

function nullableParameter(request: NextRequest, name: string): string | null {
  const value = request.nextUrl.searchParams.get(name)?.trim();
  return value || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const channel = normalizeOptionalChannel(request.nextUrl.searchParams.get('channel'));
  if (channel && !isValidChannelName(channel)) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }
  const runtimeVersion = nullableParameter(request, 'runtimeVersion');
  if (runtimeVersion && !isValidRuntimeVersion(runtimeVersion)) {
    return NextResponse.json({ error: 'Invalid runtime version' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await getReleaseState({
        organizationId: access.access.organizationId,
        appId,
        channel,
        runtimeVersion,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
