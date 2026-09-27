import { NextRequest, NextResponse } from 'next/server';

import {
  auditPush,
  pushActorLabel,
  pushAdminError,
  pushErrorResponse,
  readJsonObject,
  requirePushAccess,
} from '@/lib/push/http';
import { push } from '@/lib/push/service';

export const runtime = 'nodejs';

type Params = { params: Promise<{ appId: string; provider: string }> };

function parseProvider(value: string): 'apns' | 'fcm' | null {
  return value === 'apns' || value === 'fcm' ? value : null;
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { appId, provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;
  const forbidden = pushAdminError(gate.access);
  if (forbidden) return forbidden;

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  try {
    const actorLabel = await pushActorLabel(gate.access);
    const credential =
      provider === 'apns'
        ? await push.saveApnsCredential({ appId, actorLabel, body })
        : await push.saveFcmCredential({
            appId,
            actorLabel,
            serviceAccountJson: body.serviceAccountJson,
          });
    await auditPush(gate.access, 'push_credential.saved', { type: 'app', id: appId }, { provider });
    return NextResponse.json({ credential });
  } catch (error) {
    return pushErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { appId, provider: rawProvider } = await params;
  const provider = parseProvider(rawProvider);
  if (!provider) return NextResponse.json({ error: 'Unknown provider' }, { status: 404 });

  const gate = await requirePushAccess(request, appId);
  if (!gate.ok) return gate.response;
  const forbidden = pushAdminError(gate.access);
  if (forbidden) return forbidden;

  try {
    if (await push.deleteCredential({ appId, provider })) {
      await auditPush(
        gate.access,
        'push_credential.deleted',
        { type: 'app', id: appId },
        { provider },
      );
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return pushErrorResponse(error);
  }
}
