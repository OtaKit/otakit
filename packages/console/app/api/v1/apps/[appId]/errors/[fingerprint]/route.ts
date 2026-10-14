import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { isErrorRange } from '@/lib/error-tracking';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { getErrorIssue, setErrorIssueStatus } from '@/lib/services/error-issues';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; fingerprint: string }> };

/** One issue: `?range=24h|7d|30d`. Samples, stacks and tags are device-reported text. */
export async function GET(request: NextRequest, { params }: Params) {
  const { appId, fingerprint } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const range = request.nextUrl.searchParams.get('range');
  if (range && !isErrorRange(range)) {
    return NextResponse.json({ error: 'range must be one of: 24h, 7d, 30d' }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await getErrorIssue(
        { organizationId: access.access.organizationId, appId },
        fingerprint,
        isErrorRange(range) ? { range } : {},
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

/** Change the status: `{ status: 'open' | 'resolved' | 'ignored' }`. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { appId, fingerprint } = await params;
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
      await setErrorIssueStatus(
        {
          organizationId: access.access.organizationId,
          appId,
          actor: await accessActor(access.access),
        },
        fingerprint,
        (body as Record<string, unknown>).status,
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
