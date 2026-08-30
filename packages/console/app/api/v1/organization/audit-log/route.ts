import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { listAuditLog } from '@/lib/services/audit';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const access = await resolveOrganizationAccess(request);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = request.nextUrl.searchParams;
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  try {
    return NextResponse.json(
      await listAuditLog({
        access: access.access,
        cursor: searchParams.get('cursor') ?? undefined,
        limit: Number.isInteger(rawLimit) ? rawLimit : undefined,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
