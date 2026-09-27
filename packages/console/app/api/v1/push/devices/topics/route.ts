import { NextRequest } from 'next/server';

import {
  limitPublicPushRequest,
  publicJson,
  publicPreflight,
  readJsonObject,
  resolvePublicPushApp,
} from '@/lib/push/http';
import { push, topicsSchema } from '@/lib/push/service';

export const runtime = 'nodejs';

export function OPTIONS() {
  return publicPreflight();
}

export async function POST(request: NextRequest) {
  const appId = request.headers.get('x-app-id')?.trim() ?? '';
  if (!appId) return publicJson({ error: 'Missing X-App-Id header' }, 401);

  const limited = await limitPublicPushRequest(request, appId);
  if (limited) return limited;

  const resolved = await resolvePublicPushApp(appId);
  if (!resolved.ok) return resolved.response;

  const parsed = topicsSchema.safeParse(await readJsonObject(request));
  if (!parsed.success) return publicJson({ error: 'Invalid request' }, 400);

  const updated = await push.updateDeviceTopics(appId, parsed.data);
  return publicJson({ updated }, updated ? 200 : 404);
}
