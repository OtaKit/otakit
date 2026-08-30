import { NextRequest, NextResponse } from 'next/server';

import { resolveOrganizationAccess } from '@/lib/organization-access';
import { serviceErrorResponse } from '@/lib/services/http';
import { prepareRelease } from '@/lib/services/releases';
import { isValidChannelName, normalizeOptionalChannel } from '@/lib/validation';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const bundleId = typeof body.bundleId === 'string' ? body.bundleId.trim() : '';
  if (!bundleId) {
    return NextResponse.json({ error: 'Missing bundleId' }, { status: 400 });
  }

  const rawCompatibilityDecision = body.compatibilityDecision;
  if (
    rawCompatibilityDecision !== undefined &&
    rawCompatibilityDecision !== 'block' &&
    rawCompatibilityDecision !== 'proceed' &&
    rawCompatibilityDecision !== 'skip'
  ) {
    return NextResponse.json({ error: 'Invalid compatibilityDecision' }, { status: 400 });
  }

  const rawChannel = body.channel;
  if (rawChannel !== undefined && rawChannel !== null && typeof rawChannel !== 'string') {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }
  const channel = normalizeOptionalChannel(rawChannel);
  if (
    typeof rawChannel === 'string' &&
    rawChannel.trim().length > 0 &&
    (!channel || !isValidChannelName(channel))
  ) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await prepareRelease({
        organizationId: access.access.organizationId,
        appId,
        bundleId,
        channel,
        compatibilityDecision: rawCompatibilityDecision,
      }),
    );
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
