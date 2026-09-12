import { NextRequest, NextResponse } from 'next/server';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import { resumeRNZipUpload } from '@/lib/services/rn-uploads';
import { serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> },
) {
  const { appId } = await params;
  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return NextResponse.json({ error: access.error }, { status: access.status });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('uploadId' in body) ||
    typeof body.uploadId !== 'string' ||
    !body.uploadId
  )
    return NextResponse.json({ error: 'Missing uploadId' }, { status: 400 });
  try {
    return NextResponse.json(await resumeRNZipUpload(appId, body.uploadId));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
