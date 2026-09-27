import { NextRequest } from 'next/server';

import { findPushApp, topicsSchema, updateDeviceTopics } from '@/lib/push/devices';
import {
  limitPublicPushRequest,
  publicJson,
  publicPreflight,
  readJsonObject,
} from '@/lib/push/public-http';

export const runtime = 'nodejs';

export function OPTIONS() {
  return publicPreflight();
}

export async function POST(request: NextRequest) {
  const appId = request.headers.get('x-app-id')?.trim() ?? '';
  if (!appId) return publicJson({ error: 'Missing X-App-Id header' }, 401);

  const limited = await limitPublicPushRequest(request, appId);
  if (limited) return limited;

  if (!(await findPushApp(appId))) return publicJson({ error: 'App not found' }, 404);

  const parsed = topicsSchema.safeParse(await readJsonObject(request));
  if (!parsed.success) return publicJson({ error: 'Invalid request' }, 400);

  const updated = await updateDeviceTopics(appId, parsed.data);
  return publicJson({ updated }, updated ? 200 : 404);
}
