import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { db } from '@/lib/db';
import { deleteBundleObject } from '@/lib/storage';

export const runtime = 'nodejs';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; bundleId: string }> },
) {
  const routeParams = await params;
  const appId = routeParams.appId;

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const bundle = await db.bundle.findUnique({
    where: { id: routeParams.bundleId },
    select: {
      id: true,
      appId: true,
      storageKey: true,
    },
  });
  if (!bundle || bundle.appId !== appId) {
    return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
  }

  const releaseReference = await db.release.findFirst({
    where: {
      bundleId: bundle.id,
      appId,
    },
    select: { id: true },
  });
  if (releaseReference) {
    return NextResponse.json(
      {
        error: 'Cannot delete a bundle that is present in release history',
      },
      { status: 409 },
    );
  }

  await db.bundle.delete({
    where: { id: bundle.id },
  });

  try {
    await deleteBundleObject(bundle.storageKey);
  } catch (error) {
    console.error('Failed to delete storage object for bundle', bundle.id, error);
  }

  return NextResponse.json({ deleted: true, id: bundle.id });
}
