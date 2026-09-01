import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { getReleaseHealth, type ReleaseHealthWindow } from '@/lib/services/releases';

export const runtime = 'nodejs';

const RELEASE_HEALTH_WINDOWS = ['1h', '24h', '7d', '30d'] as const;

function isReleaseHealthWindow(value: string): value is ReleaseHealthWindow {
  return RELEASE_HEALTH_WINDOWS.includes(value as ReleaseHealthWindow);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; releaseId: string }> },
) {
  const { appId, releaseId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const rawWindow = request.nextUrl.searchParams.get('window') ?? '24h';
  if (!isReleaseHealthWindow(rawWindow)) {
    return NextResponse.json(
      { error: `Invalid window. Must be one of: ${RELEASE_HEALTH_WINDOWS.join(', ')}` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await getReleaseHealth({
        organizationId: access.access.organizationId,
        appId,
        releaseId,
        window: rawWindow,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
