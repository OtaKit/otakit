import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { createApp, listOrganizationApps } from '@/lib/services/apps';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const access = await resolveOrganizationAccess(request);
  if (!access.success) {
    return organizationAccessErrorResponse(access);
  }

  const searchParams = request.nextUrl.searchParams;
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);

  try {
    return NextResponse.json(
      await listOrganizationApps({
        organizationId: access.access.organizationId,
        slug: searchParams.get('slug') ?? undefined,
        cursor: searchParams.get('cursor') ?? undefined,
        limit: Number.isInteger(rawLimit) ? rawLimit : undefined,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const access = await resolveOrganizationAccess(request);
  if (!access.success) {
    return organizationAccessErrorResponse(access);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.slug !== 'string') {
    return NextResponse.json({ error: 'Missing slug', code: 'INVALID_INPUT' }, { status: 400 });
  }

  try {
    return NextResponse.json(await createApp({ access: access.access, slug: body.slug }), {
      status: 201,
    });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
