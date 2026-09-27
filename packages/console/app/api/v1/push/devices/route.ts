import { NextRequest } from 'next/server';

import {
  findPushApp,
  registerDevice,
  registerDeviceSchema,
  unregisterDevice,
} from '@/lib/push/devices';
import {
  limitPublicPushRequest,
  publicJson,
  publicPreflight,
  readJsonObject,
} from '@/lib/push/public-http';

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

  const app = await findPushApp(appId);
  if (!app) return publicJson({ error: 'App not found' }, 404);

  const body = await readJsonObject(request);
  if (!body) return publicJson({ error: 'Invalid JSON body' }, 400);
  const parsed = registerDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return publicJson(
      { error: 'Invalid device', issues: parsed.error.issues.map((issue) => issue.message) },
      400,
    );
  }

  const result = await registerDevice(app, parsed.data);
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

  await unregisterDevice(appId, token);
  return publicJson({ removed: true });
}
