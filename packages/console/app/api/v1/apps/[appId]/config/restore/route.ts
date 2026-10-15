import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { restoreRemoteConfig } from '@/lib/services/remote-config';

export const runtime = 'nodejs';

/** Publish an earlier version's values again: `{ channel?, version, expectedVersion, message? }`. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  try {
    return NextResponse.json(
      await restoreRemoteConfig(
        {
          organizationId: access.access.organizationId,
          actor: await accessActor(access.access),
          appId,
        },
        {
          channel: input.channel,
          version: input.version,
          expectedVersion: input.expectedVersion,
          message: input.message,
        },
      ),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
