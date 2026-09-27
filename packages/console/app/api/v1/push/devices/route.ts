import { NextRequest } from 'next/server';

import {
  limitPublicPushRequest,
  publicJson,
  publicPreflight,
  readJsonObject,
  resolvePublicPushApp,
} from '@/lib/push/http';
import { push, registerDeviceSchema } from '@/lib/push/service';

export const runtime = 'nodejs';

const APP_ID_HEADER = 'x-app-id';

export function OPTIONS() {
  return publicPreflight();
}

export async function POST(request: NextRequest) {
  const appId = request.headers.get(APP_ID_HEADER)?.trim() ?? '';
  if (!appId) return publicJson({ error: 'Missing X-App-Id header' }, 401);

  const limited = await limitPublicPushRequest(request, appId);
  if (limited) return limited;

  const resolved = await resolvePublicPushApp(appId);
  if (!resolved.ok) return resolved.response;

  const body = await readJsonObject(request);
  if (!body) return publicJson({ error: 'Invalid JSON body' }, 400);
  const parsed = registerDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return publicJson(
      { error: 'Invalid device', issues: parsed.error.issues.map((issue) => issue.message) },
      400,
    );
  }

  const result = await push.registerDevice(resolved.app, parsed.data);
  if (!result.accepted) return publicJson(result, 202);
  return publicJson(result, result.created ? 201 : 200);
}

export async function DELETE(request: NextRequest) {
  const appId = request.headers.get(APP_ID_HEADER)?.trim() ?? '';
  if (!appId) return publicJson({ error: 'Missing X-App-Id header' }, 401);

  const limited = await limitPublicPushRequest(request, appId);
  if (limited) return limited;

  const body = await readJsonObject(request);
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token || token.length > 4096) return publicJson({ error: 'Missing token' }, 400);

  // Removing a device is always allowed, even with the add-on off.
  await push.unregisterDevice(appId, token);
  return publicJson({ removed: true });
}
