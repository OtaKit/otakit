import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { createPreview, isPreviewExpiry } from '@/lib/services/previews';

export const runtime = 'nodejs';

/** Create a preview link for a bundle: `{ expiresIn?: '1h'|'24h'|'7d'|'30d', urlScheme? }`. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string; bundleId: string }> },
) {
  const { appId, bundleId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (body.expiresIn !== undefined && !isPreviewExpiry(body.expiresIn)) {
    return NextResponse.json({ error: 'expiresIn must be 1h, 24h, 7d or 30d' }, { status: 400 });
  }
  if (body.urlScheme !== undefined && typeof body.urlScheme !== 'string') {
    return NextResponse.json({ error: 'urlScheme must be a string' }, { status: 400 });
  }

  try {
    const preview = await createPreview({
      access: access.access,
      appId,
      bundleId,
      expiresIn: body.expiresIn,
      urlScheme: body.urlScheme,
    });
    return NextResponse.json({ preview }, { status: 201 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
