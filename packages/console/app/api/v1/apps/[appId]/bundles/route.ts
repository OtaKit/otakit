import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { db } from '@/lib/db';
import { parseNonNegativeInteger } from '@/lib/validation';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseNonNegativeInteger(searchParams.get('limit'), 20), 200);
  const offset = parseNonNegativeInteger(searchParams.get('offset'), 0);

  const where = { appId };

  const [bundles, total] = await Promise.all([
    db.bundle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    db.bundle.count({ where }),
  ]);

  return NextResponse.json({
    bundles: bundles.map((bundle) => ({
      id: bundle.id,
      version: bundle.version,
      sha256: bundle.sha256,
      size: bundle.size,
      runtimeVersion: bundle.runtimeVersion,
      createdAt: bundle.createdAt.toISOString(),
    })),
    total,
  });
}
