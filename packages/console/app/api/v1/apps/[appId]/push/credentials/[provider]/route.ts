import { NextRequest, NextResponse } from 'next/server';

import { accessActor } from '@/lib/audit-log';
import { resolveOrganizationAccess } from '@/lib/organization-access';
import {
  deletePushCredential,
  saveApnsCredential,
  saveFcmCredential,
} from '@/lib/push/credentials';
import { organizationAccessErrorResponse, serviceErrorResponse } from '@/lib/services/http';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; provider: string }> };

function parseProvider(value: string): 'apns' | 'fcm' | null {
  return value === 'apns' || value === 'fcm' ? value : null;
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { appId, provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const actor = await accessActor(access.access);
    const credential =
      provider === 'apns'
        ? await saveApnsCredential({ access: access.access, actor, appId, body })
        : await saveFcmCredential({
            access: access.access,
            actor,
            appId,
            serviceAccountJson: body.serviceAccountJson,
          });
    return NextResponse.json({ credential });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { appId, provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

  const access = await resolveOrganizationAccess(request, appId);
  if (!access.success) return organizationAccessErrorResponse(access);

  try {
    await deletePushCredential({
      access: access.access,
      actor: await accessActor(access.access),
      appId,
      provider,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
