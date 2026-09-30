import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { revokePreview } from '@/lib/services/previews';

export const runtime = 'nodejs';

/** Revoke a preview link; devices on it return to their release on the next check. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; previewId: string }> },
) {
  const { appId, previewId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    return NextResponse.json(await revokePreview({ access: access.access, appId, previewId }));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
