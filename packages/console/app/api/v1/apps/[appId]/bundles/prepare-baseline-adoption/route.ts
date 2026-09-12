import { NextRequest, NextResponse } from 'next/server';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { prepareBaselineAdoption } from '@/lib/services/rn-baselines';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return NextResponse.json({ error: access.error }, { status: access.status });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ error: 'Expected an adoption declaration' }, { status: 400 });
  try {
    return NextResponse.json(await prepareBaselineAdoption(appId, body));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
